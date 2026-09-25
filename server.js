// ==========================================
// ===== ЗАВИСИМОСТИ =====
// ==========================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ===== AUTH: проверка initData =====
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
        const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (calc !== hash) return null;
        const userRaw = params.get('user');
        return userRaw ? JSON.parse(userRaw) : null;
    } catch {
        return null;
    }
}

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
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ==========================================
// ===== AUTH =====
// ==========================================
app.post('/api/auth', authMiddleware, async (req, res) => {
    const u = req.user;
    const { data: existing } = await supabase.from('users').select('id').eq('id', u.id).maybeSingle();
    const payload = {
        username: u.username || null,
        first_name: u.first_name || null,
        last_name: u.last_name || null,
        photo_url: u.photo_url || null,
        language_code: u.language_code || null,
    };
    if (existing) {
        await supabase.from('users').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', u.id);
    } else {
        await supabase.from('users').insert({ id: u.id, ...payload });
    }
    res.json({
        ok: true,
        user: { id: u.id, name: u.first_name || u.username || 'Друг', username: u.username || null },
    });
});

// ==========================================
// ===== MAIN (дашборд) =====
// ==========================================
app.get('/api/main', authMiddleware, async (req, res) => {
    // Берём дату от клиента, если есть. Иначе серверное UTC.
    const todayStr = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : localDate(new Date());

    // Парсим как локальную дату для вычисления дня недели
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const today = new Date(ty, tm - 1, td, 12, 0, 0); // 12:00 — чтобы избежать TZ-сдвигов

    const tomorrowDate = new Date(today);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = localDate(tomorrowDate);

    // --- Дела (сегодня + завтра, не закрытые) ---
    const { data: todos } = await supabase.from('disc_todos').select('*')
        .eq('tg_id', req.tg_id).eq('done', false)
        .or(`date.is.null,date.eq.${todayStr},date.eq.${tomorrowStr}`);

    const todosList = (todos || []).map(t => ({
        name: t.name,
        date: t.date,
        isToday: t.date === todayStr,
        isTomorrow: t.date === tomorrowStr,
        time_start: t.time_start,
        time_end: t.time_end,
    }));

    // --- Привычки на сегодня ---
    const { data: habits } = await supabase.from('disc_habits').select('*')
        .eq('tg_id', req.tg_id).eq('archived', false);

    const { data: logs } = await supabase.from('disc_habit_logs').select('habit_id, date, done')
        .eq('tg_id', req.tg_id).eq('date', todayStr);

    const doneToday = new Set((logs || []).filter(l => l.done).map(l => l.habit_id));

    const dow = today.getDay() === 0 ? 7 : today.getDay();

    function parseDow(raw) {
        if (Array.isArray(raw)) return raw.map(Number);
        if (typeof raw === 'string') {
            // Postgres array как строка: "{1,3,5,6}"
            return raw.replace(/[{}]/g, '').split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        }
        return [];
    }

    const habitsToday = (habits || []).filter(h => {
        const freq = (h.frequency || 'daily').toLowerCase();
        const dowArr = parseDow(h.days_of_week);

        // Если frequency неизвестна или пустая — определяем по days_of_week
        if (!h.frequency || (freq !== 'daily' && freq !== 'days' && freq !== 'interval')) {
            // Если массив дней не полный (7 элементов) — значит выбраны конкретные дни
            if (dowArr.length > 0 && dowArr.length < 7) {
                return dowArr.includes(dow);
            }
            return true;
        }

        if (freq === 'days') {
            return dowArr.length > 0 && dowArr.includes(dow);
        }
        if (freq === 'interval') {
            const c = new Date(h.created_at);
            c.setHours(0, 0, 0, 0);
            const t = new Date(today);
            t.setHours(0, 0, 0, 0);
            const diff = Math.round((t - c) / (1000 * 60 * 60 * 24));
            const n = h.interval_days || 2;
            return diff >= 0 && diff % n === 0;
        }
        return true; // daily
    });

    const habitsList = habitsToday
        .filter(h => !doneToday.has(h.id))
        .map(h => ({ id: h.id, name: h.name }));

    // --- Деньги (копилка + долг) ---
    const { data: piggyItems } = await supabase.from('cash_piggy').select('*').eq('tg_id', req.tg_id);
    const { data: piggySettings } = await supabase.from('cash_piggy_settings').select('*').eq('tg_id', req.tg_id).maybeSingle();

    let deposited = 0, withdrew = 0;
    (piggyItems || []).forEach(x => {
        if (x.type === 'deposit') deposited += Number(x.amount);
        else withdrew += Number(x.amount);
    });
    const piggyBalance = deposited - withdrew;
    const fact = Number(piggySettings?.fact_amount || 0);
    const debt = piggyBalance - fact;

    res.json({
        todos: todosList,
        habits: habitsList,
        money: { balance: piggyBalance, debt },
    });
});

// ==========================================
// ===== DISCIPLINE: ПРИВЫЧКИ =====
// ==========================================
app.get('/api/disc/habits', authMiddleware, async (req, res) => {
    const { data: habits } = await supabase.from('disc_habits').select('*')
        .eq('tg_id', req.tg_id).eq('archived', false)
        .order('sort_order').order('created_at');
    if (!habits) return res.json({ habits: [] });

    const since = new Date(); since.setDate(since.getDate() - 60);
    const { data: logs } = await supabase.from('disc_habit_logs').select('habit_id, date, done')
        .eq('tg_id', req.tg_id).gte('date', localDate(since));

    const map = {};
    (logs || []).forEach(l => { (map[l.habit_id] ||= []).push({ date: l.date, done: l.done }); });

    res.json({ habits: habits.map(h => ({ ...h, logs: map[h.id] || [] })) });
});

app.post('/api/disc/habits', authMiddleware, async (req, res) => {
    const { name, frequency, days_of_week, interval_days } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('disc_habits').insert({
        tg_id: req.tg_id,
        name: name.trim(),
        frequency: frequency || 'daily',
        days_of_week: days_of_week || [1,2,3,4,5,6,7],
        interval_days: interval_days || 2,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ habit: { ...data, logs: [] } });
});

app.patch('/api/disc/habits/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','frequency','days_of_week','interval_days'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const { data, error } = await supabase.from('disc_habits').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ habit: data });
});

app.delete('/api/disc/habits/:id', authMiddleware, async (req, res) => {
    await supabase.from('disc_habits').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/disc/habits/:id/toggle', authMiddleware, async (req, res) => {
    const d = req.body.date || localDate(new Date());
    if (d > localDate(new Date())) return res.status(400).json({ error: 'Future not allowed' });

    const { data: existing } = await supabase.from('disc_habit_logs').select('id')
        .eq('habit_id', req.params.id).eq('tg_id', req.tg_id).eq('date', d).maybeSingle();

    if (existing) {
        await supabase.from('disc_habit_logs').delete().eq('id', existing.id);
        return res.json({ ok: true, done: false });
    }
    await supabase.from('disc_habit_logs').insert({
        habit_id: req.params.id, tg_id: req.tg_id, date: d, done: true,
    });
    res.json({ ok: true, done: true });
});

app.get('/api/disc/habits/week', authMiddleware, async (req, res) => {
    const { start } = req.query;
    if (!start) return res.status(400).json({ error: 'start required' });

    const sd = new Date(start + 'T12:00:00');
    const ed = new Date(sd); ed.setDate(ed.getDate() + 6);
    const end = localDate(ed);

    const { data: habits } = await supabase.from('disc_habits').select('*')
        .eq('tg_id', req.tg_id).eq('archived', false).order('created_at');
    const { data: logs } = await supabase.from('disc_habit_logs').select('habit_id, date, done')
        .eq('tg_id', req.tg_id).gte('date', start).lte('date', end);

    const map = {};
    (logs || []).forEach(l => { if (l.done) (map[l.habit_id] ||= new Set()).add(l.date); });

    const result = (habits || []).map(h => {
        const done = map[h.id] || new Set();
        const week = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(sd); d.setDate(d.getDate() + i);
            const ds = localDate(d);
            week.push({ date: ds, done: done.has(ds), scheduled: isHabitScheduled(h, ds) });
        }
        return { id: h.id, name: h.name, week };
    });
    res.json({ habits: result });
});

// ==========================================
// ===== DISCIPLINE: ДЕЛА =====
// ==========================================
app.get('/api/disc/todos', authMiddleware, async (req, res) => {
    const { data } = await supabase.from('disc_todos').select('*')
        .eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('done')
        .order('date', { ascending: true, nullsFirst: true })
        .order('created_at');
    res.json({ todos: data || [] });
});

app.post('/api/disc/todos', authMiddleware, async (req, res) => {
    const { name, date, time_start, time_end } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('disc_todos').insert({
        tg_id: req.tg_id,
        name: name.trim(),
        date: date || null,
        time_start: time_start || null,
        time_end: time_end || null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ todo: data });
});

app.patch('/api/disc/todos/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.done !== undefined) updates.done = !!req.body.done;
    if (req.body.date !== undefined) updates.date = req.body.date || null;
    if (req.body.time_start !== undefined) updates.time_start = req.body.time_start || null;
    if (req.body.time_end !== undefined) updates.time_end = req.body.time_end || null;
    const { data, error } = await supabase.from('disc_todos').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ todo: data });
});

app.delete('/api/disc/todos/:id', authMiddleware, async (req, res) => {
    await supabase.from('disc_todos').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== DISCIPLINE: ЦЕЛИ =====
// ==========================================
app.get('/api/disc/areas', authMiddleware, async (req, res) => {
    const { data: areas } = await supabase.from('disc_areas').select('*').eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    const { data: goals } = await supabase.from('disc_goals').select('*').eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    const result = (areas || []).map(a => ({
        ...a,
        goals: (goals || []).filter(g => g.area_id === a.id),
    }));
    res.json({ areas: result, orphanGoals: (goals || []).filter(g => !g.area_id) });
});

app.post('/api/disc/areas', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('disc_areas').insert({ tg_id: req.tg_id, name }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ area: { ...data, goals: [] } });
});

app.patch('/api/disc/areas/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('disc_areas').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ area: data });
});

app.delete('/api/disc/areas/:id', authMiddleware, async (req, res) => {
    await supabase.from('disc_areas').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/disc/goals', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('disc_goals').insert({
        tg_id: req.tg_id, name, area_id: req.body.area_id || null, status: 'plan',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ goal: data });
});

app.patch('/api/disc/goals/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','status','deadline','note'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    const { data, error } = await supabase.from('disc_goals').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ goal: data });
});

app.delete('/api/disc/goals/:id', authMiddleware, async (req, res) => {
    await supabase.from('disc_goals').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== CASH: БЮДЖЕТ =====
// ==========================================
app.get('/api/cash/budget', authMiddleware, async (req, res) => {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const lastDay = new Date(year, month, 0).getDate();
    const weeksInMonth = Math.ceil(lastDay / 7);

    const [budgetR, subsR, weeklyR, customR] = await Promise.all([
        supabase.from('cash_budget').select('*').eq('tg_id', req.tg_id).eq('year', year).eq('month', month).maybeSingle(),
        supabase.from('cash_subs').select('*').eq('tg_id', req.tg_id).eq('active', true).order('sort_order'),
        supabase.from('cash_weekly').select('*').eq('tg_id', req.tg_id).order('sort_order'),
        supabase.from('cash_custom_stats').select('*').eq('tg_id', req.tg_id).order('sort_order').order('created_at'),
    ]);

    const subsTotal = (subsR.data || []).filter(s => !s.paid).reduce((s, x) => s + Number(x.amount || 0), 0);
    const weeklyTotal = (weeklyR.data || []).reduce((s, x) => s + Number(x.amount || 0), 0) * weeksInMonth;
    const budget = budgetR.data || { year, month, budget_amount: 0 };
    const budgetAmount = Number(budget.budget_amount || 0);
    const planned = subsTotal + weeklyTotal;

    const customTotal = (customR.data || []).reduce((s, x) => {
        return s + (x.type === 'percent' ? budgetAmount * Number(x.value || 0) / 100 : Number(x.value || 0));
    }, 0);

    const remaining = budgetAmount - planned - customTotal;

    res.json({
        year, month, weeksInMonth, budget,
        subs: subsR.data || [],
        weekly: weeklyR.data || [],
        customStats: customR.data || [],
        totals: { budget: budgetAmount, subs: subsTotal, weekly: weeklyTotal, planned, customTotal, remaining },
    });
});

app.post('/api/cash/budget', authMiddleware, async (req, res) => {
    const { year, month, budget_amount } = req.body;
    const { data: existing } = await supabase.from('cash_budget').select('id')
        .eq('tg_id', req.tg_id).eq('year', year).eq('month', month).maybeSingle();

    const payload = {
        tg_id: req.tg_id, year, month,
        budget_amount: Number(budget_amount) || 0,
        updated_at: new Date().toISOString(),
    };
    let r;
    if (existing) r = await supabase.from('cash_budget').update(payload).eq('id', existing.id).select().single();
    else r = await supabase.from('cash_budget').insert(payload).select().single();
    if (r.error) return res.status(500).json({ error: r.error.message });
    res.json({ budget: r.data });
});

// Custom stats
app.post('/api/cash/custom-stats', authMiddleware, async (req, res) => {
    const { name, type, value } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_custom_stats').insert({
        tg_id: req.tg_id, name: name.trim(), type: type || 'rub', value: Number(value) || 0,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ stat: data });
});

app.patch('/api/cash/custom-stats/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.type !== undefined) updates.type = req.body.type;
    if (req.body.value !== undefined) updates.value = Number(req.body.value) || 0;
    const { data, error } = await supabase.from('cash_custom_stats').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ stat: data });
});

app.delete('/api/cash/custom-stats/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_custom_stats').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// Subs
app.post('/api/cash/subs', authMiddleware, async (req, res) => {
    const { name, amount } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_subs').insert({
        tg_id: req.tg_id, name: name.trim(), amount: Number(amount) || 0,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sub: data });
});

app.patch('/api/cash/subs/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','amount','paid','active'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (updates.name) updates.name = updates.name.trim();
    if (updates.amount !== undefined) updates.amount = Number(updates.amount) || 0;
    const { data, error } = await supabase.from('cash_subs').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sub: data });
});

app.delete('/api/cash/subs/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_subs').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// Weekly
app.post('/api/cash/weekly', authMiddleware, async (req, res) => {
    const { name, amount } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_weekly').insert({
        tg_id: req.tg_id, name: name.trim(), amount: Number(amount) || 0,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ weekly: data });
});

app.patch('/api/cash/weekly/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.amount !== undefined) updates.amount = Number(req.body.amount) || 0;
    const { data, error } = await supabase.from('cash_weekly').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ weekly: data });
});

app.delete('/api/cash/weekly/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_weekly').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== CASH: WISHLIST =====
// ==========================================
app.get('/api/cash/wishlist', authMiddleware, async (req, res) => {
    const { data: items } = await supabase.from('cash_wishlist').select('*')
        .eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    const { data: areas } = await supabase.from('cash_wishlist_areas').select('*')
        .eq('tg_id', req.tg_id).order('created_at');
    res.json({ items: items || [], areas: areas || [] });
});

app.post('/api/cash/wishlist', authMiddleware, async (req, res) => {
    const { name, price, area, url } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_wishlist').insert({
        tg_id: req.tg_id, name: name.trim(), price: Number(price) || 0,
        area: area || 'Общее', url: url || null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.patch('/api/cash/wishlist/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','area','url','done'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (updates.name) updates.name = updates.name.trim();
    if (req.body.price !== undefined) updates.price = Number(req.body.price) || 0;
    const { data, error } = await supabase.from('cash_wishlist').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/cash/wishlist/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_wishlist').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/cash/wishlist/areas', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_wishlist_areas').insert({
        tg_id: req.tg_id, name: name.trim(),
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ area: data });
});

app.patch('/api/cash/wishlist/areas/:id', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_wishlist_areas').update({ name: name.trim() })
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ area: data });
});

app.delete('/api/cash/wishlist/areas/:id', authMiddleware, async (req, res) => {
    const { data: area } = await supabase.from('cash_wishlist_areas').select('name')
        .eq('id', req.params.id).eq('tg_id', req.tg_id).maybeSingle();
    if (area) {
        await supabase.from('cash_wishlist').delete().eq('tg_id', req.tg_id).eq('area', area.name);
    }
    await supabase.from('cash_wishlist_areas').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== CASH: КОПИЛКА =====
// ==========================================
app.get('/api/cash/piggy', authMiddleware, async (req, res) => {
    const { data: items } = await supabase.from('cash_piggy').select('*')
        .eq('tg_id', req.tg_id).order('date', { ascending: false }).order('created_at', { ascending: false });
    const { data: settings } = await supabase.from('cash_piggy_settings').select('*')
        .eq('tg_id', req.tg_id).maybeSingle();

    let deposited = 0, withdrew = 0;
    (items || []).forEach(x => {
        if (x.type === 'deposit') deposited += Number(x.amount);
        else withdrew += Number(x.amount);
    });
    const balance = deposited - withdrew;
    const fact = Number(settings?.fact_amount || 0);
    const debt = balance - fact;

    res.json({
        items: items || [],
        factAmount: fact,
        totals: { deposited, withdrew, balance, fact, debt },
    });
});

app.post('/api/cash/piggy', authMiddleware, async (req, res) => {
    const { type, amount, description, date } = req.body;
    if (!['deposit','withdraw'].includes(type)) return res.status(400).json({ error: 'invalid type' });
    const { data, error } = await supabase.from('cash_piggy').insert({
        tg_id: req.tg_id, type, amount: Number(amount) || 0,
        description: description || null, date: date || localDate(new Date()),
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.patch('/api/cash/piggy/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.type !== undefined) updates.type = req.body.type;
    if (req.body.amount !== undefined) updates.amount = Number(req.body.amount) || 0;
    if (req.body.description !== undefined) updates.description = req.body.description || null;
    if (req.body.date !== undefined) updates.date = req.body.date || null;
    const { data, error } = await supabase.from('cash_piggy').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/cash/piggy/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_piggy').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/cash/piggy/fact', authMiddleware, async (req, res) => {
    const fact = Number(req.body.fact_amount) || 0;
    const { data: existing } = await supabase.from('cash_piggy_settings').select('tg_id')
        .eq('tg_id', req.tg_id).maybeSingle();
    let r;
    if (existing) {
        r = await supabase.from('cash_piggy_settings').update({ fact_amount: fact, updated_at: new Date().toISOString() })
            .eq('tg_id', req.tg_id).select().single();
    } else {
        r = await supabase.from('cash_piggy_settings').insert({ tg_id: req.tg_id, fact_amount: fact }).select().single();
    }
    if (r.error) return res.status(500).json({ error: r.error.message });
    res.json({ settings: r.data });
});

// ==========================================
// ===== GYM: МЕТРИКИ =====
// ==========================================
app.get('/api/gym/metrics', authMiddleware, async (req, res) => {
    const { data: metrics } = await supabase.from('gym_metrics').select('*')
        .eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    if (!metrics) return res.json({ metrics: [] });

    const { data: logs } = await supabase.from('gym_metric_logs')
        .select('id, metric_id, value, date').eq('tg_id', req.tg_id).order('date', { ascending: true });

    const map = {};
    (logs || []).forEach(l => { (map[l.metric_id] ||= []).push({ id: l.id, value: Number(l.value), date: l.date }); });

    res.json({ metrics: metrics.map(m => ({ ...m, logs: map[m.id] || [] })) });
});

app.post('/api/gym/metrics', authMiddleware, async (req, res) => {
    const { name, category, unit, target } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    if (!['bio','strength'].includes(category)) return res.status(400).json({ error: 'category required' });
    const { data, error } = await supabase.from('gym_metrics').insert({
        tg_id: req.tg_id, name: name.trim(), category,
        unit: unit || 'кг', target: target ? Number(target) : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ metric: { ...data, logs: [] } });
});

app.patch('/api/gym/metrics/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.unit !== undefined) updates.unit = req.body.unit;
    if (req.body.target !== undefined) updates.target = req.body.target ? Number(req.body.target) : null;
    const { data, error } = await supabase.from('gym_metrics').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ metric: data });
});

app.delete('/api/gym/metrics/:id', authMiddleware, async (req, res) => {
    await supabase.from('gym_metrics').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/gym/metrics/:id/logs', authMiddleware, async (req, res) => {
    const { value, date } = req.body;
    if (value === '' || value === null || value === undefined) return res.status(400).json({ error: 'value required' });
    const d = date || localDate(new Date());

    const { data: existing } = await supabase.from('gym_metric_logs').select('id')
        .eq('metric_id', req.params.id).eq('tg_id', req.tg_id).eq('date', d).maybeSingle();

    let r;
    if (existing) {
        r = await supabase.from('gym_metric_logs').update({ value: Number(value) }).eq('id', existing.id).select().single();
    } else {
        r = await supabase.from('gym_metric_logs').insert({
            tg_id: req.tg_id, metric_id: req.params.id, value: Number(value), date: d,
        }).select().single();
    }
    if (r.error) return res.status(500).json({ error: r.error.message });
    res.json({ log: r.data });
});

app.delete('/api/gym/metrics/logs/:logId', authMiddleware, async (req, res) => {
    await supabase.from('gym_metric_logs').delete().eq('id', req.params.logId).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== GYM: ПРОГРАММЫ =====
// ==========================================
app.get('/api/gym/programs', authMiddleware, async (req, res) => {
    const { data: programs } = await supabase.from('gym_programs').select('*')
        .eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    if (!programs) return res.json({ programs: [] });

    const programIds = programs.map(p => p.id);
    const { data: days } = await supabase.from('gym_program_days').select('*')
        .in('program_id', programIds).order('sort_order').order('day_number');
    const dayIds = (days || []).map(d => d.id);

    const { data: exercises } = dayIds.length ? await supabase.from('gym_exercises').select('*')
        .in('day_id', dayIds).order('sort_order') : { data: [] };
    const exerciseIds = (exercises || []).map(e => e.id);

    const { data: sets } = exerciseIds.length ? await supabase.from('gym_exercise_sets').select('*')
        .in('exercise_id', exerciseIds).order('set_number') : { data: [] };

    const setsMap = {};
    (sets || []).forEach(s => { (setsMap[s.exercise_id] ||= []).push(s); });

    const exMap = {};
    (exercises || []).forEach(e => { (exMap[e.day_id] ||= []).push({ ...e, sets: setsMap[e.id] || [] }); });

    const daysMap = {};
    (days || []).forEach(d => { (daysMap[d.program_id] ||= []).push({ ...d, exercises: exMap[d.id] || [] }); });

    res.json({ programs: programs.map(p => ({ ...p, days: daysMap[p.id] || [] })) });
});

app.post('/api/gym/programs', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('gym_programs').insert({
        tg_id: req.tg_id, name,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ program: { ...data, days: [] } });
});

app.patch('/api/gym/programs/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('gym_programs').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ program: data });
});

app.delete('/api/gym/programs/:id', authMiddleware, async (req, res) => {
    const pid = req.params.id;
    const { data: days } = await supabase.from('gym_program_days').select('id').eq('program_id', pid);
    const dayIds = (days || []).map(d => d.id);
    if (dayIds.length) {
        const { data: exercises } = await supabase.from('gym_exercises').select('id').in('day_id', dayIds);
        const exIds = (exercises || []).map(e => e.id);
        if (exIds.length) await supabase.from('gym_exercise_sets').delete().in('exercise_id', exIds);
        await supabase.from('gym_exercises').delete().in('day_id', dayIds);
        await supabase.from('gym_program_days').delete().in('id', dayIds);
    }
    await supabase.from('gym_programs').delete().eq('id', pid).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/gym/programs/:id/days', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data: existing } = await supabase.from('gym_program_days').select('id').eq('program_id', req.params.id);
    const dayNumber = (existing?.length || 0) + 1;
    const { data, error } = await supabase.from('gym_program_days').insert({
        program_id: req.params.id, name, day_number: dayNumber,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ day: { ...data, exercises: [] } });
});

app.patch('/api/gym/days/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('gym_program_days').update(updates)
        .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ day: data });
});

app.delete('/api/gym/days/:id', authMiddleware, async (req, res) => {
    const did = req.params.id;
    const { data: exercises } = await supabase.from('gym_exercises').select('id').eq('day_id', did);
    const exIds = (exercises || []).map(e => e.id);
    if (exIds.length) await supabase.from('gym_exercise_sets').delete().in('exercise_id', exIds);
    await supabase.from('gym_exercises').delete().eq('day_id', did);
    await supabase.from('gym_program_days').delete().eq('id', did);
    res.json({ ok: true });
});

app.post('/api/gym/days/:id/exercises', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data: existing } = await supabase.from('gym_exercises').select('id').eq('day_id', req.params.id);
    const { data, error } = await supabase.from('gym_exercises').insert({
        day_id: req.params.id, name, sort_order: (existing?.length || 0) + 1,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ exercise: { ...data, sets: [] } });
});

app.patch('/api/gym/exercises/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('gym_exercises').update(updates)
        .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ exercise: data });
});

app.delete('/api/gym/exercises/:id', authMiddleware, async (req, res) => {
    await supabase.from('gym_exercise_sets').delete().eq('exercise_id', req.params.id);
    await supabase.from('gym_exercises').delete().eq('id', req.params.id);
    res.json({ ok: true });
});

app.post('/api/gym/exercises/:id/sets', authMiddleware, async (req, res) => {
    const { reps, weight } = req.body;
    const { data: existing } = await supabase.from('gym_exercise_sets').select('id').eq('exercise_id', req.params.id);
    const setNumber = (existing?.length || 0) + 1;
    const { data, error } = await supabase.from('gym_exercise_sets').insert({
        exercise_id: req.params.id,
        set_number: setNumber,
        reps: reps ? parseInt(reps) : null,
        weight: weight ? Number(weight) : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ set: data });
});

app.delete('/api/gym/sets/:id', authMiddleware, async (req, res) => {
    await supabase.from('gym_exercise_sets').delete().eq('id', req.params.id);
    res.json({ ok: true });
});

// ==========================================
// ===== FILM =====
// ==========================================
app.get('/api/film', authMiddleware, async (req, res) => {
    const { data: genres } = await supabase.from('film_genres').select('*').eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    const { data: movies } = await supabase.from('film_movies').select('*')
        .eq('tg_id', req.tg_id).order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });

    const result = (genres || []).map(g => ({
        ...g,
        movies: (movies || []).filter(m => m.genre_id === g.id),
    }));
    const orphans = (movies || []).filter(m => !m.genre_id);
    res.json({ genres: result, orphans });
});

app.post('/api/film/genres', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('film_genres').insert({
        tg_id: req.tg_id, name,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ genre: { ...data, movies: [] } });
});

app.patch('/api/film/genres/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('film_genres').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ genre: data });
});

app.delete('/api/film/genres/:id', authMiddleware, async (req, res) => {
    await supabase.from('film_movies').update({ genre_id: null })
        .eq('genre_id', req.params.id).eq('tg_id', req.tg_id);
    await supabase.from('film_genres').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.delete('/api/film/orphans', authMiddleware, async (req, res) => {
    await supabase.from('film_movies').delete().eq('tg_id', req.tg_id).is('genre_id', null);
    res.json({ ok: true });
});

app.post('/api/film/movies', authMiddleware, async (req, res) => {
    const { title, year, genre_id, status, priority } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const { data, error } = await supabase.from('film_movies').insert({
        tg_id: req.tg_id, title: title.trim(),
        year: year ? parseInt(year) : null,
        genre_id: genre_id || null,
        status: status || 'want',
        priority: priority ? parseInt(priority) : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ movie: data });
});

app.patch('/api/film/movies/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['title','status','review','genre_id'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (updates.title) updates.title = updates.title.trim();
    ['year','priority','rating'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k] ? parseInt(req.body[k]) : null;
    });
    if (req.body.status === 'watched') updates.watched_at = localDate(new Date());

    const { data, error } = await supabase.from('film_movies').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ movie: data });
});

app.delete('/api/film/movies/:id', authMiddleware, async (req, res) => {
    await supabase.from('film_movies').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.get('/api/film/random', authMiddleware, async (req, res) => {
    const type = req.query.type === 'rewatch' ? 'watched' : 'want';
    const { data } = await supabase.from('film_movies').select('*')
        .eq('tg_id', req.tg_id).eq('status', type);
    if (!data?.length) return res.json({ movie: null, type });

    let sorted;
    if (type === 'want') {
        sorted = data.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        const top = sorted[0].priority || 0;
        const pool = sorted.filter(m => (m.priority || 0) === top);
        return res.json({ movie: pool[Math.floor(Math.random() * pool.length)], type });
    } else {
        sorted = data.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        const top = sorted[0].rating || 0;
        const pool = sorted.filter(m => (m.rating || 0) === top);
        return res.json({ movie: pool[Math.floor(Math.random() * pool.length)], type });
    }
});

// ==========================================
// ===== TEA =====
// ==========================================
app.get('/api/tea', authMiddleware, async (req, res) => {
    const { data: groups } = await supabase.from('tea_groups').select('*').eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    const { data: items } = await supabase.from('tea_items').select('*')
        .eq('tg_id', req.tg_id).order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    const { data: shops } = await supabase.from('tea_shops').select('*')
        .eq('tg_id', req.tg_id).order('sort_order').order('created_at');

    const result = (groups || []).map(g => ({
        ...g,
        items: (items || []).filter(i => i.group_id === g.id),
    }));
    const orphans = (items || []).filter(i => !i.group_id);
    res.json({ groups: result, orphans, shops: shops || [] });
});

app.post('/api/tea/groups', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('tea_groups').insert({
        tg_id: req.tg_id, name,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ group: { ...data, items: [] } });
});

app.patch('/api/tea/groups/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('tea_groups').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ group: data });
});

app.delete('/api/tea/groups/:id', authMiddleware, async (req, res) => {
    await supabase.from('tea_items').update({ group_id: null })
        .eq('group_id', req.params.id).eq('tg_id', req.tg_id);
    await supabase.from('tea_groups').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/tea/items', authMiddleware, async (req, res) => {
    const { name, group_id, temp_c, review, rating } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('tea_items').insert({
        tg_id: req.tg_id, name: name.trim(),
        group_id: group_id || null,
        temp_c: temp_c ? String(temp_c).trim() : null,
        review: review || null,
        rating: rating ? parseInt(rating) : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.patch('/api/tea/items/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','group_id','review'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    });
    if (updates.name) updates.name = updates.name.trim();
    if (req.body.temp_c !== undefined) updates.temp_c = req.body.temp_c ? String(req.body.temp_c).trim() : null;
    if (req.body.rating !== undefined) updates.rating = req.body.rating ? parseInt(req.body.rating) : null;
    const { data, error } = await supabase.from('tea_items').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/tea/items/:id', authMiddleware, async (req, res) => {
    await supabase.from('tea_items').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/tea/shops', authMiddleware, async (req, res) => {
    const { name, url } = req.body;
    if (!url?.trim()) return res.status(400).json({ error: 'URL required' });
    const { data, error } = await supabase.from('tea_shops').insert({
        tg_id: req.tg_id, name: (name || '').trim() || null, url: url.trim(),
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ shop: data });
});

app.patch('/api/tea/shops/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = (req.body.name || '').trim() || null;
    if (req.body.url !== undefined) updates.url = req.body.url.trim();
    const { data, error } = await supabase.from('tea_shops').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ shop: data });
});

app.delete('/api/tea/shops/:id', authMiddleware, async (req, res) => {
    await supabase.from('tea_shops').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.delete('/api/tea/orphans', authMiddleware, async (req, res) => {
    await supabase.from('tea_items').delete().eq('tg_id', req.tg_id).is('group_id', null);
    res.json({ ok: true });
});

// ==========================================
// ===== PLACES =====
// ==========================================
app.get('/api/places', authMiddleware, async (req, res) => {
    const { data: types } = await supabase.from('places_types').select('*')
        .eq('tg_id', req.tg_id).order('sort_order').order('created_at');
    const { data: items } = await supabase.from('places_items').select('*')
        .eq('tg_id', req.tg_id).order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });

    const result = (types || []).map(t => ({
        ...t,
        items: (items || []).filter(i => i.type_id === t.id),
    }));
    const orphans = (items || []).filter(i => !i.type_id);
    res.json({ types: result, orphans });
});

app.post('/api/places/types', authMiddleware, async (req, res) => {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('places_types').insert({
        tg_id: req.tg_id, name,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ type: { ...data, items: [] } });
});

app.patch('/api/places/types/:id', authMiddleware, async (req, res) => {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    const { data, error } = await supabase.from('places_types').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ type: data });
});

app.delete('/api/places/types/:id', authMiddleware, async (req, res) => {
    await supabase.from('places_items').update({ type_id: null })
        .eq('type_id', req.params.id).eq('tg_id', req.tg_id);
    await supabase.from('places_types').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.delete('/api/places/orphans', authMiddleware, async (req, res) => {
    await supabase.from('places_items').delete().eq('tg_id', req.tg_id).is('type_id', null);
    res.json({ ok: true });
});

app.post('/api/places/items', authMiddleware, async (req, res) => {
    const { name, type_id, city, country, map_url, status, priority } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('places_items').insert({
        tg_id: req.tg_id, name: name.trim(),
        type_id: type_id || null,
        city: city?.trim() || null,
        country: country?.trim() || null,
        map_url: map_url?.trim() || null,
        status: status || 'want',
        priority: priority ? parseInt(priority) : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.patch('/api/places/items/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','city','country','map_url','status','review'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k] || null;
    });
    if (req.body.type_id !== undefined) updates.type_id = req.body.type_id ? parseInt(req.body.type_id) : null;
    ['priority','rating'].forEach(k => {
        if (req.body[k] !== undefined) updates[k] = req.body[k] ? parseInt(req.body[k]) : null;
    });
    if (req.body.status === 'visited') updates.visited_at = localDate(new Date());
    const { data, error } = await supabase.from('places_items').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/places/items/:id', authMiddleware, async (req, res) => {
    await supabase.from('places_items').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== BACKUP =====
// ==========================================
const BACKUP_SECTIONS = {
    discipline: ['disc_areas','disc_goals','disc_habits','disc_habit_logs','disc_todos'],
    cash: ['cash_budget','cash_custom_stats','cash_subs','cash_weekly','cash_expenses',
           'cash_wishlist_areas','cash_wishlist','cash_piggy','cash_piggy_settings'],
    gym: ['gym_metrics','gym_metric_logs','gym_programs','gym_program_days','gym_exercises','gym_exercise_sets'],
    film: ['film_genres','film_movies'],
    tea: ['tea_groups','tea_items','tea_shops'],
    places: ['places_types','places_items'],
    food: ['food_recipes','food_recipe_ingredients','food_recipe_steps','food_recipe_links',
           'food_products','food_diary','food_goals','food_shopping'],
};

async function collectBackup(tgId, sections) {
    const data = {};
    for (const section of sections) {
        const tables = BACKUP_SECTIONS[section];
        if (!tables) continue;
        data[section] = {};
        for (const table of tables) {
            const { data: rows } = await supabase.from(table).select('*').eq('tg_id', tgId);
            data[section][table] = rows || [];
        }
    }
    return {
        exported_at: new Date().toISOString(),
        tg_id: tgId,
        sections,
        data,
    };
}

app.get('/api/backup/section/:section', authMiddleware, async (req, res) => {
    const section = req.params.section;
    if (!BACKUP_SECTIONS[section]) return res.status(400).json({ error: 'Unknown section' });
    const backup = await collectBackup(req.tg_id, [section]);
    res.json(backup);
});

app.get('/api/backup/all', authMiddleware, async (req, res) => {
    const sections = Object.keys(BACKUP_SECTIONS);
    const backup = await collectBackup(req.tg_id, sections);
    res.json(backup);
});

app.post('/api/backup/save-github', authMiddleware, async (req, res) => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        return res.status(400).json({ error: 'GitHub не настроен. Добавь GITHUB_TOKEN и GITHUB_REPO на сервере.' });
    }
    try {
        const section = req.body.section || 'all';
        const sections = section === 'all' ? Object.keys(BACKUP_SECTIONS) : [section];
        const backup = await collectBackup(req.tg_id, sections);

        const [owner, repo] = GITHUB_REPO.split('/');
        const octokit = new Octokit({ auth: GITHUB_TOKEN });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backups/${req.tg_id}/${section}-${timestamp}.json`;
        const content = Buffer.from(JSON.stringify(backup, null, 2)).toString('base64');

        await octokit.repos.createOrUpdateFileContents({
            owner, repo,
            path: filename,
            message: `backup ${section} ${new Date().toISOString()}`,
            content,
        });

        res.json({ ok: true, file: filename });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/backup/send-tg', authMiddleware, async (req, res) => {
    try {
        const section = req.body.section || 'all';
        const sections = section === 'all' ? Object.keys(BACKUP_SECTIONS) : [section];
        const backup = await collectBackup(req.tg_id, sections);

        const json = JSON.stringify(backup, null, 2);
        const filename = `tracker-${section}-${localDate(new Date())}.json`;

        // Отправка через Telegram Bot API
        const form = new FormData();
        form.append('chat_id', String(req.tg_id));
        form.append('document', new Blob([json], { type: 'application/json' }), filename);
        form.append('caption', `Бекап: ${section}`);

        const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: 'POST',
            body: form,
        });
        const result = await r.json();
        if (!result.ok) throw new Error(result.description || 'Telegram API error');
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ===== УТИЛИТЫ =====
// ==========================================
function localDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function isHabitScheduled(h, dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    if (h.frequency === 'daily') return true;
    if (h.frequency === 'days') return (h.days_of_week || []).includes(dow);
    if (h.frequency === 'interval') {
        const c = new Date(h.created_at); c.setHours(0, 0, 0, 0);
        const t = new Date(dateStr + 'T12:00:00'); t.setHours(0, 0, 0, 0);
        const diff = Math.round((t - c) / (1000 * 60 * 60 * 24));
        return diff >= 0 && diff % (h.interval_days || 2) === 0;
    }
    return true;
}

// ==========================================
// ===== REORDER (для drag & drop) =====
// ==========================================
const REORDER_WHITELIST = [
    'disc_areas','disc_goals','disc_habits','disc_todos',
    'cash_custom_stats','cash_subs','cash_weekly','cash_wishlist','cash_wishlist_areas','cash_piggy',
    'gym_programs','gym_program_days','gym_exercises','gym_metrics',
    'film_genres','film_movies',
    'tea_groups','tea_items','tea_shops',
    'places_types','places_items',
];

app.post('/api/reorder', authMiddleware, async (req, res) => {
    const { table, ids } = req.body;
    if (!REORDER_WHITELIST.includes(table)) return res.status(400).json({ error: 'Table not allowed' });
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
    try {
        for (let i = 0; i < ids.length; i++) {
            await supabase.from(table).update({ sort_order: i + 1 }).eq('id', ids[i]);
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ===== IMPORT =====
// ==========================================
app.post('/api/import/film', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let currentGenreId = null, added = 0, genresAdded = 0;

    const { data: existingGenres } = await supabase.from('film_genres').select('id, name').eq('tg_id', req.tg_id);
    const genreMap = {};
    (existingGenres || []).forEach(g => { genreMap[g.name.toLowerCase()] = g.id; });

    const { data: maxG } = await supabase.from('film_genres').select('sort_order').eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let genreOrder = (maxG?.sort_order || 0) + 1;

    const { data: maxM } = await supabase.from('film_movies').select('sort_order').eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let movieOrder = (maxM?.sort_order || 0) + 1;

    for (const line of lines) {
        if (line.startsWith('#')) {
            const name = line.replace(/^#\s*/, '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (genreMap[key]) currentGenreId = genreMap[key];
            else {
                const { data: g } = await supabase.from('film_genres').insert({
                    tg_id: req.tg_id, name, sort_order: genreOrder++,
                }).select().single();
                if (g) { currentGenreId = g.id; genreMap[key] = g.id; genresAdded++; }
            }
            continue;
        }
        const parts = line.split('|').map(p => p.trim());
        const title = parts[0];
        if (!title) continue;
        const year = parts[1] ? parseInt(parts[1]) : null;
        const prio = parts[2] ? parseInt(parts[2]) : null;
        const { error } = await supabase.from('film_movies').insert({
            tg_id: req.tg_id, genre_id: currentGenreId, title,
            year: isNaN(year) ? null : year,
            priority: (prio >= 1 && prio <= 5) ? prio : null,
            status: 'want', sort_order: movieOrder++,
        });
        if (!error) added++;
    }
    res.json({ added, groupsAdded: genresAdded });
});

app.post('/api/import/tea', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let currentGroupId = null, added = 0, groupsAdded = 0;

    const { data: existing } = await supabase.from('tea_groups').select('id, name').eq('tg_id', req.tg_id);
    const groupMap = {};
    (existing || []).forEach(g => { groupMap[g.name.toLowerCase()] = g.id; });

    const { data: maxG } = await supabase.from('tea_groups').select('sort_order').eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let groupOrder = (maxG?.sort_order || 0) + 1;

    const { data: maxI } = await supabase.from('tea_items').select('sort_order').eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let itemOrder = (maxI?.sort_order || 0) + 1;

    for (const line of lines) {
        if (line.startsWith('#')) {
            const name = line.replace(/^#\s*/, '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (groupMap[key]) currentGroupId = groupMap[key];
            else {
                const { data: g } = await supabase.from('tea_groups').insert({
                    tg_id: req.tg_id, name, sort_order: groupOrder++,
                }).select().single();
                if (g) { currentGroupId = g.id; groupMap[key] = g.id; groupsAdded++; }
            }
            continue;
        }
        const parts = line.split('|').map(p => p.trim());
        const name = parts[0];
        if (!name) continue;
        const temp_c = parts[1] || null;
        const review = parts[2] || null;
        const { error } = await supabase.from('tea_items').insert({
            tg_id: req.tg_id, group_id: currentGroupId, name,
            temp_c: temp_c,
            review: review,
            sort_order: itemOrder++,
        });
        if (!error) added++;
    }
    res.json({ added, groupsAdded });
});

app.post('/api/import/places', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let currentTypeId = null, added = 0, typesAdded = 0;

    const { data: existing } = await supabase.from('places_types').select('id, name').eq('tg_id', req.tg_id);
    const typeMap = {};
    (existing || []).forEach(t => { typeMap[t.name.toLowerCase()] = t.id; });

    const { data: maxT } = await supabase.from('places_types').select('sort_order').eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let typeOrder = (maxT?.sort_order || 0) + 1;

    const { data: maxI } = await supabase.from('places_items').select('sort_order').eq('tg_id', req.tg_id)
        .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let itemOrder = (maxI?.sort_order || 0) + 1;

    for (const line of lines) {
        if (line.startsWith('#')) {
            const name = line.replace(/^#\s*/, '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (typeMap[key]) currentTypeId = typeMap[key];
            else {
                const { data: t } = await supabase.from('places_types').insert({
                    tg_id: req.tg_id, name, sort_order: typeOrder++,
                }).select().single();
                if (t) { currentTypeId = t.id; typeMap[key] = t.id; typesAdded++; }
            }
            continue;
        }
        const parts = line.split('|').map(p => p.trim());
        const name = parts[0];
        if (!name) continue;
        const country = parts[1] || null;
        const city = parts[2] || null;
        const map_url = parts[3] || null;
        const review = parts[4] || null;
        const { error } = await supabase.from('places_items').insert({
            tg_id: req.tg_id, type_id: currentTypeId, name,
            country: country,
            city: city,
            map_url: map_url,
            review: review,
            status: 'want', sort_order: itemOrder++,
        });
        if (!error) added++;
    }
    res.json({ added, groupsAdded: typesAdded });
});

app.post('/api/import/wishlist', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let currentArea = null, added = 0, areasAdded = 0;

    const { data: existing } = await supabase.from('cash_wishlist_areas').select('id, name').eq('tg_id', req.tg_id);
    const areaMap = {};
    (existing || []).forEach(a => { areaMap[a.name.toLowerCase()] = a.name; });

    for (const line of lines) {
        if (line.startsWith('#')) {
            const name = line.replace(/^#\s*/, '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (areaMap[key]) currentArea = areaMap[key];
            else {
                await supabase.from('cash_wishlist_areas').insert({ tg_id: req.tg_id, name });
                areaMap[key] = name;
                currentArea = name;
                areasAdded++;
            }
            continue;
        }
        const parts = line.split('|').map(p => p.trim());
        const title = parts[0];
        if (!title) continue;
        const year = parts[1] ? parseInt(parts[1]) : null;
        const { error } = await supabase.from('film_movies').insert({
            tg_id: req.tg_id, genre_id: currentGenreId, title,
            year: isNaN(year) ? null : year,
            status: 'want', sort_order: movieOrder++,
        });
        if (!error) added++;
    }
    res.json({ added, groupsAdded: areasAdded });
});

app.post('/api/import/todos', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let added = 0;

    for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        const name = parts[0];
        if (!name) continue;
        const dateStr = parts[1] || null;
        let dateVal = null;
        if (dateStr) {
            const m1 = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
            const m2 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m1) dateVal = `20${m1[3]}-${m1[2]}-${m1[1]}`;
            else if (m2) dateVal = dateStr;
        }
        const { error } = await supabase.from('disc_todos').insert({
            tg_id: req.tg_id, name, date: dateVal,
            time_start: parts[2] || null,
            time_end: parts[3] || null,
        });
        if (!error) added++;
    }
    res.json({ added });
});

app.post('/api/import/discipline', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let currentAreaId = null, added = 0, areasAdded = 0;

    const { data: existing } = await supabase.from('disc_areas').select('id, name').eq('tg_id', req.tg_id);
    const areaMap = {};
    (existing || []).forEach(a => { areaMap[a.name.toLowerCase()] = a.id; });

    for (const line of lines) {
        if (line.startsWith('#')) {
            const name = line.replace(/^#\s*/, '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (areaMap[key]) currentAreaId = areaMap[key];
            else {
                const { data: a } = await supabase.from('disc_areas').insert({
                    tg_id: req.tg_id, name,
                }).select().single();
                if (a) { currentAreaId = a.id; areaMap[key] = a.id; areasAdded++; }
            }
            continue;
        }
        const name = line.split('|')[0].trim();
        if (!name) continue;
        const { error } = await supabase.from('disc_goals').insert({
            tg_id: req.tg_id, name, area_id: currentAreaId, status: 'plan',
        });
        if (!error) added++;
    }
    res.json({ added, groupsAdded: areasAdded });
});



// ==========================================
// ===== FOOD / NUTRITION =====
// ==========================================
async function foodEnsureCategory(tg_id, name) {
    const clean = String(name || 'Без категории').trim() || 'Без категории';
    let { data } = await supabase.from('food_categories').select('*').eq('tg_id', tg_id).eq('name', clean).maybeSingle();
    if (!data) {
        const r = await supabase.from('food_categories').insert({ tg_id, name: clean }).select().single();
        data = r.data;
    }
    return data;
}
async function foodHydrateRecipes(tg_id) {
    const { data: recipes=[] } = await supabase.from('food_recipes').select('*').eq('tg_id', tg_id).order('created_at');
    const ids=recipes.map(r=>r.id);
    const { data: links=[] } = ids.length ? await supabase.from('food_recipe_ingredients').select('*').in('recipe_id',ids) : {data:[]};
    const ingredientIds=[...new Set(links.map(x=>x.ingredient_id))];
    const { data: ingredients=[] } = ingredientIds.length ? await supabase.from('food_ingredients').select('*').in('id',ingredientIds).eq('tg_id',tg_id) : {data:[]};
    const im=new Map(ingredients.map(x=>[x.id,x]));
    return recipes.map(r=>{
        const ri=links.filter(x=>x.recipe_id===r.id).map(x=>({ ...x, name:im.get(x.ingredient_id)?.name, unit:im.get(x.ingredient_id)?.unit, ingredient:im.get(x.ingredient_id) })).filter(x=>x.ingredient);
        const base=ri.reduce((a,x)=>{const i=x.ingredient, k=Number(x.amount||0)/Math.max(1,Number(r.servings||1));a.kcal+=Number(i.kcal||0)*Number(x.amount||0)/Math.max(1,Number(r.servings||1));a.protein+=Number(i.protein||0)*Number(x.amount||0)/Math.max(1,Number(r.servings||1));a.fat+=Number(i.fat||0)*Number(x.amount||0)/Math.max(1,Number(r.servings||1));a.carbs+=Number(i.carbs||0)*Number(x.amount||0)/Math.max(1,Number(r.servings||1));return a;},{kcal:0,protein:0,fat:0,carbs:0});
        return {...r, ingredients:ri, ...base};
    });
}

app.get('/api/food', authMiddleware, async (req,res)=>{
    const tg=req.tg_id;
    const [catsR,ingR,recipes,planR,logsR,setR]=await Promise.all([
        supabase.from('food_categories').select('*').eq('tg_id',tg).order('sort_order').order('name'),
        supabase.from('food_ingredients').select('*').eq('tg_id',tg).order('name'),
        foodHydrateRecipes(tg),
        supabase.from('food_plan').select('*').eq('tg_id',tg).order('plan_date').order('meal_type'),
        supabase.from('food_logs').select('*').eq('tg_id',tg).order('eaten_at', {ascending:false}).limit(500),
        supabase.from('food_settings').select('*').eq('tg_id',tg).maybeSingle(),
    ]);
    const categories=catsR.data||[]; const ingredients=ingR.data||[]; const plan=planR.data||[]; const logs=logsR.data||[]; const settings=setR.data||null;
    // Auto-create a few useful categories for a fresh user.
    if(!categories.length){
        for(const name of ['Завтраки','Супы','Обеды','Ужины','Перекусы']) await foodEnsureCategory(tg,name);
    }
    const finalCats=categories.length?categories:(await supabase.from('food_categories').select('*').eq('tg_id',tg).order('sort_order').order('name')).data||[];
    const start=new Date(); start.setHours(0,0,0,0); const end=new Date(start); end.setDate(end.getDate()+30); const endStr=`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
    const plan30=plan.filter(x=>x.plan_date<=endStr);
    const map=new Map();
    for(const p of plan30){const r=recipes.find(x=>Number(x.id)===Number(p.recipe_id)); if(!r)continue; for(const ri of (r.ingredients||[])){const key=ri.ingredient_id; const cur=map.get(key)||{name:ri.name,unit:ri.unit,amount:0}; cur.amount+=Number(ri.amount||0)*Number(p.servings||1); map.set(key,cur);}}
    res.json({categories:finalCats,ingredients,recipes,plan,logs,settings,shopping:[...map.values()]});
});

app.post('/api/food/ingredients', authMiddleware, async (req,res)=>{
    const {name,unit='g',kcal=0,protein=0,fat=0,carbs=0}=req.body||{};
    if(!String(name||'').trim()) return res.status(400).json({error:'Name required'});
    const r=await supabase.from('food_ingredients').upsert({tg_id:req.tg_id,name:String(name).trim(),unit:String(unit||'g').trim(),kcal:Number(kcal)||0,protein:Number(protein)||0,fat:Number(fat)||0,carbs:Number(carbs)||0},{onConflict:'tg_id,name'}).select().single();
    if(r.error)return res.status(400).json({error:r.error.message}); res.json(r.data);
});
app.post('/api/food/recipes', authMiddleware, async (req,res)=>{
    const {name,category_id,description='',servings=1,ingredients=[]}=req.body||{};
    if(!String(name||'').trim())return res.status(400).json({error:'Name required'});
    const cat=category_id?category_id:(await foodEnsureCategory(req.tg_id,'Без категории'))?.id;
    const r=await supabase.from('food_recipes').insert({tg_id:req.tg_id,name:String(name).trim(),category_id:cat,description,servings:Number(servings)||1}).select().single();
    if(r.error)return res.status(400).json({error:r.error.message});
    for(const item of ingredients){ if(!item?.name)continue; const ing=await supabase.from('food_ingredients').upsert({tg_id:req.tg_id,name:String(item.name).trim(),unit:'г'},{onConflict:'tg_id,name'}).select().single(); if(ing.data)await supabase.from('food_recipe_ingredients').insert({recipe_id:r.data.id,ingredient_id:ing.data.id,amount:Number(item.amount)||0}); }
    res.json(r.data);
});
app.patch('/api/food/recipes/:id', authMiddleware, async (req,res)=>{
    const id=req.params.id; const {name,category_id,description='',servings=1,ingredients=[]}=req.body||{};
    const own=await supabase.from('food_recipes').select('id').eq('id',id).eq('tg_id',req.tg_id).maybeSingle(); if(!own.data)return res.status(404).json({error:'Not found'});
    const r=await supabase.from('food_recipes').update({name:String(name||'').trim(),category_id:category_id||null,description,servings:Number(servings)||1,updated_at:new Date().toISOString()}).eq('id',id).eq('tg_id',req.tg_id).select().single();
    await supabase.from('food_recipe_ingredients').delete().eq('recipe_id',id);
    for(const item of ingredients){ if(!item?.name)continue; const ing=await supabase.from('food_ingredients').upsert({tg_id:req.tg_id,name:String(item.name).trim(),unit:'г'},{onConflict:'tg_id,name'}).select().single(); if(ing.data)await supabase.from('food_recipe_ingredients').insert({recipe_id:id,ingredient_id:ing.data.id,amount:Number(item.amount)||0}); }
    res.json(r.data);
});
app.delete('/api/food/recipes/:id', authMiddleware, async(req,res)=>{await supabase.from('food_recipes').delete().eq('id',req.params.id).eq('tg_id',req.tg_id);res.json({ok:true});});
app.post('/api/food/plan', authMiddleware, async(req,res)=>{const {plan_date,meal_type='other',recipe_id,servings=1,note=''}=req.body||{};if(!/^\d{4}-\d{2}-\d{2}$/.test(plan_date||'')||!recipe_id)return res.status(400).json({error:'Invalid plan'});const r=await supabase.from('food_plan').upsert({tg_id:req.tg_id,plan_date,meal_type,recipe_id,servings:Number(servings)||1,note},{onConflict:'tg_id,plan_date,meal_type'}).select().single();if(r.error)return res.status(400).json({error:r.error.message});res.json(r.data);});
app.delete('/api/food/plan/:id', authMiddleware, async(req,res)=>{await supabase.from('food_plan').delete().eq('id',req.params.id).eq('tg_id',req.tg_id);res.json({ok:true});});
app.post('/api/food/logs', authMiddleware, async(req,res)=>{const {meal_type='other',recipe_id,servings=1,note=''}=req.body||{};const r=await supabase.from('food_logs').insert({tg_id:req.tg_id,meal_type,recipe_id:recipe_id||null,servings:Number(servings)||1,note}).select().single();if(r.error)return res.status(400).json({error:r.error.message});res.json(r.data);});
app.delete('/api/food/logs/:id', authMiddleware, async(req,res)=>{await supabase.from('food_logs').delete().eq('id',req.params.id).eq('tg_id',req.tg_id);res.json({ok:true});});
app.post('/api/food/settings', authMiddleware, async(req,res)=>{const {goal='maintain',kcal_target=null,protein_target=null,fat_target=null,carbs_target=null}=req.body||{};const r=await supabase.from('food_settings').upsert({tg_id:req.tg_id,goal,kcal_target,protein_target,fat_target,carbs_target,updated_at:new Date().toISOString()},{onConflict:'tg_id'}).select().single();if(r.error)return res.status(400).json({error:r.error.message});res.json(r.data);});

// ==========================================
// ===== ЗАПУСК =====
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Tracker: http://localhost:${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
});