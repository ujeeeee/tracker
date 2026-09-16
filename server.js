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

        // Сортируем ключи и собираем строку для проверки
        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');

        // Секретный ключ = HMAC_SHA256("WebAppData", bot_token)
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();

        // Проверочный hash
        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        if (calculatedHash !== hash) return null;

        // Возвращаем user
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
    // initData можно передавать в header или в body
    const initData = req.headers['x-init-data'] || req.body?.initData;

    // DEV-режим: если нет initData и мы не в продакшене — используем фейкового юзера
    if (!initData && process.env.NODE_ENV !== 'production') {
        req.user = { id: 999999999, first_name: 'Dev', username: 'dev_user' };
        req.tg_id = 999999999;
        return next();
    }

    const user = verifyInitData(initData);
    if (!user) {
        return res.status(401).json({ error: 'Invalid initData' });
    }

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

    // Проверяем, есть ли юзер в базе
    const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('id', u.id)
        .maybeSingle();

    if (existing) {
        // Обновляем данные (могли поменяться username, first_name, аватарка)
        await supabase
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
    } else {
        // Создаём нового юзера
        await supabase
            .from('users')
            .insert({
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
// ===== ЗАПУСК =====
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Tracker запущен: http://localhost:${PORT}`);
});