// ==========================================
// ===== ИМПОРТЫ =====
// ==========================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ==========================================
// ===== НАСТРОЙКА =====
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ===== ПРОВЕРКА initData =====
// ==========================================
function verifyInitData(initData) {
    if (!initData || typeof initData !== 'string') return null;
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) return null;
        params.delete('hash');
        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (calculatedHash !== hash) return null;
        const userRaw = params.get('user');
        if (!userRaw) return null;
        return JSON.parse(userRaw);
    } catch (e) {
        console.error('verifyInitData error:', e.message);
        return null;
    }
}

// ==========================================
// ===== MIDDLEWARE =====
// ==========================================
async function authMiddleware(req, res, next) {
    const initData = req.headers['x-init-data'] || req.body?.initData;
    if (!initData && process.env.NODE_ENV !== 'production') {
        req.user = { id: 999999999, first_name: 'Dev', username: 'dev_user' };
        req.tg_id = 999999999;
        return next();
    }
    const user = verifyInitData(initData);
    if (!user) return res.status(401).json({ error: 'Invalid initData' });
    req.user = user;
    req.tg_id = user.id;
    next();
}

// ==========================================
// ===== HEALTH =====
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'tracker', time: new Date().toISOString() });
});

// ==========================================
// ===== AUTH =====
// ==========================================
app.post('/api/auth', authMiddleware, async (req, res) => {
    const u = req.user;
    const { data: existing } = await supabase.from('users').select('id').eq('id', u.id).maybeSingle();
    if (existing) {
        await supabase.from('users').update({
            username: u.username || null,
            first_name: u.first_name || null,
            last_name: u.last_name || null,
            photo_url: u.photo_url || null,
            language_code: u.language_code || null,
            updated_at: new Date().toISOString(),
        }).eq('id', u.id);
    } else {
        await supabase.from('users').insert({
            id: u.id,
            username: u.username || null,
            first_name: u.first_name || null,
            last_name: u.last_name || null,
            photo_url: u.photo_url || null,
            language_code: u.language_code || null,
        });
    }
    res.json({
        ok: true,
        user: { id: u.id, name: u.first_name || u.username || 'Друг', username: u.username || null },
    });
});

// ==========================================
// ===== ME =====
// ==========================================
app.get('/api/me', authMiddleware, async (req, res) => {
    const { data, error } = await supabase.from('users').select('*').eq('id', req.tg_id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user: data });
});

// ==========================================
// ===== BACKUP =====
// ==========================================
app.get('/api/backup', authMiddleware, async (req, res) => {
    try {
        const tables = [
            'users', 'disc_areas', 'disc_goals', 'disc_habits', 'disc_habit_logs',
            'cash_budget', 'cash_subs', 'cash_weekly', 'cash_expenses', 'cash_wishlist', 'cash_piggy',
            'gym_metrics', 'gym_metric_logs', 'gym_programs', 'gym_program_days', 'gym_exercises',
            'gym_photos', 'gym_materials',
            'food_recipes', 'food_recipe_ingredients', 'food_recipe_steps', 'food_recipe_links',
            'food_products', 'food_diary', 'food_goals', 'food_shopping',
            'film_genres', 'film_movies',
            'tea_groups', 'tea_items', 'tea_links',
            'places_items', 'places_photos',
        ];
        const backup = { exported_at: new Date().toISOString(), tg_id: req.tg_id, data: {} };
        for (const table of tables) {
            const column = table === 'users' ? 'id' : 'tg_id';
            const { data, error } = await supabase.from(table).select('*').eq(column, req.tg_id);
            if (!error) backup.data[table] = data || [];
        }
        res.json(backup);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ===== DISCIPLINE: ПРИВЫЧКИ =====
// ==========================================
app.get('/api/disc/habits', authMiddleware, async (req, res) => {
    try {
        const { data: habits } = await supabase
            .from('disc_habits').select('*')
            .eq('tg_id', req.tg_id).eq('archived', false)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        if (!habits) return res.json({ habits: [] });

        const since = new Date();
        since.setDate(since.getDate() - 60);
        const sinceStr = since.toISOString().slice(0, 10);

        const { data: logs } = await supabase
            .from('disc_habit_logs').select('habit_id, date, done')
            .eq('tg_id', req.tg_id).gte('date', sinceStr);

        const logsMap = {};
        (logs || []).forEach(l => {
            if (!logsMap[l.habit_id]) logsMap[l.habit_id] = [];
            logsMap[l.habit_id].push({ date: l.date, done: l.done });
        });

        const result = habits.map(h => ({ ...h, logs: logsMap[h.id] || [] }));
        res.json({ habits: result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/disc/habits', authMiddleware, async (req, res) => {
    const { name, frequency, days_of_week, interval_days } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const { data, error } = await supabase
        .from('disc_habits')
        .insert({
            tg_id: req.tg_id,
            name: name.trim(),
            frequency: frequency || 'daily',
            days_of_week: days_of_week || [1,2,3,4,5,6,7],
            interval_days: interval_days || 2,
        })
        .select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ habit: { ...data, logs: [] } });
});

app.patch('/api/disc/habits/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.frequency !== undefined) updates.frequency = req.body.frequency;
    if (req.body.days_of_week !== undefined) updates.days_of_week = req.body.days_of_week;
    if (req.body.interval_days !== undefined) updates.interval_days = req.body.interval_days;

    const { data, error } = await supabase
        .from('disc_habits').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id)
        .select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ habit: data });
});

app.delete('/api/disc/habits/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('disc_habits').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

app.post('/api/disc/habits/:id/toggle', authMiddleware, async (req, res) => {
    const habitId = req.params.id;
    const d = req.body.date || new Date().toISOString().slice(0, 10);

    const today = new Date().toISOString().slice(0, 10);
    if (d > today) return res.status(400).json({ error: 'Cannot mark future dates' });

    const { data: existing } = await supabase
        .from('disc_habit_logs').select('id, done')
        .eq('habit_id', habitId).eq('tg_id', req.tg_id).eq('date', d)
        .maybeSingle();

    if (existing) {
        await supabase.from('disc_habit_logs').delete().eq('id', existing.id);
        return res.json({ ok: true, done: false });
    }

    const { error } = await supabase
        .from('disc_habit_logs').insert({ habit_id: habitId, tg_id: req.tg_id, date: d, done: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, done: true });
});

// ==========================================
// ===== DISCIPLINE: КАЛЕНДАРЬ ПРИВЫЧКИ =====
// ==========================================
app.get('/api/disc/habits/:id/month', authMiddleware, async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year & month required' });

    const y = parseInt(year);
    const m = parseInt(month);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data: logs, error } = await supabase
        .from('disc_habit_logs')
        .select('date, done')
        .eq('habit_id', req.params.id)
        .eq('tg_id', req.tg_id)
        .gte('date', start).lte('date', end);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: logs || [] });
});

// ==========================================
// ===== DISCIPLINE: НЕДЕЛЯ =====
// ==========================================
function isScheduled(habit, dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay() === 0 ? 7 : d.getDay();

    if (habit.frequency === 'daily') return true;

    if (habit.frequency === 'days') {
        return (habit.days_of_week || []).includes(dow);
    }

    if (habit.frequency === 'interval') {
        const created = new Date(habit.created_at);
        created.setHours(0, 0, 0, 0);
        const target = new Date(dateStr + 'T00:00:00');
        target.setHours(0, 0, 0, 0);
        const diffDays = Math.round((target - created) / (1000 * 60 * 60 * 24));
        const n = habit.interval_days || 2;
        return diffDays >= 0 && diffDays % n === 0;
    }

    return true;
}

app.get('/api/disc/habits/week', authMiddleware, async (req, res) => {
    const { start } = req.query;
    if (!start) return res.status(400).json({ error: 'start required' });

    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const end = endDate.toISOString().slice(0, 10);

    const { data: habits } = await supabase
        .from('disc_habits').select('*')
        .eq('tg_id', req.tg_id).eq('archived', false)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });

    const { data: logs } = await supabase
        .from('disc_habit_logs').select('habit_id, date, done')
        .eq('tg_id', req.tg_id).gte('date', start).lte('date', end);

    const logsMap = {};
    (logs || []).forEach(l => {
        if (!logsMap[l.habit_id]) logsMap[l.habit_id] = new Set();
        if (l.done) logsMap[l.habit_id].add(l.date);
    });

    const result = (habits || []).map(h => {
        const doneDates = logsMap[h.id] || new Set();
        const week = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().slice(0, 10);
            week.push({
                date: dateStr,
                done: doneDates.has(dateStr),
                scheduled: isScheduled(h, dateStr),
            });
        }
        return {
            id: h.id,
            name: h.name,
            frequency: h.frequency,
            days_of_week: h.days_of_week,
            interval_days: h.interval_days,
            week,
        };
    });

    res.json({ start, habits: result });
});

// ==========================================
// ===== СТАТИСТИКА ЗА МЕСЯЦ =====
// ==========================================
app.get('/api/disc/habits/month-stats', authMiddleware, async (req, res) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data: logs } = await supabase
        .from('disc_habit_logs')
        .select('date')
        .eq('tg_id', req.tg_id)
        .gte('date', first).lte('date', last);

    const counts = {};
    for (let i = 1; i <= lastDay; i++) {
        const d = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        counts[d] = 0;
    }
    (logs || []).forEach(l => { if (counts[l.date] !== undefined) counts[l.date]++; });

    const days = Object.entries(counts).map(([date, count]) => ({ date, count }));
    res.json({ year, month, days });
});

// ==========================================
// ===== DISCIPLINE: ЦЕЛИ =====
// ==========================================
app.get('/api/disc/areas', authMiddleware, async (req, res) => {
    try {
        const { data: areas } = await supabase
            .from('disc_areas').select('*')
            .eq('tg_id', req.tg_id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        const { data: goals } = await supabase
            .from('disc_goals').select('*')
            .eq('tg_id', req.tg_id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });

        const result = (areas || []).map(a => ({
            ...a,
            goals: (goals || []).filter(g => g.area_id === a.id),
        }));
        const orphanGoals = (goals || []).filter(g => !g.area_id);
        res.json({ areas: result, orphanGoals });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/disc/areas', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase
        .from('disc_areas').insert({ tg_id: req.tg_id, name: name.trim() })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ area: { ...data, goals: [] } });
});

app.delete('/api/disc/areas/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('disc_areas').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

app.post('/api/disc/goals', authMiddleware, async (req, res) => {
    const { name, area_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase
        .from('disc_goals').insert({
            tg_id: req.tg_id,
            name: name.trim(),
            area_id: area_id || null,
            status: 'plan',
        }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ goal: data });
});

app.patch('/api/disc/goals/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name', 'status', 'deadline', 'note'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('disc_goals').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ goal: data });
});

app.delete('/api/disc/goals/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('disc_goals').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ==========================================
// ===== HOME: ДАШБОРД =====
// ==========================================
app.get('/api/home', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const { data: habits } = await supabase
            .from('disc_habits').select('*')
            .eq('tg_id', req.tg_id).eq('archived', false)
            .order('created_at', { ascending: true });

        const since = new Date();
        since.setDate(since.getDate() - 60);

        const { data: logs } = await supabase
            .from('disc_habit_logs').select('habit_id, date, done')
            .eq('tg_id', req.tg_id).gte('date', since.toISOString().slice(0, 10));

        const logsMap = {};
        (logs || []).forEach(l => {
            if (!logsMap[l.habit_id]) logsMap[l.habit_id] = [];
            logsMap[l.habit_id].push(l);
        });

        const habitsWithLogs = (habits || []).map(h => ({
            id: h.id,
            name: h.name,
            doneToday: (logsMap[h.id] || []).some(l => l.date === today && l.done),
            streak: calcStreak(logsMap[h.id] || []),
        }));

        const { data: areas } = await supabase
            .from('disc_areas').select('*')
            .eq('tg_id', req.tg_id)
            .order('sort_order', { ascending: true });

        const { data: goals } = await supabase
            .from('disc_goals').select('id, area_id, status')
            .eq('tg_id', req.tg_id);

        const areasStats = (areas || []).map(a => {
            const gs = (goals || []).filter(g => g.area_id === a.id);
            return {
                id: a.id,
                name: a.name,
                total: gs.length,
                done: gs.filter(g => g.status === 'done').length,
            };
        });

        res.json({ today, habits: habitsWithLogs, areas: areasStats });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

function calcStreak(logs) {
    const done = new Set(logs.filter(l => l.done).map(l => l.date));
    let streak = 0;
    const d = new Date();
    while (true) {
        const key = d.toISOString().slice(0, 10);
        if (done.has(key)) { streak++; d.setDate(d.getDate() - 1); }
        else break;
    }
    return streak;
}

// ==========================================
// ===== CASH: БЮДЖЕТ =====
// ==========================================
app.get('/api/cash/budget', authMiddleware, async (req, res) => {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);

    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Недель в месяце
    const weeksInMonth = Math.ceil(lastDay / 7);

    const [budgetR, subsR, weeklyR, expR] = await Promise.all([
        supabase.from('cash_budget').select('*')
            .eq('tg_id', req.tg_id).eq('year', year).eq('month', month).maybeSingle(),
        supabase.from('cash_subs').select('*').eq('tg_id', req.tg_id).eq('active', true),
        supabase.from('cash_weekly').select('*').eq('tg_id', req.tg_id),
        supabase.from('cash_expenses').select('*')
            .eq('tg_id', req.tg_id).gte('date', first).lte('date', last)
            .order('date', { ascending: false }),
    ]);

    const subsTotal = (subsR.data || []).reduce((s, x) => s + Number(x.amount || 0), 0);
    const weeklyTotal = (weeklyR.data || []).reduce((s, x) => s + Number(x.amount || 0), 0) * weeksInMonth;
    const expensesTotal = (expR.data || []).reduce((s, x) => s + Number(x.amount || 0), 0);

    const budget = budgetR.data || { year, month, budget_amount: 0, invest_amount: 0, piggy_amount: 0 };
    const planned = subsTotal + weeklyTotal;
    const remaining = Number(budget.budget_amount || 0) - expensesTotal - planned;

    res.json({
        year, month,
        weeksInMonth,
        budget,
        subs: subsR.data || [],
        weekly: weeklyR.data || [],
        expenses: expR.data || [],
        totals: {
            budget: Number(budget.budget_amount || 0),
            subs: subsTotal,
            weekly: weeklyTotal,
            planned,
            expenses: expensesTotal,
            remaining,
        },
    });
});

app.post('/api/cash/budget', authMiddleware, async (req, res) => {
    const { year, month, budget_amount, invest_amount, piggy_amount } = req.body;
    if (!year || !month) return res.status(400).json({ error: 'year & month required' });

    const { data: existing } = await supabase
        .from('cash_budget').select('id')
        .eq('tg_id', req.tg_id).eq('year', year).eq('month', month).maybeSingle();

    const payload = {
        tg_id: req.tg_id,
        year, month,
        budget_amount: Number(budget_amount) || 0,
        invest_amount: Number(invest_amount) || 0,
        piggy_amount: Number(piggy_amount) || 0,
        updated_at: new Date().toISOString(),
    };

    let result;
    if (existing) {
        result = await supabase.from('cash_budget').update(payload).eq('id', existing.id).select().single();
    } else {
        result = await supabase.from('cash_budget').insert(payload).select().single();
    }

    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json({ budget: result.data });
});

// Подписки
app.post('/api/cash/subs', authMiddleware, async (req, res) => {
    const { name, amount } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const { data, error } = await supabase
        .from('cash_subs').insert({ tg_id: req.tg_id, name: name.trim(), amount: Number(amount) || 0 })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sub: data });
});

app.delete('/api/cash/subs/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('cash_subs').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// Недельные
app.post('/api/cash/weekly', authMiddleware, async (req, res) => {
    const { name, amount } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const { data, error } = await supabase
        .from('cash_weekly').insert({ tg_id: req.tg_id, name: name.trim(), amount: Number(amount) || 0 })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ weekly: data });
});

app.delete('/api/cash/weekly/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('cash_weekly').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// Траты
app.post('/api/cash/expenses', authMiddleware, async (req, res) => {
    const { name, amount, date, category, note } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const { data, error } = await supabase
        .from('cash_expenses').insert({
            tg_id: req.tg_id,
            name: name.trim(),
            amount: Number(amount) || 0,
            date: date || new Date().toISOString().slice(0, 10),
            category: category || null,
            note: note || null,
        }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ expense: data });
});

app.delete('/api/cash/expenses/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('cash_expenses').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ==========================================
// ===== CASH: WISHLIST =====
// ==========================================
app.get('/api/cash/wishlist', authMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('cash_wishlist').select('*')
        .eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
});

app.post('/api/cash/wishlist', authMiddleware, async (req, res) => {
    const { name, price, priority, url } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const { data, error } = await supabase
        .from('cash_wishlist').insert({
            tg_id: req.tg_id,
            name: name.trim(),
            price: Number(price) || 0,
            priority: priority || 'important_not_urgent',
            url: url || null,
        }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.patch('/api/cash/wishlist/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name', 'price', 'priority', 'url', 'done'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const { data, error } = await supabase.from('cash_wishlist').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/cash/wishlist/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('cash_wishlist').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ==========================================
// ===== CASH: КОПИЛКА =====
// ==========================================
app.get('/api/cash/piggy', authMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('cash_piggy').select('*')
        .eq('tg_id', req.tg_id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    let total = 0, took = 0;
    (data || []).forEach(x => {
        if (x.type === 'deposit') total += Number(x.amount);
        else if (x.type === 'withdraw') took += Number(x.amount);
    });

    res.json({
        items: data || [],
        totals: {
            deposited: total,
            withdrew: took,
            balance: total - took,
        },
    });
});

app.post('/api/cash/piggy', authMiddleware, async (req, res) => {
    const { type, amount, description, date } = req.body;
    if (!type || !['deposit', 'withdraw'].includes(type)) {
        return res.status(400).json({ error: 'type must be deposit or withdraw' });
    }
    if (!amount) return res.status(400).json({ error: 'amount required' });

    const { data, error } = await supabase
        .from('cash_piggy').insert({
            tg_id: req.tg_id,
            type,
            amount: Number(amount),
            description: description || null,
            date: date || new Date().toISOString().slice(0, 10),
        }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/cash/piggy/:id', authMiddleware, async (req, res) => {
    const { error } = await supabase.from('cash_piggy').delete()
        .eq('id', req.params.id).eq('tg_id', req.tg_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ==========================================
// ===== ЗАПУСК =====
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Tracker запущен: http://localhost:${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`BOT_TOKEN: ${BOT_TOKEN ? 'есть' : 'НЕТ!'}`);
    console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? 'есть' : 'НЕТ!'}`);
});