// ==========================================
// ===== СОСТОЯНИЕ =====
// ==========================================
let tgUser = { id: 0, name: 'Друг' };
let initData = '';
let currentUser = null;
let tg = null;

const TOTAL_MAIN_SCREENS = 7; // без settings
let currentScreenIndex = 0;

// ==========================================
// ===== TELEGRAM INIT =====
// ==========================================
try {
    tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        tgUser.id = tg.initDataUnsafe.user.id;
        tgUser.name = tg.initDataUnsafe.user.first_name
            || tg.initDataUnsafe.user.username
            || 'Друг';
    }
    initData = tg.initData || '';

    if (tg.onEvent) {
        tg.onEvent('themeChanged', () => {
            if (getThemeMode() === 'auto') applyTheme(tg.colorScheme);
        });
    }

    // Свайп через BackButton, если пользователь вернулся из настроек
    if (tg.BackButton) {
        tg.BackButton.onClick(() => closeSettings());
    }
} catch (e) {
    console.log('Not in Telegram — работаем в браузере');
}

initTheme();

// ==========================================
// ===== ТЕМА =====
// ==========================================
function getThemeMode() {
    return localStorage.getItem('theme_mode') || 'auto';
}

function initTheme() {
    const mode = getThemeMode();
    const scheme = mode === 'auto' ? ((tg && tg.colorScheme) || 'dark') : mode;
    applyTheme(scheme);
    updateThemeButtons(mode);
}

function applyTheme(scheme) {
    const theme = scheme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    try {
        if (tg && tg.setHeaderColor) {
            tg.setHeaderColor(theme === 'light' ? '#f2f2f7' : '#0a0a0c');
        }
        if (tg && tg.setBackgroundColor) {
            tg.setBackgroundColor(theme === 'light' ? '#f2f2f7' : '#0a0a0c');
        }
    } catch (e) {}
}

function setThemeMode(mode, btn) {
    localStorage.setItem('theme_mode', mode);
    initTheme();
    if (btn) {
        document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

function updateThemeButtons(mode) {
    document.querySelectorAll('.theme-option').forEach(b => {
        b.classList.toggle('active', b.dataset.themeValue === mode);
    });
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
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
        updateSettingsUI();
        return true;
    } catch (e) {
        console.error('❌ Ошибка авторизации:', e.message);
        return false;
    }
}

// ==========================================
// ===== СВАЙП МЕЖДУ ЭКРАНАМИ =====
// ==========================================
const track = document.getElementById('screensTrack');
const pages = track.querySelectorAll('.screen');

function initScreens() {
    // Показываем только 8 главных страниц + settings в конце
    pages.forEach((p, i) => {
        if (i < TOTAL_MAIN_SCREENS || p.dataset.screenName === 'Settings') return;
    });

    goToScreen(0, false);
}

function goToScreen(index, animate = true) {
    if (index < 0 || index >= TOTAL_MAIN_SCREENS) return;
    currentScreenIndex = index;

    if (!animate) track.style.transition = 'none';
    track.style.transform = `translateX(-${index * 100}vw)`;
    if (!animate) setTimeout(() => track.style.transition = '', 20);

    // Нижнее меню
    document.querySelectorAll('.nav-btn').forEach(b => {
        const idx = b.dataset.index;
        b.classList.toggle('active', idx !== undefined && parseInt(idx) === index);
    });

    // Подкрутка нижнего меню к активной кнопке
    const nav = document.getElementById('bottomNav');
    const btn = nav.querySelector(`.nav-btn[data-index="${index}"]`);
    if (nav && btn) {
        const target = btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;
        nav.scrollTo({ left: target, behavior: animate ? 'smooth' : 'auto' });
    }

    window.scrollTo(0, 0);
}

// Свайпы
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;

document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        touchMoved = true;
    }
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (!touchMoved) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) goToScreen(currentScreenIndex + 1);
        else goToScreen(currentScreenIndex - 1);
    }
}, { passive: true });

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
// ===== НАСТРОЙКИ =====
// ==========================================
function openSettings() {
    updateSettingsUI();
    // Скроллим на экран настроек (последний)
    track.style.transform = `translateX(-${TOTAL_MAIN_SCREENS * 100}vw)`;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    window.scrollTo(0, 0);
}

function closeSettings() {
    goToScreen(currentScreenIndex);
}

function updateSettingsUI() {
    const name = currentUser?.name || tgUser.name || 'Друг';
    const el = document.getElementById('settingsUserName');
    if (el) el.textContent = name;

    const idEl = document.getElementById('settingsUserId');
    if (idEl) idEl.textContent = 'ID: ' + (currentUser?.id || tgUser.id || '—');

    const avEl = document.getElementById('settingsAvatar');
    if (avEl) avEl.textContent = (name[0] || '?').toUpperCase();

    updateThemeButtons(getThemeMode());
}

// ==========================================
// ===== БЕКАП =====
// ==========================================
async function exportBackup() {
    try {
        const data = await api('/api/backup');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Ошибка бекапа: ' + e.message);
    }
}

function showInfo() {
    alert('Tracker v1.0\nТвой личный трекер жизни.\n\nВ разработке 🚧');
}

function confirmLogout() {
    if (confirm('Выйти из аккаунта? Данные останутся в базе.')) {
        alert('Выход пока не реализован');
    }
}


// ==========================================
// ===== HAPTIC =====
// ==========================================
function haptic(type = 'light') {
    try {
        if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(type);
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
    initScreens();
    await auth();
})();