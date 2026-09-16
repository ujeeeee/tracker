// ==========================================
// ===== СОСТОЯНИЕ =====
// ==========================================
let tgUser = { id: 0, name: 'Друг' };
let initData = '';
let currentUser = null;
let tg = null;

const TOTAL_MAIN_SCREENS = 8; // Home + 7
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
    if (tg.BackButton) {
        tg.BackButton.onClick(() => closeSettings());
    }
} catch (e) {
    console.log('Not in Telegram');
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
        if (tg && tg.setHeaderColor) tg.setHeaderColor(theme === 'light' ? '#f2f2f7' : '#0a0a0c');
        if (tg && tg.setBackgroundColor) tg.setBackgroundColor(theme === 'light' ? '#f2f2f7' : '#0a0a0c');
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
// ===== API =====
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
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Server returned HTML instead of JSON'); }
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
        updateSettingsUI();
        return true;
    } catch (e) {
        console.error('Auth error:', e.message);
        return false;
    }
}

// ==========================================
// ===== СВАЙП ЭКРАНОВ =====
// ==========================================
const track = document.getElementById('screensTrack');

function initScreens() {
    goToScreen(0, false);
}

function goToScreen(index, animate = true) {
    if (index < 0 || index >= TOTAL_MAIN_SCREENS) return;
    currentScreenIndex = index;

    if (!animate) track.style.transition = 'none';
    track.style.transform = `translateX(-${index * 100}vw)`;
    if (!animate) setTimeout(() => track.style.transition = '', 20);

    document.querySelectorAll('.nav-btn').forEach(b => {
        const idx = b.dataset.index;
        b.classList.toggle('active', idx !== undefined && parseInt(idx) === index);
    });

    const nav = document.getElementById('bottomNav');
    const btn = nav.querySelector(`.nav-btn[data-index="${index}"]`);
    if (nav && btn) {
        const target = btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;
        nav.scrollTo({ left: target, behavior: animate ? 'smooth' : 'auto' });
    }

    window.scrollTo(0, 0);

    if (index === 0 && typeof loadHome === 'function') loadHome();
    if (index === 1) {
        if (typeof loadHabits === 'function') loadHabits();
        if (typeof loadAreas === 'function') loadAreas();
    }
}

let touchStartX = 0, touchStartY = 0, touchMoved = false;

document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) touchMoved = true;
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

// ==========================================
// ===== HOME / ДАШБОРД =====
// ==========================================
async function loadHome() {
    try {
        const data = await api('/api/home');
        renderHome(data);
    } catch (e) {
        console.error('loadHome:', e);
    }
}

function renderHome(data) {
    renderGreeting();
    const widgets = document.getElementById('homeWidgets');
    if (!widgets) return;

    const habitsToday = data.habits.filter(h => h.doneToday).length;
    const habitsTotal = data.habits.length;

    let html = '';

    // Статистика
    if (habitsTotal > 0) {
        html += `
            <div class="stats-row">
                <div class="stat-box">
                    <div class="stat-box-value">${habitsToday}/${habitsTotal}</div>
                    <div class="stat-box-label">Сегодня</div>
                </div>
                <div class="stat-box">
                    <div class="stat-box-value">${data.habits.reduce((m, h) => Math.max(m, h.streak), 0)}</div>
                    <div class="stat-box-label">🔥 Рекорд</div>
                </div>
            </div>
        `;
    }

    // Привычки сегодня
    html += `<div class="widget">
        <div class="widget-title">
            <span>Привычки сегодня</span>
            ${habitsTotal > 0 ? `<span class="widget-title-count">${habitsToday}/${habitsTotal}</span>` : ''}
        </div>`;

    if (habitsTotal === 0) {
        html += `<div class="widget-empty">Пока нет привычек. Добавь в Discipline →</div>`;
    } else {
        html += `<div class="habits-today-list">`;
        data.habits.forEach(h => {
            html += `
                <button class="habit-quick ${h.doneToday ? 'done' : ''}" onclick="quickToggleHabit(${h.id})">
                    <div class="habit-quick-check">✓</div>
                    <div class="habit-quick-name">${escapeHtml(h.name)}</div>
                    ${h.streak > 0 ? `<div class="habit-quick-streak">🔥 ${h.streak}</div>` : ''}
                </button>
            `;
        });
        html += `</div>`;
    }
    html += `</div>`;

    // Прогресс областей
    const areasWithGoals = data.areas.filter(a => a.total > 0);
    html += `<div class="widget">
        <div class="widget-title"><span>Прогресс целей</span></div>`;

    if (areasWithGoals.length === 0) {
        html += `<div class="widget-empty">Пока нет целей. Добавь в Discipline →</div>`;
    } else {
        areasWithGoals.forEach(a => {
            const pct = a.total > 0 ? (a.done / a.total * 100) : 0;
            html += `
                <div class="area-progress-row">
                    <div class="area-progress-name">${escapeHtml(a.name)}</div>
                    <div class="area-progress-bar"><div class="area-progress-fill" style="width:${pct}%"></div></div>
                    <div class="area-progress-count">${a.done}/${a.total}</div>
                </div>
            `;
        });
    }
    html += `</div>`;

    widgets.innerHTML = html;
}

function renderGreeting() {
    const h = new Date().getHours();
    let greeting = 'Привет';
    if (h < 6) greeting = 'Доброй ночи';
    else if (h < 12) greeting = 'Доброе утро';
    else if (h < 18) greeting = 'Добрый день';
    else greeting = 'Добрый вечер';

    const gEl = document.getElementById('homeGreeting');
    if (gEl) gEl.textContent = `${greeting}, ${tgUser.name}`;

    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const d = new Date();
    const dEl = document.getElementById('homeDate');
    if (dEl) dEl.textContent = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

async function quickToggleHabit(id) {
    try {
        const today = new Date().toISOString().slice(0, 10);
        await api(`/api/disc/habits/${id}/toggle`, 'POST', { date: today });
        await loadHome();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ==========================================
// ===== DISCIPLINE: ПРИВЫЧКИ =====
// ==========================================
let habits = [];

async function loadHabits() {
    try {
        const { habits: data } = await api('/api/disc/habits');
        habits = data;
        renderHabits();
    } catch (e) {
        console.error('loadHabits:', e);
    }
}

function renderHabits() {
    const container = document.getElementById('habitsList');
    if (!container) return;
    if (habits.length === 0) {
        container.innerHTML = `<div class="empty-state">Пока нет привычек.<br>Добавь первую 👆</div>`;
        return;
    }
    const today = new Date().toISOString().slice(0, 10);
    container.innerHTML = habits.map(h => {
        const doneToday = h.logs.some(l => l.date === today && l.done);
        const streak = calcStreak(h.logs);
        const days = last7Days(h.logs);
        const heat = days.map(d => {
            const cls = d.done ? 'done' : '';
            const isToday = d.date === today ? 'today' : '';
            return `<div class="heat-cell ${cls} ${isToday}"></div>`;
        }).join('');
        return `
            <div class="habit-card">
                <div class="habit-top" onclick="openCalendar(${h.id})" style="cursor:pointer">
                    <div class="habit-name">${escapeHtml(h.name)}</div>
                    ${streak > 0 ? `<div class="habit-streak">🔥 ${streak}</div>` : ''}
                    <button class="habit-delete" onclick="event.stopPropagation(); deleteHabit(${h.id})">✕</button>
                </div>
                <div class="habit-bottom">
                    <div class="habit-heatmap" onclick="openCalendar(${h.id})" style="cursor:pointer">${heat}</div>
                    <button class="habit-toggle ${doneToday ? 'done' : ''}" onclick="toggleHabit(${h.id})">
                        ${doneToday ? '✓' : '○'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

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

function last7Days(logs) {
    const done = new Set(logs.filter(l => l.done).map(l => l.date));
    const arr = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
        const key = d.toISOString().slice(0, 10);
        arr.push({ date: key, done: done.has(key) });
        d.setDate(d.getDate() + 1);
    }
    return arr;
}

async function toggleHabit(id) {
    try {
        const today = new Date().toISOString().slice(0, 10);
        await api(`/api/disc/habits/${id}/toggle`, 'POST', { date: today });
        await loadHabits();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function deleteHabit(id) {
    if (!confirm('Удалить привычку?')) return;
    try {
        await api(`/api/disc/habits/${id}`, 'DELETE');
        await loadHabits();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ==========================================
// ===== КАЛЕНДАРЬ ПРИВЫЧКИ =====
// ==========================================
let calState = { habitId: null, habitName: '', year: 0, month: 0, logs: new Set() };

async function openCalendar(habitId) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit) return;

    const now = new Date();
    calState.habitId = habitId;
    calState.habitName = habit.name;
    calState.year = now.getFullYear();
    calState.month = now.getMonth() + 1;

    document.getElementById('calTitle').textContent = habit.name;
    document.getElementById('calendarModal').classList.add('open');

    await loadCalMonth();
}

async function loadCalMonth() {
    try {
        const { logs } = await api(`/api/disc/habits/${calState.habitId}/month?year=${calState.year}&month=${calState.month}`);
        calState.logs = new Set(logs.filter(l => l.done).map(l => l.date));
        renderCalendar();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

function renderCalendar() {
    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    document.getElementById('calMonth').textContent = `${monthNames[calState.month - 1]} ${calState.year}`;

    const firstDay = new Date(calState.year, calState.month - 1, 1);
    const lastDay = new Date(calState.year, calState.month, 0).getDate();
    const startWeekday = (firstDay.getDay() + 6) % 7; // Пн = 0

    const today = new Date().toISOString().slice(0, 10);
    const grid = document.getElementById('calGrid');
    let html = '';

    for (let i = 0; i < startWeekday; i++) {
        html += `<div class="cal-day empty"></div>`;
    }

    let doneCount = 0;
    for (let d = 1; d <= lastDay; d++) {
        const dateStr = `${calState.year}-${String(calState.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isDone = calState.logs.has(dateStr);
        const isToday = dateStr === today;
        const isFuture = dateStr > today;
        if (isDone) doneCount++;

        let cls = 'cal-day';
        if (isDone) cls += ' done';
        if (isToday) cls += ' today';
        if (isFuture) cls += ' future';

        const onclick = isFuture ? '' : `onclick="calToggle('${dateStr}')"`;
        html += `<div class="${cls}" ${onclick}>${d}</div>`;
    }

    grid.innerHTML = html;
    document.getElementById('calStats').textContent = `Выполнено: ${doneCount} / ${lastDay} дней`;
}

async function calToggle(dateStr) {
    try {
        await api(`/api/disc/habits/${calState.habitId}/toggle`, 'POST', { date: dateStr });
        // Обновляем локально без перезагрузки месяца
        if (calState.logs.has(dateStr)) calState.logs.delete(dateStr);
        else calState.logs.add(dateStr);
        renderCalendar();
        // Обновим и список привычек под календарём (когда закроют)
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

function calPrev() {
    calState.month--;
    if (calState.month < 1) { calState.month = 12; calState.year--; }
    loadCalMonth();
}

function calNext() {
    calState.month++;
    if (calState.month > 12) { calState.month = 1; calState.year++; }
    loadCalMonth();
}

async function closeCalendar() {
    document.getElementById('calendarModal').classList.remove('open');
    await loadHabits();
}

// ==========================================
// ===== DISCIPLINE: ЦЕЛИ =====
// ==========================================
let areas = [];

async function loadAreas() {
    try {
        const { areas: data, orphanGoals } = await api('/api/disc/areas');
        areas = data;
        renderAreas(orphanGoals);
    } catch (e) {
        console.error('loadAreas:', e);
    }
}

function renderAreas(orphanGoals = []) {
    const container = document.getElementById('areasList');
    if (!container) return;
    if (areas.length === 0 && orphanGoals.length === 0) {
        container.innerHTML = `<div class="empty-state">Пока нет областей.<br>Добавь первую 👆</div>`;
        return;
    }
    let html = areas.map(a => {
        const goals = a.goals || [];
        const done = goals.filter(g => g.status === 'done').length;
        const progress = goals.length > 0 ? `${done}/${goals.length}` : '';
        const goalsHtml = goals.map(g => `
            <div class="goal-item">
                <div class="goal-check ${g.status === 'done' ? 'done' : ''}"
                     onclick="toggleGoal(${g.id}, '${g.status}')">✓</div>
                <div class="goal-name ${g.status === 'done' ? 'done' : ''}">${escapeHtml(g.name)}</div>
                <button class="goal-delete" onclick="deleteGoal(${g.id})">✕</button>
            </div>
        `).join('');
        return `
            <div class="area-card">
                <div class="area-header">
                    <div class="area-name">${escapeHtml(a.name)}</div>
                    ${progress ? `<div class="area-progress">${progress}</div>` : ''}
                    <button class="area-delete" onclick="deleteArea(${a.id})">🗑</button>
                </div>
                ${goalsHtml}
                <button class="goal-add-inline" onclick="openAddModal('goal', ${a.id})">+ Добавить цель</button>
            </div>
        `;
    }).join('');

    if (orphanGoals.length > 0) {
        const goalsHtml = orphanGoals.map(g => `
            <div class="goal-item">
                <div class="goal-check ${g.status === 'done' ? 'done' : ''}"
                     onclick="toggleGoal(${g.id}, '${g.status}')">✓</div>
                <div class="goal-name ${g.status === 'done' ? 'done' : ''}">${escapeHtml(g.name)}</div>
                <button class="goal-delete" onclick="deleteGoal(${g.id})">✕</button>
            </div>
        `).join('');
        html += `
            <div class="area-card">
                <div class="area-header"><div class="area-name">Без области</div></div>
                ${goalsHtml}
                <button class="goal-add-inline" onclick="openAddModal('goal', null)">+ Добавить цель</button>
            </div>
        `;
    }
    container.innerHTML = html;
}

async function toggleGoal(id, currentStatus) {
    const newStatus = currentStatus === 'done' ? 'plan' : 'done';
    try {
        await api(`/api/disc/goals/${id}`, 'PATCH', { status: newStatus });
        await loadAreas();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function deleteGoal(id) {
    if (!confirm('Удалить цель?')) return;
    try {
        await api(`/api/disc/goals/${id}`, 'DELETE');
        await loadAreas();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function deleteArea(id) {
    if (!confirm('Удалить область и все её цели?')) return;
    try {
        await api(`/api/disc/areas/${id}`, 'DELETE');
        await loadAreas();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

// ==========================================
// ===== МОДАЛКА ВВОДА =====
// ==========================================
let modalContext = { type: null, areaId: null };

function openAddModal(type, areaId = null) {
    modalContext = { type, areaId };
    const modal = document.getElementById('inputModal');
    const title = document.getElementById('inputModalTitle');
    const field = document.getElementById('inputModalField');

    const titles = { habit: 'Новая привычка', area: 'Новая область', goal: 'Новая цель' };
    title.textContent = titles[type] || 'Добавить';
    field.value = '';
    field.placeholder = type === 'habit' ? 'Например: Зал'
        : type === 'area' ? 'Например: Спорт'
        : 'Например: кмс';
    modal.classList.add('open');
    setTimeout(() => field.focus(), 200);
}

function closeInputModal() {
    document.getElementById('inputModal').classList.remove('open');
}

async function submitInputModal() {
    const field = document.getElementById('inputModalField');
    const value = field.value.trim();
    if (!value) return;
    try {
        if (modalContext.type === 'habit') {
            await api('/api/disc/habits', 'POST', { name: value });
            await loadHabits();
        } else if (modalContext.type === 'area') {
            await api('/api/disc/areas', 'POST', { name: value });
            await loadAreas();
        } else if (modalContext.type === 'goal') {
            await api('/api/disc/goals', 'POST', { name: value, area_id: modalContext.areaId });
            await loadAreas();
        }
        closeInputModal();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

document.getElementById('inputModalField')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitInputModal();
});

// ==========================================
// ===== УТИЛИТЫ =====
// ==========================================
function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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
    initScreens();
    const ok = await auth();
    if (ok) await loadHome();
})();