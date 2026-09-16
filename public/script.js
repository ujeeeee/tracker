// ==========================================
// ===== СОСТОЯНИЕ =====
// ==========================================
let tgUser = { id: 0, name: 'Друг' };
let initData = '';
let currentUser = null;
let tg = null;

const TOTAL_MAIN_SCREENS = 8;
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
        if (typeof loadAreas === 'function') loadAreas();
        if (typeof loadHabits === 'function') loadHabits();
        if (typeof loadWeek === 'function') loadWeek();
        if (typeof loadMonthChart === 'function') loadMonthChart();
    }
    if (index === 2) {
        if (typeof loadBudget === 'function') loadBudget();
        if (typeof loadWishlist === 'function') loadWishlist();
        if (typeof loadPiggy === 'function') loadPiggy();
    }
}

let touchStartX = 0, touchStartY = 0, touchMoved = false;
let touchInNav = false;

document.addEventListener('touchstart', (e) => {
    // Если свайп начался в нижнем меню — не переключаем страницы
    touchInNav = !!e.target.closest('.bottom-nav');
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (touchInNav) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) touchMoved = true;
}, { passive: true });

document.addEventListener('touchend', (e) => {
    if (touchInNav) return;
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
// ===== DISCIPLINE: ПРИВЫЧКИ (данные) =====
// ==========================================
let habits = [];

async function loadHabits() {
    try {
        const { habits: data } = await api('/api/disc/habits');
        habits = data;
    } catch (e) {
        console.error('loadHabits:', e);
    }
}

// ==========================================
// ===== ПРИВЫЧКИ: НЕДЕЛЯ =====
// ==========================================
let weekStart = getMonday(new Date());

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

async function loadWeek() {
    const start = weekStart.toISOString().slice(0, 10);
    try {
        const { habits: data } = await api(`/api/disc/habits/week?start=${start}`);
        renderWeek(data);
    } catch (e) {
        console.error('loadWeek:', e);
    }
}

function renderWeek(data) {
    const rangeEl = document.getElementById('weekRange');
    const grid = document.getElementById('weekGrid');

    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    rangeEl.textContent = `${weekStart.getDate()} ${months[weekStart.getMonth()]} — ${end.getDate()} ${months[end.getMonth()]}`;

    if (!data || data.length === 0) {
        grid.innerHTML = `<div class="empty-state">Нет привычек. Добавь первую 👇</div>`;
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const dayNames = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

    let html = `<div class="week-grid-table">`;

    html += `<div class="week-header"><div class="week-header-cell">Привычка</div>`;
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        const isToday = dateStr === today ? 'today' : '';
        html += `<div class="week-header-cell ${isToday}">
            ${dayNames[i]}<span class="week-header-date">${d.getDate()}</span>
        </div>`;
    }
    html += `</div>`;

    data.forEach(h => {
        html += `<div class="week-row">`;
        html += `<div class="week-habit-name" onclick="openHabitModal(${h.id})">${escapeHtml(h.name)}</div>`;
        h.week.forEach(day => {
            const isToday = day.date === today ? 'today' : '';
            const isFuture = day.date > today;

            if (!day.scheduled) {
                html += `<div class="week-cell not-scheduled"></div>`;
                return;
            }

            const canClick = !isFuture;
            const cls = [
                'week-cell',
                'scheduled',
                day.done ? 'done' : '',
                isToday,
            ].filter(Boolean).join(' ');

            const clickHandler = canClick
                ? `onclick="toggleWeekCell(${h.id}, '${day.date}')"`
                : '';

            html += `<div class="${cls}" ${clickHandler}>${day.done ? '✓' : ''}</div>`;
        });
        html += `</div>`;
    });

    html += `</div>`;
    grid.innerHTML = html;
}

async function toggleWeekCell(habitId, date) {
    const today = new Date().toISOString().slice(0, 10);
    if (date > today) return;

    try {
        await api(`/api/disc/habits/${habitId}/toggle`, 'POST', { date });
        await loadWeek();
        await loadMonthChart();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

function weekPrev() {
    weekStart.setDate(weekStart.getDate() - 7);
    loadWeek();
}

function weekNext() {
    weekStart.setDate(weekStart.getDate() + 7);
    loadWeek();
}

// ==========================================
// ===== ГРАФИК ЗА МЕСЯЦ =====
// ==========================================
async function loadMonthChart() {
    try {
        const { year, month, days } = await api('/api/disc/habits/month-stats');
        renderMonthChart(year, month, days);
    } catch (e) {
        console.error('loadMonthChart:', e);
    }
}

function renderMonthChart(year, month, days) {
    const titleEl = document.getElementById('chartTitle');
    const canvas = document.getElementById('habitsChart');
    const legend = document.getElementById('chartLegend');
    if (!titleEl || !canvas || !legend) return;

    const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    titleEl.textContent = `Активность — ${months[month - 1]}`;

    const maxCount = Math.max(1, ...days.map(d => d.count));
    const today = new Date().toISOString().slice(0, 10);

    canvas.innerHTML = days.map(d => {
        const h = Math.max(4, (d.count / maxCount) * 100);
        const cls = ['chart-bar'];
        if (d.count === 0) cls.push('zero');
        if (d.date === today) cls.push('today');
        return `<div class="${cls.join(' ')}" style="height:${h}%" title="${d.date}: ${d.count}"></div>`;
    }).join('');

    legend.innerHTML = `<span>1</span><span>${Math.ceil(days.length / 2)}</span><span>${days.length}</span>`;
}

// ==========================================
// ===== МОДАЛКА ПРИВЫЧКИ =====
// ==========================================
let habitCtx = { id: null, freq: 'daily', days: [1,2,3,4,5,6,7], interval: 2 };

function openHabitModal(habitId = null) {
    habitCtx.id = habitId;
    habitCtx.freq = 'daily';
    habitCtx.days = [1,2,3,4,5,6,7];
    habitCtx.interval = 2;

    const titleEl = document.getElementById('habitModalTitle');
    const nameEl = document.getElementById('habitName');
    const intervalEl = document.getElementById('intervalInput');

    if (habitId) {
        const h = habits.find(x => x.id === habitId);
        if (h) {
            titleEl.textContent = 'Настройки привычки';
            nameEl.value = h.name;
            habitCtx.freq = h.frequency || 'daily';
            habitCtx.days = (h.days_of_week && h.days_of_week.length) ? h.days_of_week : [1,2,3,4,5,6,7];
            habitCtx.interval = h.interval_days || 2;
        }
    } else {
        titleEl.textContent = 'Новая привычка';
        nameEl.value = '';
    }

    intervalEl.value = habitCtx.interval;

    document.querySelectorAll('#habitModal [data-freq]').forEach(b => {
        b.classList.toggle('active', b.dataset.freq === habitCtx.freq);
    });
    document.querySelectorAll('#habitModal .day-opt').forEach(b => {
        b.classList.toggle('active', habitCtx.days.includes(parseInt(b.dataset.dow)));
    });

    document.getElementById('freqDays').style.display = habitCtx.freq === 'days' ? 'block' : 'none';
    document.getElementById('freqInterval').style.display = habitCtx.freq === 'interval' ? 'block' : 'none';

    document.getElementById('habitModal').classList.add('open');
    setTimeout(() => nameEl.focus(), 200);
}

function closeHabitModal() {
    document.getElementById('habitModal').classList.remove('open');
}

function pickFreq(freq, btn) {
    habitCtx.freq = freq;
    document.querySelectorAll('#habitModal [data-freq]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('freqDays').style.display = freq === 'days' ? 'block' : 'none';
    document.getElementById('freqInterval').style.display = freq === 'interval' ? 'block' : 'none';
}

function toggleDow(dow) {
    const idx = habitCtx.days.indexOf(dow);
    if (idx >= 0) habitCtx.days.splice(idx, 1);
    else habitCtx.days.push(dow);

    document.querySelectorAll('#habitModal .day-opt').forEach(b => {
        b.classList.toggle('active', habitCtx.days.includes(parseInt(b.dataset.dow)));
    });
}

async function saveHabit() {
    const name = document.getElementById('habitName').value.trim();
    if (!name) return alert('Введи название');

    if (habitCtx.freq === 'days' && habitCtx.days.length === 0) {
        return alert('Выбери хотя бы один день недели');
    }

    const intervalEl = document.getElementById('intervalInput');
    const intervalVal = parseInt(intervalEl.value);
    if (habitCtx.freq === 'interval' && (!intervalVal || intervalVal < 2)) {
        return alert('Интервал — минимум 2 дня');
    }

    const payload = {
        name,
        frequency: habitCtx.freq,
        days_of_week: habitCtx.days,
        interval_days: intervalVal || 2,
    };

    try {
        if (habitCtx.id) {
            await api(`/api/disc/habits/${habitCtx.id}`, 'PATCH', payload);
        } else {
            await api('/api/disc/habits', 'POST', payload);
        }
        closeHabitModal();
        await loadHabits();
        await loadWeek();
        await loadMonthChart();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
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
// ===== МОДАЛКА ВВОДА (область/цель) =====
// ==========================================
let modalContext = { type: null, areaId: null };

function openAddModal(type, areaId = null) {
    modalContext = { type, areaId };
    const modal = document.getElementById('inputModal');
    const title = document.getElementById('inputModalTitle');
    const field = document.getElementById('inputModalField');

    const titles = { area: 'Новая область', goal: 'Новая цель' };
    title.textContent = titles[type] || 'Добавить';
    field.value = '';
    field.placeholder = type === 'area' ? 'Например: Спорт' : 'Например: кмс';
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
        if (modalContext.type === 'area') {
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
// ===== CASH: БЮДЖЕТ =====
// ==========================================
let cashBudgetData = null;
let cashMonth = new Date().getMonth() + 1;
let cashYear = new Date().getFullYear();

async function loadBudget() {
    try {
        const data = await api(`/api/cash/budget?year=${cashYear}&month=${cashMonth}`);
        cashBudgetData = data;
        renderBudget(data);
    } catch (e) {
        console.error('loadBudget:', e);
    }
}

function fmt(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
}

function renderBudget(data) {
    const t = data.totals;

    // Hero
    document.getElementById('budgetValue').textContent = fmt(t.budget);

    // Stats
    const stats = document.getElementById('budgetStats');
    stats.innerHTML = `
        <div class="budget-stat">
            <div class="budget-stat-label">Запланировано</div>
            <div class="budget-stat-value">${fmt(t.planned)}</div>
        </div>
        <div class="budget-stat">
            <div class="budget-stat-label">Потрачено</div>
            <div class="budget-stat-value minus">${fmt(t.expenses)}</div>
        </div>
        <div class="budget-stat">
            <div class="budget-stat-label">Остаток</div>
            <div class="budget-stat-value ${t.remaining >= 0 ? 'plus' : 'minus'}">${fmt(t.remaining)}</div>
        </div>
        <div class="budget-stat">
            <div class="budget-stat-label">Недель</div>
            <div class="budget-stat-value">${data.weeksInMonth}</div>
        </div>
    `;

    // Subs
    const subsEl = document.getElementById('subsList');
    if (data.subs.length === 0) {
        subsEl.innerHTML = `<div class="widget-empty">Нет подписок</div>`;
    } else {
        subsEl.innerHTML = data.subs.map(s => `
            <div class="cash-item">
                <div class="cash-item-name">${escapeHtml(s.name)}</div>
                <div class="cash-item-amount">${fmt(s.amount)}</div>
                <button class="cash-item-del" onclick="deleteSub(${s.id})">✕</button>
            </div>
        `).join('');
    }
    document.getElementById('subsTotal').innerHTML = `Итого: <b>${fmt(t.subs)}</b>`;

    // Weekly
    const weekEl = document.getElementById('weeklyList');
    if (data.weekly.length === 0) {
        weekEl.innerHTML = `<div class="widget-empty">Нет позиций</div>`;
    } else {
        weekEl.innerHTML = data.weekly.map(w => `
            <div class="cash-item">
                <div class="cash-item-name">${escapeHtml(w.name)}</div>
                <div class="cash-item-amount">${fmt(w.amount)}</div>
                <button class="cash-item-del" onclick="deleteWeekly(${w.id})">✕</button>
            </div>
        `).join('');
    }
    document.getElementById('weeklyTotal').innerHTML =
        `× ${data.weeksInMonth} нед. = <b>${fmt(t.weekly)}</b>`;

    // Expenses
    const expEl = document.getElementById('expensesList');
    if (data.expenses.length === 0) {
        expEl.innerHTML = `<div class="widget-empty">Нет трат в этом месяце</div>`;
    } else {
        expEl.innerHTML = data.expenses.map(e => `
            <div class="cash-item">
                <div style="flex:1;min-width:0;">
                    <div class="cash-item-name">${escapeHtml(e.name)}</div>
                    <div class="cash-item-date">${formatDate(e.date)}</div>
                </div>
                <div class="cash-item-amount minus">${fmt(e.amount)}</div>
                <button class="cash-item-del" onclick="deleteExpense(${e.id})">✕</button>
            </div>
        `).join('');
    }
    document.getElementById('expensesTotal').innerHTML = `Итого: <b>${fmt(t.expenses)}</b>`;
}

function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}

// Бюджет модалка
function openBudgetModal() {
    const b = cashBudgetData?.budget || {};
    document.getElementById('budgetAmount').value = b.budget_amount || '';
    document.getElementById('budgetInvest').value = b.invest_amount || '';
    document.getElementById('budgetPiggy').value = b.piggy_amount || '';
    document.getElementById('budgetModal').classList.add('open');
}
function closeBudgetModal() {
    document.getElementById('budgetModal').classList.remove('open');
}
async function saveBudget() {
    const amount = document.getElementById('budgetAmount').value;
    const invest = document.getElementById('budgetInvest').value;
    const piggy = document.getElementById('budgetPiggy').value;
    try {
        await api('/api/cash/budget', 'POST', {
            year: cashYear, month: cashMonth,
            budget_amount: amount, invest_amount: invest, piggy_amount: piggy,
        });
        closeBudgetModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// Универсальная модалка добавления (sub/weekly/expense)
let cashAddCtx = { type: null };

function openCashAddModal(type) {
    cashAddCtx.type = type;
    const titles = { sub: 'Новая подписка', weekly: 'Недельная покупка', expense: 'Новая трата' };
    document.getElementById('cashAddTitle').textContent = titles[type];
    document.getElementById('cashAddName').value = '';
    document.getElementById('cashAddAmount').value = '';
    document.getElementById('cashAddDateWrap').style.display = type === 'expense' ? 'block' : 'none';
    document.getElementById('cashAddDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cashAddModal').classList.add('open');
    setTimeout(() => document.getElementById('cashAddName').focus(), 200);
}
function closeCashAddModal() {
    document.getElementById('cashAddModal').classList.remove('open');
}
async function saveCashAdd() {
    const name = document.getElementById('cashAddName').value.trim();
    const amount = document.getElementById('cashAddAmount').value;
    if (!name) return alert('Введи название');

    const endpoints = { sub: '/api/cash/subs', weekly: '/api/cash/weekly', expense: '/api/cash/expenses' };
    const body = { name, amount };
    if (cashAddCtx.type === 'expense') body.date = document.getElementById('cashAddDate').value;

    try {
        await api(endpoints[cashAddCtx.type], 'POST', body);
        closeCashAddModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteSub(id) {
    if (!confirm('Удалить?')) return;
    await api(`/api/cash/subs/${id}`, 'DELETE'); await loadBudget();
}
async function deleteWeekly(id) {
    if (!confirm('Удалить?')) return;
    await api(`/api/cash/weekly/${id}`, 'DELETE'); await loadBudget();
}
async function deleteExpense(id) {
    if (!confirm('Удалить?')) return;
    await api(`/api/cash/expenses/${id}`, 'DELETE'); await loadBudget();
}

// ==========================================
// ===== CASH: WISHLIST =====
// ==========================================
let wishlistItems = [];
let wishCtx = { priority: 'important_urgent' };

async function loadWishlist() {
    try {
        const { items } = await api('/api/cash/wishlist');
        wishlistItems = items;
        renderWishlist();
    } catch (e) { console.error('loadWishlist:', e); }
}

function renderWishlist() {
    const grid = document.getElementById('wishlistGrid');
    if (!grid) return;

    if (wishlistItems.length === 0) {
        grid.innerHTML = `<div class="empty-state">Пока пусто.<br>Добавь первую хотелку 👇</div>`;
        return;
    }

    const groups = {
        important_urgent: { title: '🔥 Важно, срочно', items: [] },
        important_not_urgent: { title: '🎯 Важно, не срочно', items: [] },
        not_important: { title: '💤 Не важно', items: [] },
        clothes: { title: '👕 Одежда', items: [] },
    };

    wishlistItems.forEach(x => {
        const key = groups[x.priority] ? x.priority : 'important_not_urgent';
        groups[key].items.push(x);
    });

    let html = '';
    Object.entries(groups).forEach(([key, g]) => {
        if (g.items.length === 0) return;
        html += `<div class="wishlist-group">
            <div class="wishlist-group-title">${g.title}</div>`;
        g.items.forEach(it => {
            html += `<div class="wishlist-item">
                <div class="wishlist-check ${it.done ? 'done' : ''}" onclick="toggleWish(${it.id}, ${it.done})">✓</div>
                <div class="wishlist-name ${it.done ? 'done' : ''}">${escapeHtml(it.name)}</div>
                ${it.price ? `<div class="wishlist-price">${fmt(it.price)}</div>` : ''}
                <button class="wishlist-del" onclick="deleteWish(${it.id})">✕</button>
            </div>`;
        });
        html += `</div>`;
    });

    grid.innerHTML = html;
}

function openWishlistModal() {
    document.getElementById('wishName').value = '';
    document.getElementById('wishPrice').value = '';
    document.getElementById('wishUrl').value = '';
    wishCtx.priority = 'important_urgent';
    document.querySelectorAll('#wishlistModal [data-prio]').forEach(b => {
        b.classList.toggle('active', b.dataset.prio === 'important_urgent');
    });
    document.getElementById('wishlistModal').classList.add('open');
}
function closeWishlistModal() {
    document.getElementById('wishlistModal').classList.remove('open');
}
function pickPriority(p, btn) {
    wishCtx.priority = p;
    document.querySelectorAll('#wishlistModal [data-prio]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
async function saveWishlist() {
    const name = document.getElementById('wishName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/cash/wishlist', 'POST', {
            name,
            price: document.getElementById('wishPrice').value,
            priority: wishCtx.priority,
            url: document.getElementById('wishUrl').value,
        });
        closeWishlistModal();
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function toggleWish(id, done) {
    try {
        await api(`/api/cash/wishlist/${id}`, 'PATCH', { done: !done });
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteWish(id) {
    if (!confirm('Удалить?')) return;
    await api(`/api/cash/wishlist/${id}`, 'DELETE'); await loadWishlist();
}

// ==========================================
// ===== CASH: КОПИЛКА =====
// ==========================================
let piggyCtx = { type: 'deposit' };

async function loadPiggy() {
    try {
        const { items, totals } = await api('/api/cash/piggy');
        renderPiggy(items, totals);
    } catch (e) { console.error('loadPiggy:', e); }
}

function renderPiggy(items, totals) {
    const hero = document.getElementById('piggyHero');
    hero.innerHTML = `
        <div class="piggy-hero-balance">${fmt(totals.balance)}</div>
        <div class="piggy-hero-label">В копилке сейчас</div>
        <div class="piggy-hero-stats">
            <div class="piggy-stat">
                <div class="piggy-stat-label">Положил</div>
                <div class="piggy-stat-value plus">${fmt(totals.deposited)}</div>
            </div>
            <div class="piggy-stat">
                <div class="piggy-stat-label">Взял</div>
                <div class="piggy-stat-value minus">${fmt(totals.withdrew)}</div>
            </div>
        </div>
    `;

    const list = document.getElementById('piggyList');
    if (items.length === 0) {
        list.innerHTML = `<div class="widget-empty">Пока пусто</div>`;
        return;
    }

    list.innerHTML = items.map(x => `
        <div class="cash-item">
            <div style="flex:1;min-width:0;">
                <div class="cash-item-name">${escapeHtml(x.description || (x.type === 'deposit' ? 'Пополнение' : 'Снятие'))}</div>
                <div class="cash-item-date">${formatDate(x.date)}</div>
            </div>
            <div class="cash-item-amount ${x.type === 'withdraw' ? 'minus' : ''}">
                ${x.type === 'withdraw' ? '−' : '+'}${fmt(x.amount)}
            </div>
            <button class="cash-item-del" onclick="deletePiggyItem(${x.id})">✕</button>
        </div>
    `).join('');
}

function openPiggyModal(type) {
    piggyCtx.type = type;
    document.getElementById('piggyModalTitle').textContent =
        type === 'deposit' ? 'Положить в копилку' : 'Взять из копилки';
    document.getElementById('piggyAmount').value = '';
    document.getElementById('piggyDesc').value = '';
    document.getElementById('piggyModal').classList.add('open');
    setTimeout(() => document.getElementById('piggyAmount').focus(), 200);
}
function closePiggyModal() {
    document.getElementById('piggyModal').classList.remove('open');
}
async function savePiggy() {
    const amount = document.getElementById('piggyAmount').value;
    if (!amount) return alert('Введи сумму');
    try {
        await api('/api/cash/piggy', 'POST', {
            type: piggyCtx.type,
            amount,
            description: document.getElementById('piggyDesc').value,
        });
        closePiggyModal();
        await loadPiggy();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deletePiggyItem(id) {
    if (!confirm('Удалить?')) return;
    await api(`/api/cash/piggy/${id}`, 'DELETE'); await loadPiggy();
}

// ==========================================
// ===== СТАРТ =====
// ==========================================
(async function start() {
    initScreens();
    const ok = await auth();
    if (ok) {
        await loadHome();
        await loadHabits();
        await loadWeek();
        await loadMonthChart();
        await loadAreas();
        await loadBudget();
        await loadWishlist();
        await loadPiggy();
    }
})();