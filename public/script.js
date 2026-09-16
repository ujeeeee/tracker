// ==========================================
// ===== СОСТОЯНИЕ =====
// ==========================================
let tgUser = { id: 0, name: 'Друг' };
let initData = '';
let currentUser = null;

// ==========================================
// ===== TELEGRAM INIT =====
// ==========================================
try {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        tgUser.id = tg.initDataUnsafe.user.id;
        tgUser.name = tg.initDataUnsafe.user.first_name
            || tg.initDataUnsafe.user.username
            || 'Друг';
    }
    initData = tg.initData || '';

    if (tg.setHeaderColor) tg.setHeaderColor('#0f0e17');
} catch (e) {
    console.log('Not in Telegram — работаем в браузере');
}

// ==========================================
// ===== API ХЕЛПЕР =====
// ==========================================
async function api(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'x-init-data': initData,
        },
    };
    if (body) opts.body = JSON.stringify({ ...body, initData });

    const res = await fetch(path, opts);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

// ==========================================
// ===== AUTH =====
// ==========================================
async function auth() {
    try {
        const { user } = await api('/api/auth', 'POST');
        currentUser = user;
        tgUser.id = user.id;
        tgUser.name = user.name;

        console.log('✅ Авторизован:', user);
        updateUserUI();
        return true;
    } catch (e) {
        console.error('❌ Ошибка авторизации:', e.message);
        return false;
    }
}

function updateUserUI() {
    document.querySelectorAll('.user-name').forEach(el => {
        el.textContent = tgUser.name;
    });
}

// ==========================================
// ===== УПРАВЛЕНИЕ ЭКРАНАМИ =====
// ==========================================
function showScreen(id, btn) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else {
        const match = document.querySelector(`.nav-btn[data-screen="${id}"]`);
        if (match) match.classList.add('active');
    }

    window.scrollTo(0, 0);
}

// ==========================================
// ===== ПОДВКЛАДКИ =====
// ==========================================
function switchSubTab(parent, tab, btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    const parentScreen = btn.closest('.screen');
    parentScreen.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));

    const target = document.getElementById(`${parent}-${tab}`);
    if (target) target.classList.add('active');
}

// ==========================================
// ===== ШТОРКА "ЕЩЁ" =====
// ==========================================
function openMoreMenu() {
    document.getElementById('moreModal').classList.add('open');
}

function closeMoreMenu(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('moreModal').classList.remove('open');
}

// ==========================================
// ===== HAPTIC =====
// ==========================================
function haptic(type = 'light') {
    try {
        const tg = window.Telegram.WebApp;
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred(type);
    } catch (e) {}
}

document.addEventListener('click', (e) => {
    if (e.target.closest('button')) haptic('light');
});

// ==========================================
// ===== СТАРТ =====
// ==========================================
(async function start() {
    console.log('🚀 Tracker loaded. Telegram user:', tgUser);
    await auth();
})();