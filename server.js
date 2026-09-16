// ==========================================
// ===== ИМПОРТЫ =====
// ==========================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ===== AUTH =====
// ==========================================
function verifyInitData(initData) {
    if (!initData || typeof initData !== 'string') return null;
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) return null;
        params.delete('hash');
        const s = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
        const key = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
        const calc = crypto.createHmac('sha256', key).update(s).digest('hex');
        if (calc !== hash) return null;
        const userRaw = params.get('user');
        if (!userRaw) return null;
        return JSON.parse(userRaw);
    } catch (e) { return null; }
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
        username: u.username || null, first_name: u.first_name || null,
        last_name: u.last_name || null, photo_url: u.photo_url || null,
        language_code: u.language_code || null,
    };
    if (existing) {
        await supabase.from('users').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', u.id);
    } else {
        await supabase.from('users').insert({ id: u.id, ...payload });
    }
    res.json({ ok: true, user: { id: u.id, name: u.first_name || u.username || 'Друг', username: u.username || null } });
});

// ==========================================
// ===== BACKUP =====
// ==========================================
app.get('/api/backup', authMiddleware, async (req, res) => {
    try {
        const tables = ['users','disc_areas','disc_goals','disc_habits','disc_habit_logs',
            'cash_budget','cash_subs','cash_weekly','cash_expenses','cash_wishlist','cash_piggy',
            'cash_custom_stats','cash_piggy_settings',
            'gym_metrics','gym_metric_logs','gym_programs','gym_program_days','gym_exercises','gym_photos','gym_materials',
            'food_recipes','food_recipe_ingredients','food_recipe_steps','food_recipe_links',
            'food_products','food_diary','food_goals','food_shopping',
            'film_genres','film_movies','tea_groups','tea_items','tea_links','places_items','places_photos'];
        const backup = { exported_at: new Date().toISOString(), tg_id: req.tg_id, data: {} };
        for (const table of tables) {
            const column = table === 'users' ? 'id' : (table === 'cash_piggy_settings' ? 'tg_id' : 'tg_id');
            const { data } = await supabase.from(table).select('*').eq(column, req.tg_id);
            backup.data[table] = data || [];
        }
        res.json(backup);
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        .eq('tg_id', req.tg_id).gte('date', since.toISOString().slice(0,10));
    const m = {};
    (logs||[]).forEach(l => { (m[l.habit_id] ||= []).push({ date: l.date, done: l.done }); });
    res.json({ habits: habits.map(h => ({ ...h, logs: m[h.id] || [] })) });
});

app.post('/api/disc/habits', authMiddleware, async (req, res) => {
    const { name, frequency, days_of_week, interval_days } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('disc_habits').insert({
        tg_id: req.tg_id, name: name.trim(),
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
    const d = req.body.date || new Date().toISOString().slice(0,10);
    if (d > new Date().toISOString().slice(0,10)) return res.status(400).json({ error: 'Future not allowed' });
    const { data: existing } = await supabase.from('disc_habit_logs').select('id')
        .eq('habit_id', req.params.id).eq('tg_id', req.tg_id).eq('date', d).maybeSingle();
    if (existing) {
        await supabase.from('disc_habit_logs').delete().eq('id', existing.id);
        return res.json({ ok: true, done: false });
    }
    await supabase.from('disc_habit_logs').insert({ habit_id: req.params.id, tg_id: req.tg_id, date: d, done: true });
    res.json({ ok: true, done: true });
});

// ==========================================
// ===== DISCIPLINE: НЕДЕЛЯ =====
// ==========================================
function isScheduled(h, ds) {
    const d = new Date(ds + 'T00:00:00');
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    if (h.frequency === 'daily') return true;
    if (h.frequency === 'days') return (h.days_of_week || []).includes(dow);
    if (h.frequency === 'interval') {
        const c = new Date(h.created_at); c.setHours(0,0,0,0);
        const t = new Date(ds + 'T00:00:00'); t.setHours(0,0,0,0);
        const diff = Math.round((t-c)/(1000*60*60*24));
        return diff >= 0 && diff % (h.interval_days || 2) === 0;
    }
    return true;
}

app.get('/api/disc/habits/week', authMiddleware, async (req, res) => {
    const { start } = req.query;
    const sd = new Date(start + 'T00:00:00');
    const ed = new Date(sd); ed.setDate(ed.getDate() + 6);
    const end = ed.toISOString().slice(0,10);
    const { data: habits } = await supabase.from('disc_habits').select('*')
        .eq('tg_id', req.tg_id).eq('archived', false).order('created_at');
    const { data: logs } = await supabase.from('disc_habit_logs').select('habit_id, date, done')
        .eq('tg_id', req.tg_id).gte('date', start).lte('date', end);
    const m = {};
    (logs||[]).forEach(l => { if (l.done) (m[l.habit_id] ||= new Set()).add(l.date); });
    const result = (habits||[]).map(h => {
        const done = m[h.id] || new Set();
        const week = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(sd); d.setDate(d.getDate() + i);
            const ds = d.toISOString().slice(0,10);
            week.push({ date: ds, done: done.has(ds), scheduled: isScheduled(h, ds) });
        }
        return { id: h.id, name: h.name, week };
    });
    res.json({ habits: result });
});

app.get('/api/disc/habits/month-stats', authMiddleware, async (req, res) => {
    const now = new Date();
    const y = now.getFullYear(); const mo = now.getMonth()+1;
    const first = `${y}-${String(mo).padStart(2,'0')}-01`;
    const lastDay = new Date(y, mo, 0).getDate();
    const last = `${y}-${String(mo).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const { data: logs } = await supabase.from('disc_habit_logs').select('date')
        .eq('tg_id', req.tg_id).gte('date', first).lte('date', last);
    const counts = {};
    for (let i = 1; i <= lastDay; i++) {
        counts[`${y}-${String(mo).padStart(2,'0')}-${String(i).padStart(2,'0')}`] = 0;
    }
    (logs||[]).forEach(l => { if (counts[l.date] !== undefined) counts[l.date]++; });
    res.json({ year: y, month: mo, days: Object.entries(counts).map(([date, count]) => ({ date, count })) });
});

// ==========================================
// ===== DISCIPLINE: ЦЕЛИ =====
// ==========================================
app.get('/api/disc/areas', authMiddleware, async (req, res) => {
    const { data: areas } = await supabase.from('disc_areas').select('*').eq('tg_id', req.tg_id).order('created_at');
    const { data: goals } = await supabase.from('disc_goals').select('*').eq('tg_id', req.tg_id).order('created_at');
    const result = (areas||[]).map(a => ({ ...a, goals: (goals||[]).filter(g => g.area_id === a.id) }));
    res.json({ areas: result, orphanGoals: (goals||[]).filter(g => !g.area_id) });
});

app.post('/api/disc/areas', authMiddleware, async (req, res) => {
    const { data, error } = await supabase.from('disc_areas').insert({ tg_id: req.tg_id, name: req.body.name.trim() }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ area: { ...data, goals: [] } });
});

app.delete('/api/disc/areas/:id', authMiddleware, async (req, res) => {
    await supabase.from('disc_areas').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/disc/goals', authMiddleware, async (req, res) => {
    const { data, error } = await supabase.from('disc_goals').insert({
        tg_id: req.tg_id, name: req.body.name.trim(), area_id: req.body.area_id || null, status: 'plan',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ goal: data });
});

app.patch('/api/disc/goals/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','status','deadline','note'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
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
// ===== HOME =====
// ==========================================
app.get('/api/home', authMiddleware, async (req, res) => {
    const today = new Date().toISOString().slice(0,10);
    const { data: habits } = await supabase.from('disc_habits').select('*').eq('tg_id', req.tg_id).eq('archived', false);
    const since = new Date(); since.setDate(since.getDate() - 60);
    const { data: logs } = await supabase.from('disc_habit_logs').select('habit_id, date, done')
        .eq('tg_id', req.tg_id).gte('date', since.toISOString().slice(0,10));
    const m = {};
    (logs||[]).forEach(l => { (m[l.habit_id] ||= []).push(l); });

    function calcStreak(ls) {
        const done = new Set(ls.filter(l => l.done).map(l => l.date));
        let s = 0; const d = new Date();
        while (true) {
            const k = d.toISOString().slice(0,10);
            if (done.has(k)) { s++; d.setDate(d.getDate()-1); } else break;
        }
        return s;
    }

    const habitsWithLogs = (habits||[]).map(h => ({
        id: h.id, name: h.name,
        doneToday: (m[h.id]||[]).some(l => l.date === today && l.done),
        streak: calcStreak(m[h.id]||[]),
    }));

    const { data: areas } = await supabase.from('disc_areas').select('*').eq('tg_id', req.tg_id);
    const { data: goals } = await supabase.from('disc_goals').select('id, area_id, status').eq('tg_id', req.tg_id);
    const areasStats = (areas||[]).map(a => {
        const gs = (goals||[]).filter(g => g.area_id === a.id);
        return { id: a.id, name: a.name, total: gs.length, done: gs.filter(g => g.status === 'done').length };
    });

    res.json({ today, habits: habitsWithLogs, areas: areasStats });
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
        supabase.from('cash_subs').select('*').eq('tg_id', req.tg_id).eq('active', true),
        supabase.from('cash_weekly').select('*').eq('tg_id', req.tg_id),
        supabase.from('cash_custom_stats').select('*').eq('tg_id', req.tg_id).order('sort_order').order('created_at'),
    ]);

    const subsTotal = (subsR.data||[]).reduce((s,x) => s + Number(x.amount||0), 0);
    const weeklyTotal = (weeklyR.data||[]).reduce((s,x) => s + Number(x.amount||0), 0) * weeksInMonth;
    const budget = budgetR.data || { year, month, budget_amount: 0, invest_amount: 0, piggy_amount: 0 };
    const planned = subsTotal + weeklyTotal;
    const remaining = Number(budget.budget_amount||0) - planned;

    res.json({
        year, month, weeksInMonth, budget,
        subs: subsR.data || [],
        weekly: weeklyR.data || [],
        customStats: customR.data || [],
        totals: { budget: Number(budget.budget_amount||0), subs: subsTotal, weekly: weeklyTotal, planned, remaining },
    });
});

app.post('/api/cash/budget', authMiddleware, async (req, res) => {
    const { year, month, budget_amount, invest_amount, piggy_amount } = req.body;
    const { data: existing } = await supabase.from('cash_budget').select('id')
        .eq('tg_id', req.tg_id).eq('year', year).eq('month', month).maybeSingle();
    const payload = {
        tg_id: req.tg_id, year, month,
        budget_amount: Number(budget_amount)||0,
        invest_amount: Number(invest_amount)||0,
        piggy_amount: Number(piggy_amount)||0,
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
        tg_id: req.tg_id, name: name.trim(), type: type || 'rub', value: Number(value)||0,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ stat: data });
});

app.delete('/api/cash/custom-stats/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_custom_stats').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// Subs (ежемесячные)
app.post('/api/cash/subs', authMiddleware, async (req, res) => {
    const { name, amount } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_subs').insert({
        tg_id: req.tg_id, name: name.trim(), amount: Number(amount)||0,
    }).select().single();
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
        tg_id: req.tg_id, name: name.trim(), amount: Number(amount)||0,
    }).select().single();
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
    const { data } = await supabase.from('cash_wishlist').select('*').eq('tg_id', req.tg_id).order('created_at');
    res.json({ items: data || [] });
});

app.post('/api/cash/wishlist', authMiddleware, async (req, res) => {
    const { name, price, area, url } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase.from('cash_wishlist').insert({
        tg_id: req.tg_id, name: name.trim(), price: Number(price)||0,
        area: area || 'Общее', url: url || null, priority: 'important_not_urgent',
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.patch('/api/cash/wishlist/:id', authMiddleware, async (req, res) => {
    const updates = {};
    ['name','price','area','url','done'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('cash_wishlist').update(updates)
        .eq('id', req.params.id).eq('tg_id', req.tg_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/cash/wishlist/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_wishlist').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

// ==========================================
// ===== CASH: КОПИЛКА =====
// ==========================================
app.get('/api/cash/piggy', authMiddleware, async (req, res) => {
    const { data: items } = await supabase.from('cash_piggy').select('*')
        .eq('tg_id', req.tg_id).order('date', { ascending: false }).order('created_at', { ascending: false });
    const { data: settings } = await supabase.from('cash_piggy_settings').select('*').eq('tg_id', req.tg_id).maybeSingle();

    let deposited = 0, withdrew = 0;
    (items||[]).forEach(x => {
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
        tg_id: req.tg_id, type, amount: Number(amount)||0,
        description: description || null, date: date || new Date().toISOString().slice(0,10),
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
});

app.delete('/api/cash/piggy/:id', authMiddleware, async (req, res) => {
    await supabase.from('cash_piggy').delete().eq('id', req.params.id).eq('tg_id', req.tg_id);
    res.json({ ok: true });
});

app.post('/api/cash/piggy/fact', authMiddleware, async (req, res) => {
    const fact = Number(req.body.fact_amount) || 0;
    const { data: existing } = await supabase.from('cash_piggy_settings').select('tg_id').eq('tg_id', req.tg_id).maybeSingle();
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
// ===== ЗАПУСК =====
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Tracker: http://localhost:${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
});