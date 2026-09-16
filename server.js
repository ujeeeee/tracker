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
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const { data, error } = await supabase
        .from('disc_habits').insert({ tg_id: req.tg_id, name: name.trim() })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ habit: { ...data, logs: [] } });
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
        .gte('date', start)
        .lte('date', end);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: logs || [] });
});

// ==========================================
// ===== DISCIPLINE: КАЛЕНДАРЬ ПРИВЫЧКИ =====
// ==========================================
app.get('/api/disc/habits/:id/month', authMiddleware, async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year & month required' });

    const y = parseInt(year);
    const m = parseInt(month); // 1-12
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { data: logs, error } = await supabase
        .from('disc_habit_logs')
        .select('date, done')
        .eq('habit_id', req.params.id)
        .eq('tg_id', req.tg_id)
        .gte('date', start)
        .lte('date', end);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: logs || [] });
});

// ==========================================
// ===== HOME: ДАШБОРД =====
// ==========================================
app.get('/api/home', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);

        const { data: habits } = await supabase
            .from('disc_habits')
            .select('*')
            .eq('tg_id', req.tg_id)
            .eq('archived', false)
            .order('created_at', { ascending: true });

        const since = new Date();
        since.setDate(since.getDate() - 60);

        const { data: logs } = await supabase
            .from('disc_habit_logs')
            .select('habit_id, date, done')
            .eq('tg_id', req.tg_id)
            .gte('date', since.toISOString().slice(0, 10));

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

        // Цели по областям
        const { data: areas } = await supabase
            .from('disc_areas')
            .select('*')
            .eq('tg_id', req.tg_id)
            .order('sort_order', { ascending: true });

        const { data: goals } = await supabase
            .from('disc_goals')
            .select('id, area_id, status')
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

        res.json({
            today,
            habits: habitsWithLogs,
            areas: areasStats,
        });
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
// ===== ЗАПУСК =====
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Tracker запущен: http://localhost:${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`BOT_TOKEN: ${BOT_TOKEN ? 'есть' : 'НЕТ!'}`);
    console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? 'есть' : 'НЕТ!'}`);
});