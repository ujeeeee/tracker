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

        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

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

    console.log('📨 initData получен, длина:', initData?.length || 0);

    const user = verifyInitData(initData);
    if (!user) {
        console.log('❌ initData не прошёл проверку');
        return res.status(401).json({ error: 'Invalid initData' });
    }

    console.log('✅ initData валиден, user.id =', user.id);

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
// ===== DEBUG =====
// ==========================================
app.get('/api/debug', async (req, res) => {
    const { data, error } = await supabase.from('users').select('*').limit(5);
    res.json({
        hasUrl: !!process.env.SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_SECRET_KEY,
        hasBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
        nodeEnv: process.env.NODE_ENV,
        usersCount: data?.length ?? null,
        users: data ?? null,
        error: error?.message ?? null,
    });
});

// ==========================================
// ===== AUTH =====
// ==========================================
app.post('/api/auth', authMiddleware, async (req, res) => {
    const u = req.user;
    console.log('🔐 AUTH для user:', u.id, u.first_name);

    const { data: existing, error: findErr } = await supabase
        .from('users')
        .select('id')
        .eq('id', u.id)
        .maybeSingle();

    if (findErr) {
        console.error('❌ Ошибка поиска:', findErr.message);
        return res.status(500).json({ error: 'DB find error: ' + findErr.message });
    }

    if (existing) {
        const { error: updErr } = await supabase
            .from('users')
            .update({
                username: u.username || null,
                first_name: u.first_name || null,
                last_name: u.last_name || null,
                photo_url: u.photo_url || null,
                language_code: u.language_code || null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', u.id);

        if (updErr) {
            console.error('❌ Ошибка обновления:', updErr.message);
            return res.status(500).json({ error: 'DB update error: ' + updErr.message });
        }
        console.log('✅ Юзер обновлён:', u.id);
    } else {
        const { error: insErr } = await supabase
            .from('users')
            .insert({
                id: u.id,
                username: u.username || null,
                first_name: u.first_name || null,
                last_name: u.last_name || null,
                photo_url: u.photo_url || null,
                language_code: u.language_code || null,
            });

        if (insErr) {
            console.error('❌ Ошибка вставки:', insErr.message);
            return res.status(500).json({ error: 'DB insert error: ' + insErr.message });
        }
        console.log('✅ Юзер создан:', u.id);
    }

    res.json({
        ok: true,
        user: {
            id: u.id,
            name: u.first_name || u.username || 'Друг',
            username: u.username || null,
        },
    });
});

// ==========================================
// ===== ME =====
// ==========================================
app.get('/api/me', authMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.tg_id)
        .maybeSingle();

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

        const backup = {
            exported_at: new Date().toISOString(),
            tg_id: req.tg_id,
            data: {},
        };

        for (const table of tables) {
            const column = table === 'users' ? 'id' : 'tg_id';
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .eq(column, req.tg_id);

            if (!error) backup.data[table] = data || [];
        }

        res.json(backup);
    } catch (e) {
        console.error('Backup error:', e);
        res.status(500).json({ error: e.message });
    }
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