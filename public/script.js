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
    if (tg.initDataUnsafe?.user) {
        tgUser.id = tg.initDataUnsafe.user.id;
        tgUser.name = tg.initDataUnsafe.user.first_name || tg.initDataUnsafe.user.username || 'Друг';
    }
    initData = tg.initData || '';
    if (tg.onEvent) tg.onEvent('themeChanged', () => { if (getThemeMode() === 'auto') applyTheme(tg.colorScheme); });
    if (tg.BackButton) tg.BackButton.onClick(() => closeSettings());
} catch (e) { console.log('Not in Telegram'); }

initTheme();

// ==========================================
// ===== ТЕМА =====
// ==========================================
function getThemeMode() { return localStorage.getItem('theme_mode') || 'auto'; }

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
        if (tg?.setHeaderColor) tg.setHeaderColor(theme === 'light' ? '#f2f2f7' : '#0a0a0c');
        if (tg?.setBackgroundColor) tg.setBackgroundColor(theme === 'light' ? '#f2f2f7' : '#0a0a0c');
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
    document.querySelectorAll('.theme-option').forEach(b => b.classList.toggle('active', b.dataset.themeValue === mode));
}

// ==========================================
// ===== УТИЛИТЫ =====
// ==========================================
function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₽'; }

function localDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function formatDate(s) {
    if (!s) return '';
    const d = new Date(s + 'T12:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
}

function getDayLabel(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const today = localDate(now);
    const tomorrow = localDate(new Date(now.getTime() + 86400000));
    const dayAfter = localDate(new Date(now.getTime() + 172800000));
    const yesterday = localDate(new Date(now.getTime() - 86400000));
    if (dateStr === today) return 'сегодня';
    if (dateStr === tomorrow) return 'завтра';
    if (dateStr === dayAfter) return 'послезавтра';
    if (dateStr === yesterday) return 'вчера';
    return null;
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function haptic(type = 'light') {
    try { if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(type); } catch (e) {}
}
document.addEventListener('click', e => { if (e.target.closest('button')) haptic('light'); });

// ==========================================
// ===== API =====
// ==========================================
async function api(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json', 'x-init-data': initData } };
    if (body) opts.body = JSON.stringify({ ...body, initData });
    const res = await fetch(path, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Server returned HTML'); }
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
    } catch (e) { console.error('Auth:', e.message); return false; }
}

// ==========================================
// ===== SCREENS =====
// ==========================================
function goToScreen(index) {
    if (index < 0 || index >= TOTAL_MAIN_SCREENS) return;
    currentScreenIndex = index;

    const screens = document.querySelectorAll('.screen');
    screens.forEach((s, i) => s.classList.toggle('active', i === index));

    document.querySelectorAll('.nav-btn').forEach(b => {
        const idx = b.dataset.index;
        b.classList.toggle('active', idx !== undefined && parseInt(idx) === index);
    });

    const nav = document.getElementById('bottomNav');
    const btn = nav.querySelector(`.nav-btn[data-index="${index}"]`);
    if (nav && btn) {
        const t = btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;
        nav.scrollTo({ left: t, behavior: 'smooth' });
    }
    window.scrollTo(0, 0);

    if (index === 0) loadMain();
    if (index === 1) { loadAreas(); loadHabits(); loadWeek(); loadTodos(); }
    if (index === 2) { loadPrograms(); loadMetrics(); }
    if (index === 3) { loadBudget(); loadWishlist(); loadPiggy(); }
    if (index === 4) loadPlaces();
    if (index === 5) loadFilm();
    if (index === 6) loadTea();
}

function switchSubTab(parent, tab, btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const ps = btn.closest('.screen');
    ps.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));
    const target = document.getElementById(`${parent}-${tab}`);
    if (target) target.classList.add('active');
}

// ==========================================
// ===== SETTINGS =====
// ==========================================
function openSettings() {
    updateSettingsUI();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelector('[data-screen-name="Settings"]').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    window.scrollTo(0, 0);
}
function closeSettings() { goToScreen(currentScreenIndex); }

function updateSettingsUI() {
    const name = currentUser?.name || tgUser.name || 'Друг';
    document.getElementById('settingsUserName').textContent = name;
    document.getElementById('settingsUserId').textContent = 'ID: ' + (currentUser?.id || tgUser.id || '—');
    document.getElementById('settingsAvatar').textContent = (name[0] || '?').toUpperCase();
    updateThemeButtons(getThemeMode());
}

// ==========================================
// ===== MAIN (дашборд) =====
// ==========================================
async function loadMain() {
    try {
        const data = await api('/api/main');
        renderMain(data);
    } catch (e) { console.error(e); }
}

function renderMain(data) {
    renderMainGreeting();
    renderMainTodos(data.todos);
    renderMainHabits(data.habits);
    renderMainMoney(data.money);
}

function renderMainGreeting() {
    const h = new Date().getHours();
    const g = h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    document.getElementById('mainGreeting').textContent = `${g}, ${tgUser.name}`;
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const d = new Date();
    document.getElementById('mainDate').textContent = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

function renderMainTodos(todos) {
    const c = document.getElementById('mainTodosWidget');
    let html = `<div class="widget"><div class="widget-title"><span>Дела</span>${todos.length > 0 ? `<span class="widget-title-count">${todos.length}</span>` : ''}</div>`;
    if (!todos.length) {
        html += `<div class="widget-empty">Пусто на сегодня и завтра</div>`;
    } else {
        todos.forEach(t => {
            const time = t.time_start ? `${t.time_start}${t.time_end ? '—' + t.time_end : ''}` : '';
            html += `<div class="main-todo-item">
                <span class="main-todo-date ${t.isTomorrow ? 'tomorrow' : ''}">${t.isToday ? 'Сегодня' : 'Завтра'}</span>
                <span class="main-todo-name">${escapeHtml(t.name)}</span>
                ${time ? `<span class="main-todo-time">${time}</span>` : ''}
            </div>`;
        });
    }
    html += `</div>`;
    c.innerHTML = html;
}

function renderMainHabits(habits) {
    const c = document.getElementById('mainHabitsWidget');
    let html = `<div class="widget"><div class="widget-title"><span>Привычки сегодня</span>${habits.length > 0 ? `<span class="widget-title-count">${habits.length}</span>` : ''}</div>`;
    if (!habits.length) {
        html += `<div class="widget-empty">Все привычки выполнены ✓</div>`;
    } else {
        habits.forEach(h => {
            html += `<div class="main-habit-item">${escapeHtml(h.name)}</div>`;
        });
    }
    html += `</div>`;
    c.innerHTML = html;
}

function renderMainMoney(money) {
    const c = document.getElementById('mainMoneyWidget');
    c.innerHTML = `<div class="main-widget-row">
        <div class="main-widget-square">
            <div class="main-widget-label">Копилка</div>
            <div class="main-widget-value">${fmt(money.balance)}</div>
        </div>
        <div class="main-widget-square">
            <div class="main-widget-label">Долг</div>
            <div class="main-widget-value ${money.debt > 0 ? 'debt' : ''}">${fmt(money.debt)}</div>
        </div>
    </div>`;
}

// ==========================================
// ===== DISCIPLINE: ПРИВЫЧКИ =====
// ==========================================
let habits = [];
let habitCtx = { id: null, freq: 'daily', days: [1,2,3,4,5,6,7], interval: 2 };
let weekStart = getMonday(new Date());

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(12, 0, 0, 0);
    return date;
}

async function loadHabits() {
    try {
        const { habits: d } = await api('/api/disc/habits');
        habits = d;
    } catch (e) { console.error(e); }
}

async function loadWeek() {
    const start = localDate(weekStart);
    try {
        const { habits: d } = await api(`/api/disc/habits/week?start=${start}`);
        renderWeek(d);
    } catch (e) { console.error(e); }
}

function renderWeek(data) {
    const rangeEl = document.getElementById('weekRange');
    const grid = document.getElementById('weekGrid');
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    rangeEl.textContent = `${weekStart.getDate()} ${months[weekStart.getMonth()]} — ${end.getDate()} ${months[end.getMonth()]}`;

    if (!data?.length) {
        grid.innerHTML = `<div class="empty-state">Нет привычек. Нажми +</div>`;
        return;
    }
    const today = localDate(new Date());
    const dn = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    let html = `<div class="week-grid-table"><div class="week-header"><div class="week-header-cell">Привычка</div>`;
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const ds = localDate(d);
        html += `<div class="week-header-cell ${ds === today ? 'today' : ''}">${dn[i]}<span class="week-header-date">${d.getDate()}</span></div>`;
    }
    html += `</div>`;

    data.forEach(h => {
        html += `<div class="week-row"><div class="week-habit-name" onclick="openHabitModal(${h.id})">${escapeHtml(h.name)}</div>`;
        h.week.forEach(day => {
            if (!day.scheduled) { html += `<div class="week-cell not-scheduled"></div>`; return; }
            const isFuture = day.date > today;
            const cls = ['week-cell', 'scheduled', day.done ? 'done' : '', day.date === today ? 'today' : ''].filter(Boolean).join(' ');
            const handler = !isFuture ? `onclick="toggleWeekCell(${h.id}, '${day.date}')"` : '';
            html += `<div class="${cls}" ${handler}>${day.done ? '✓' : ''}</div>`;
        });
        html += `</div>`;
    });
    html += `</div>`;
    grid.innerHTML = html;
}

async function toggleWeekCell(habitId, date) {
    try {
        await api(`/api/disc/habits/${habitId}/toggle`, 'POST', { date });
        await loadWeek();
        await loadHabits();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

function weekPrev() { weekStart.setDate(weekStart.getDate() - 7); loadWeek(); }
function weekNext() { weekStart.setDate(weekStart.getDate() + 7); loadWeek(); }

function openHabitModal(id = null) {
    habitCtx = { id, freq: 'daily', days: [1,2,3,4,5,6,7], interval: 2 };
    const titleEl = document.getElementById('habitModalTitle');
    const nameEl = document.getElementById('habitName');
    const delBtn = document.getElementById('habitDeleteBtn');

    if (id) {
        const h = habits.find(x => x.id === id);
        if (h) {
            titleEl.textContent = 'Редактировать привычку';
            nameEl.value = h.name;
            habitCtx.freq = h.frequency || 'daily';
            habitCtx.days = h.days_of_week?.length ? h.days_of_week : [1,2,3,4,5,6,7];
            habitCtx.interval = h.interval_days || 2;
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая привычка';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }

    document.getElementById('intervalInput').value = habitCtx.interval;
    document.querySelectorAll('#habitModal [data-freq]').forEach(b => b.classList.toggle('active', b.dataset.freq === habitCtx.freq));
    document.querySelectorAll('#habitModal .day-opt').forEach(b => b.classList.toggle('active', habitCtx.days.includes(parseInt(b.dataset.dow))));
    document.getElementById('freqDays').style.display = habitCtx.freq === 'days' ? 'block' : 'none';
    document.getElementById('freqInterval').style.display = habitCtx.freq === 'interval' ? 'block' : 'none';

    openModal('habitModal');
    setTimeout(() => nameEl.focus(), 200);
}

function closeHabitModal() { closeModal('habitModal'); }

function pickFreq(freq, btn) {
    habitCtx.freq = freq;
    document.querySelectorAll('#habitModal [data-freq]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('freqDays').style.display = freq === 'days' ? 'block' : 'none';
    document.getElementById('freqInterval').style.display = freq === 'interval' ? 'block' : 'none';
}

function toggleDow(dow) {
    const i = habitCtx.days.indexOf(dow);
    if (i >= 0) habitCtx.days.splice(i, 1); else habitCtx.days.push(dow);
    document.querySelectorAll('#habitModal .day-opt').forEach(b =>
        b.classList.toggle('active', habitCtx.days.includes(parseInt(b.dataset.dow))));
}

async function saveHabit() {
    const name = document.getElementById('habitName').value.trim();
    if (!name) return alert('Введи название');
    if (habitCtx.freq === 'days' && habitCtx.days.length === 0) return alert('Выбери дни');
    const intervalVal = parseInt(document.getElementById('intervalInput').value);
    if (habitCtx.freq === 'interval' && (!intervalVal || intervalVal < 2)) return alert('Минимум 2 дня');
    const payload = { name, frequency: habitCtx.freq, days_of_week: habitCtx.days, interval_days: intervalVal || 2 };
    try {
        if (habitCtx.id) await api(`/api/disc/habits/${habitCtx.id}`, 'PATCH', payload);
        else await api('/api/disc/habits', 'POST', payload);
        closeHabitModal();
        await loadHabits();
        await loadWeek();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteHabit() {
    if (!habitCtx.id) return;
    if (!confirm('Удалить привычку и все отметки?')) return;
    try {
        await api(`/api/disc/habits/${habitCtx.id}`, 'DELETE');
        closeHabitModal();
        await loadHabits();
        await loadWeek();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ==========================================
// ===== DISCIPLINE: ДЕЛА =====
// ==========================================
let todos = [];
let todoCtx = { id: null };

async function loadTodos() {
    try {
        const { todos: data } = await api('/api/disc/todos');
        todos = data;
        renderTodos();
    } catch (e) { console.error(e); }
}

function renderTodos() {
    const c = document.getElementById('todosList');
    if (!todos.length) {
        c.innerHTML = `<div class="widget-empty">Пусто. Нажми + чтобы добавить</div>`;
        return;
    }

    // Сортировка: сначала без даты, потом с датой по возрастанию, потом закрытые
    const sorted = [...todos].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.date && !b.date) return 0;
        if (!a.date) return -1;
        if (!b.date) return 1;
        return a.date.localeCompare(b.date);
    });

    c.innerHTML = sorted.map(t => {
        let metaHtml = '';
        if (t.date) {
            const label = getDayLabel(t.date);
            const dateStr = formatDate(t.date);
            let cls = '';
            if (label === 'вчера') cls = 'overdue';
            else if (label === 'сегодня') cls = 'today';
            else if (label === 'завтра') cls = 'tomorrow';
            const display = label ? `${dateStr} (${label})` : dateStr;
            metaHtml = `<div class="todo-meta"><span class="${cls}">${display}</span>`;
            if (t.time_start || t.time_end) {
                metaHtml += ` · ${t.time_start || '?'}—${t.time_end || '?'}`;
            }
            metaHtml += `</div>`;
        } else if (t.time_start || t.time_end) {
            metaHtml = `<div class="todo-meta">${t.time_start || '?'}—${t.time_end || '?'}</div>`;
        }

        return `<div class="todo-item ${t.done ? 'done' : ''}" onclick="openTodoModal(${t.id})">
            <div class="item-check ${t.done ? 'done' : ''}" onclick="event.stopPropagation(); toggleTodo(${t.id}, ${t.done})">✓</div>
            <div class="todo-body">
                <div class="todo-name">${escapeHtml(t.name)}</div>
                ${metaHtml}
            </div>
        </div>`;
    }).join('');
}

function openTodoModal(id = null) {
    todoCtx = { id };
    const titleEl = document.getElementById('todoModalTitle');
    const nameEl = document.getElementById('todoName');
    const dateEl = document.getElementById('todoDate');
    const timeStartEl = document.getElementById('todoTimeStart');
    const timeEndEl = document.getElementById('todoTimeEnd');
    const delBtn = document.getElementById('todoDeleteBtn');

    if (id) {
        const t = todos.find(x => x.id === id);
        if (t) {
            titleEl.textContent = 'Редактировать дело';
            nameEl.value = t.name;
            dateEl.value = t.date || '';
            timeStartEl.value = t.time_start || '';
            timeEndEl.value = t.time_end || '';
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новое дело';
        nameEl.value = '';
        dateEl.value = '';
        timeStartEl.value = '';
        timeEndEl.value = '';
        delBtn.style.display = 'none';
    }

    openModal('todoModal');
    setTimeout(() => nameEl.focus(), 200);
}

function closeTodoModal() { closeModal('todoModal'); }

async function saveTodo() {
    const name = document.getElementById('todoName').value.trim();
    if (!name) return alert('Введи название');
    const payload = {
        name,
        date: document.getElementById('todoDate').value || null,
        time_start: document.getElementById('todoTimeStart').value || null,
        time_end: document.getElementById('todoTimeEnd').value || null,
    };
    try {
        if (todoCtx.id) await api(`/api/disc/todos/${todoCtx.id}`, 'PATCH', payload);
        else await api('/api/disc/todos', 'POST', payload);
        closeTodoModal();
        await loadTodos();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function toggleTodo(id, done) {
    try {
        await api(`/api/disc/todos/${id}`, 'PATCH', { done: !done });
        await loadTodos();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteTodo() {
    if (!todoCtx.id) return;
    if (!confirm('Удалить дело?')) return;
    try {
        await api(`/api/disc/todos/${todoCtx.id}`, 'DELETE');
        closeTodoModal();
        await loadTodos();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ==========================================
// ===== DISCIPLINE: ЦЕЛИ =====
// ==========================================
let areas = [];
let areaCtx = { id: null };
let goalCtx = { id: null, areaId: null };

async function loadAreas() {
    try {
        const { areas: d, orphanGoals } = await api('/api/disc/areas');
        areas = d;
        renderAreas(orphanGoals);
    } catch (e) { console.error(e); }
}

function renderAreas(orphans = []) {
    const c = document.getElementById('areasList');
    if (!areas.length && !orphans.length) {
        c.innerHTML = `<div class="empty-state">Нет областей. Нажми +</div>`;
        return;
    }

    let html = areas.map(a => {
        const done = a.goals.filter(g => g.status === 'done').length;
        const prog = a.goals.length ? `${done}/${a.goals.length}` : '';
        return `<div class="area-card">
            <div class="group-header">
                <div class="group-name clickable" onclick="openAreaModal(${a.id})">${escapeHtml(a.name)}</div>
                ${prog ? `<div class="group-progress">${prog}</div>` : ''}
                <button class="btn-icon-add" onclick="openGoalModal(null, ${a.id})">+</button>
            </div>
            ${a.goals.map(g => goalHTML(g)).join('')}
        </div>`;
    }).join('');

    if (orphans.length) {
        html += `<div class="area-card">
            <div class="group-header"><div class="group-name">Без области</div>
                <button class="btn-icon-add" onclick="openGoalModal(null, null)">+</button>
            </div>
            ${orphans.map(g => goalHTML(g)).join('')}
        </div>`;
    }
    c.innerHTML = html;
}

function goalHTML(g) {
    return `<div class="list-item" onclick="openGoalModal(${g.id}, ${g.area_id || 'null'})">
        <div class="item-check ${g.status === 'done' ? 'done' : ''}" onclick="event.stopPropagation(); toggleGoal(${g.id}, '${g.status}')">✓</div>
        <div class="item-info"><div class="item-title ${g.status === 'done' ? 'done' : ''}">${escapeHtml(g.name)}</div></div>
        <button class="area-delete" onclick="event.stopPropagation(); deleteGoal(${g.id})">✕</button>
    </div>`;
}

async function toggleGoal(id, s) {
    await api(`/api/disc/goals/${id}`, 'PATCH', { status: s === 'done' ? 'plan' : 'done' });
    await loadAreas();
}

async function deleteGoal(id) {
    if (!confirm('Удалить цель?')) return;
    await api(`/api/disc/goals/${id}`, 'DELETE');
    await loadAreas();
}

// Область
function openAreaModal(id = null) {
    areaCtx = { id };
    const titleEl = document.getElementById('areaModalTitle');
    const nameEl = document.getElementById('areaName');
    const delBtn = document.getElementById('areaDeleteBtn');

    if (id) {
        const a = areas.find(x => x.id === id);
        if (a) { titleEl.textContent = 'Редактировать область'; nameEl.value = a.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая область';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('areaModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeAreaModal() { closeModal('areaModal'); }

async function saveArea() {
    const name = document.getElementById('areaName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (areaCtx.id) await api(`/api/disc/areas/${areaCtx.id}`, 'PATCH', { name });
        else await api('/api/disc/areas', 'POST', { name });
        closeAreaModal();
        await loadAreas();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteAreaFromModal() {
    if (!areaCtx.id) return;
    if (!confirm('Удалить область со всеми целями?')) return;
    await api(`/api/disc/areas/${areaCtx.id}`, 'DELETE');
    closeAreaModal();
    await loadAreas();
}

// Цель
function openGoalModal(id = null, areaId = null) {
    goalCtx = { id, areaId };
    const titleEl = document.getElementById('goalModalTitle');
    const nameEl = document.getElementById('goalName');
    const delBtn = document.getElementById('goalDeleteBtn');

    if (id) {
        let found = null;
        for (const a of areas) { const g = a.goals.find(x => x.id === id); if (g) { found = g; break; } }
        if (found) { titleEl.textContent = 'Редактировать цель'; nameEl.value = found.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая цель';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('goalModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeGoalModal() { closeModal('goalModal'); }

async function saveGoal() {
    const name = document.getElementById('goalName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (goalCtx.id) await api(`/api/disc/goals/${goalCtx.id}`, 'PATCH', { name });
        else await api('/api/disc/goals', 'POST', { name, area_id: goalCtx.areaId });
        closeGoalModal();
        await loadAreas();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteGoalFromModal() {
    if (!goalCtx.id) return;
    if (!confirm('Удалить цель?')) return;
    await api(`/api/disc/goals/${goalCtx.id}`, 'DELETE');
    closeGoalModal();
    await loadAreas();
}

// ==========================================
// ===== CASH: БЮДЖЕТ =====
// ==========================================
let cashBudget = null;
let statCtx = { id: null, type: 'rub' };
let cashAddCtx = { id: null, type: null };

async function loadBudget() {
    try {
        const data = await api('/api/cash/budget');
        cashBudget = data;
        renderBudget(data);
    } catch (e) { console.error(e); }
}

function renderBudget(d) {
    const t = d.totals;
    document.getElementById('budgetValue').textContent = fmt(t.budget);

    const list = document.getElementById('budgetList');
    let html = '';

    html += `<div class="budget-row" onclick="openBudgetModal()">
        <div class="budget-row-label">Запланировано</div>
        <div class="budget-row-value">${fmt(t.planned)}</div>
    </div>`;

    d.customStats.forEach(s => {
        const val = s.type === 'percent' ? (t.budget * Number(s.value) / 100) : Number(s.value);
        const label = s.type === 'percent' ? `${s.name} (${s.value}%)` : s.name;
        html += `<div class="budget-row" onclick="openCustomStatModal(${s.id})">
            <div class="budget-row-label">${escapeHtml(label)}</div>
            <div class="budget-row-value">${fmt(val)}</div>
        </div>`;
    });

    html += `<div class="budget-row">
        <div class="budget-row-label">Остаток</div>
        <div class="budget-row-value ${t.remaining >= 0 ? 'plus' : 'minus'}">${fmt(t.remaining)}</div>
    </div>`;

    html += `<button class="budget-row-add" onclick="openCustomStatModal()">+ Добавить панель</button>`;
    list.innerHTML = html;

    // Subs
    const subsEl = document.getElementById('subsList');
    subsEl.innerHTML = d.subs.length === 0
        ? `<div class="widget-empty">Нет трат</div>`
        : d.subs.map(s => `<div class="cash-item ${s.paid ? 'paid' : ''}" onclick="openCashAddModal('sub', ${s.id})">
            <div class="cash-item-check ${s.paid ? 'done' : ''}" onclick="event.stopPropagation(); toggleSubPaid(${s.id}, ${s.paid})">✓</div>
            <div class="cash-item-name">${escapeHtml(s.name)}</div>
            <div class="cash-item-amount">${fmt(s.amount)}</div>
        </div>`).join('');
    document.getElementById('subsTotal').innerHTML = `Итого: <b>${fmt(t.subs)}</b>`;

    // Weekly
    const weekEl = document.getElementById('weeklyList');
    weekEl.innerHTML = d.weekly.length === 0
        ? `<div class="widget-empty">Нет позиций</div>`
        : d.weekly.map(w => `<div class="cash-item" onclick="openCashAddModal('weekly', ${w.id})">
            <div class="cash-item-name">${escapeHtml(w.name)}</div>
            <div class="cash-item-amount">${fmt(w.amount)}</div>
        </div>`).join('');
    document.getElementById('weeklyTotal').innerHTML = `× ${d.weeksInMonth} нед. = <b>${fmt(t.weekly)}</b>`;
}

async function toggleSubPaid(id, paid) {
    try {
        await api(`/api/cash/subs/${id}`, 'PATCH', { paid: !paid });
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

function openBudgetModal() {
    document.getElementById('budgetAmount').value = cashBudget?.budget?.budget_amount || '';
    openModal('budgetModal');
}
function closeBudgetModal() { closeModal('budgetModal'); }
async function saveBudget() {
    try {
        await api('/api/cash/budget', 'POST', {
            year: cashBudget?.year, month: cashBudget?.month,
            budget_amount: document.getElementById('budgetAmount').value,
        });
        closeBudgetModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// Custom stats
function openCustomStatModal(id = null) {
    statCtx = { id, type: 'rub' };
    const titleEl = document.getElementById('customStatTitle');
    const nameEl = document.getElementById('customStatName');
    const valueEl = document.getElementById('customStatValue');
    const delBtn = document.getElementById('customStatDeleteBtn');

    if (id) {
        const s = cashBudget.customStats.find(x => x.id === id);
        if (s) {
            titleEl.textContent = 'Редактировать панель';
            nameEl.value = s.name;
            valueEl.value = s.value;
            statCtx.type = s.type;
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая панель';
        nameEl.value = '';
        valueEl.value = '';
        delBtn.style.display = 'none';
    }

    document.querySelectorAll('#customStatModal [data-type]').forEach(b =>
        b.classList.toggle('active', b.dataset.type === statCtx.type));
    openModal('customStatModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeCustomStatModal() { closeModal('customStatModal'); }

function pickStatType(t, btn) {
    statCtx.type = t;
    document.querySelectorAll('#customStatModal [data-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function saveCustomStat() {
    const name = document.getElementById('customStatName').value.trim();
    if (!name) return alert('Введи название');
    const payload = { name, type: statCtx.type, value: document.getElementById('customStatValue').value };
    try {
        if (statCtx.id) await api(`/api/cash/custom-stats/${statCtx.id}`, 'PATCH', payload);
        else await api('/api/cash/custom-stats', 'POST', payload);
        closeCustomStatModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteCustomStatFromModal() {
    if (!statCtx.id) return;
    if (!confirm('Удалить панель?')) return;
    await api(`/api/cash/custom-stats/${statCtx.id}`, 'DELETE');
    closeCustomStatModal();
    await loadBudget();
}

// Cash add (sub/weekly)
function openCashAddModal(type, id = null) {
    cashAddCtx = { id, type };
    const titleEl = document.getElementById('cashAddTitle');
    const nameEl = document.getElementById('cashAddName');
    const amountEl = document.getElementById('cashAddAmount');
    const delBtn = document.getElementById('cashAddDeleteBtn');

    if (id) {
        const item = type === 'sub'
            ? cashBudget.subs.find(x => x.id === id)
            : cashBudget.weekly.find(x => x.id === id);
        if (item) {
            titleEl.textContent = type === 'sub' ? 'Редактировать трату' : 'Редактировать покупку';
            nameEl.value = item.name;
            amountEl.value = item.amount;
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = type === 'sub' ? 'Трата месяца' : 'Недельная покупка';
        nameEl.value = '';
        amountEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('cashAddModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeCashAddModal() { closeModal('cashAddModal'); }

async function saveCashAdd() {
    const name = document.getElementById('cashAddName').value.trim();
    if (!name) return alert('Введи название');
    const payload = { name, amount: document.getElementById('cashAddAmount').value };
    try {
        if (cashAddCtx.id) {
            const ep = cashAddCtx.type === 'sub' ? 'subs' : 'weekly';
            await api(`/api/cash/${ep}/${cashAddCtx.id}`, 'PATCH', payload);
        } else {
            const ep = cashAddCtx.type === 'sub' ? 'subs' : 'weekly';
            await api(`/api/cash/${ep}`, 'POST', payload);
        }
        closeCashAddModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteCashAddFromModal() {
    if (!cashAddCtx.id) return;
    if (!confirm('Удалить?')) return;
    const ep = cashAddCtx.type === 'sub' ? 'subs' : 'weekly';
    await api(`/api/cash/${ep}/${cashAddCtx.id}`, 'DELETE');
    closeCashAddModal();
    await loadBudget();
}

// ==========================================
// ===== CASH: WISHLIST =====
// ==========================================
let wishlistItems = [];
let wishlistAreas = [];
let wishAreaCtx = { id: null, name: null };
let wishCtx = { id: null, url: null };

async function loadWishlist() {
    try {
        const { items, areas } = await api('/api/cash/wishlist');
        wishlistItems = items;
        wishlistAreas = areas;
        renderWishlist();
    } catch (e) { console.error(e); }
}

function renderWishlist() {
    const c = document.getElementById('wishlistGrid');
    if (!wishlistAreas.length && !wishlistItems.length) {
        c.innerHTML = `<div class="empty-state">Нет областей. Нажми +</div>`;
        return;
    }

    let html = '';
    wishlistAreas.forEach(area => {
        const items = wishlistItems.filter(i => (i.area || '') === area.name);
        const safeName = escapeHtml(area.name).replace(/'/g, "\\'");

        html += `<div class="wishlist-area-card">
            <div class="group-header">
                <div class="group-name clickable" onclick="openWishlistAreaModal(${area.id})">${escapeHtml(area.name)}</div>
                <div class="group-count">${items.length}</div>
                <button class="btn-icon-add" onclick="openWishlistModal(null, '${safeName}')">+</button>
            </div>`;

        if (!items.length) {
            html += `<div class="widget-empty" style="padding:8px 4px;">Пусто</div>`;
        } else {
            items.forEach(it => {
                html += `<div class="list-item" onclick="openWishlistModal(${it.id})">
                    <div class="item-check ${it.done ? 'done' : ''}" onclick="event.stopPropagation(); toggleWish(${it.id}, ${it.done})">✓</div>
                    <div class="item-info"><div class="item-title ${it.done ? 'done' : ''}">${escapeHtml(it.name)}</div></div>
                    ${it.price ? `<div class="item-rating" style="color:var(--text-secondary);">${fmt(it.price)}</div>` : ''}
                </div>`;
            });
        }
        html += `</div>`;
    });
    c.innerHTML = html;
}

async function toggleWish(id, done) {
    try {
        await api(`/api/cash/wishlist/${id}`, 'PATCH', { done: !done });
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// Область вишлиста
function openWishlistAreaModal(id = null) {
    wishAreaCtx = { id };
    const titleEl = document.getElementById('wishlistAreaTitle');
    const nameEl = document.getElementById('wishlistAreaName');
    const delBtn = document.getElementById('wishlistAreaDeleteBtn');

    if (id) {
        const a = wishlistAreas.find(x => x.id === id);
        if (a) { titleEl.textContent = 'Редактировать область'; nameEl.value = a.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая область';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('wishlistAreaModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeWishlistAreaModal() { closeModal('wishlistAreaModal'); }

async function saveWishlistArea() {
    const name = document.getElementById('wishlistAreaName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (wishAreaCtx.id) await api(`/api/cash/wishlist/areas/${wishAreaCtx.id}`, 'PATCH', { name });
        else await api('/api/cash/wishlist/areas', 'POST', { name });
        closeWishlistAreaModal();
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteWishlistAreaFromModal() {
    if (!wishAreaCtx.id) return;
    if (!confirm('Удалить область и все товары в ней?')) return;
    await api(`/api/cash/wishlist/areas/${wishAreaCtx.id}`, 'DELETE');
    closeWishlistAreaModal();
    await loadWishlist();
}

// Товар
function openWishlistModal(id = null, defaultArea = null) {
    wishCtx = { id, url: null };
    const titleEl = document.getElementById('wishlistTitle');
    const nameEl = document.getElementById('wishlistName');
    const priceEl = document.getElementById('wishlistPrice');
    const urlEl = document.getElementById('wishlistUrl');
    const delBtn = document.getElementById('wishlistDeleteBtn');
    const linkBtn = document.getElementById('wishlistOpenLinkBtn');

    const sel = document.getElementById('wishlistAreaSelect');
    sel.innerHTML = wishlistAreas.map(a =>
        `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');

    if (id) {
        const it = wishlistItems.find(x => x.id === id);
        if (it) {
            titleEl.textContent = 'Редактировать товар';
            nameEl.value = it.name;
            priceEl.value = it.price || '';
            urlEl.value = it.url || '';
            sel.value = it.area || '';
            wishCtx.url = it.url || null;
        }
        delBtn.style.display = 'block';
        linkBtn.style.display = wishCtx.url ? 'block' : 'none';
    } else {
        titleEl.textContent = 'Новый товар';
        nameEl.value = '';
        priceEl.value = '';
        urlEl.value = '';
        if (defaultArea) sel.value = defaultArea;
        delBtn.style.display = 'none';
        linkBtn.style.display = 'none';
    }
    openModal('wishlistModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeWishlistModal() { closeModal('wishlistModal'); }

function openWishlistLink() {
    if (wishCtx.url) window.open(wishCtx.url, '_blank');
}

async function saveWishlist() {
    const name = document.getElementById('wishlistName').value.trim();
    if (!name) return alert('Введи название');
    const payload = {
        name,
        price: document.getElementById('wishlistPrice').value,
        area: document.getElementById('wishlistAreaSelect').value,
        url: document.getElementById('wishlistUrl').value,
    };
    try {
        if (wishCtx.id) await api(`/api/cash/wishlist/${wishCtx.id}`, 'PATCH', payload);
        else await api('/api/cash/wishlist', 'POST', payload);
        closeWishlistModal();
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteWishlistFromModal() {
    if (!wishCtx.id) return;
    if (!confirm('Удалить товар?')) return;
    await api(`/api/cash/wishlist/${wishCtx.id}`, 'DELETE');
    closeWishlistModal();
    await loadWishlist();
}

// ==========================================
// ===== CASH: КОПИЛКА =====
// ==========================================
let piggyData = null;
let piggyFilter = 'all';
let piggyCtx = { id: null, type: 'withdraw' };

async function loadPiggy() {
    try {
        piggyData = await api('/api/cash/piggy');
        renderPiggy();
    } catch (e) { console.error(e); }
}

function renderPiggy() {
    const d = piggyData;
    if (!d) return;
    const t = d.totals;

    document.getElementById('piggyGrid').innerHTML = `
        <div class="piggy-hero">
            <div class="piggy-row">
                <div class="piggy-cell">
                    <div class="piggy-cell-value">${fmt(t.balance)}</div>
                    <div class="piggy-cell-label">Копилка</div>
                </div>
                <div class="piggy-cell editable" onclick="openFactModal()">
                    <div class="piggy-cell-value">${fmt(t.fact)}</div>
                    <div class="piggy-cell-label">Есть по факту</div>
                </div>
            </div>
            <div class="piggy-row">
                <div class="piggy-cell">
                    <div class="piggy-cell-value small">${fmt(t.deposited)}</div>
                    <div class="piggy-cell-label">Всего пополнений</div>
                </div>
                <div class="piggy-cell">
                    <div class="piggy-cell-value small debt">${fmt(t.debt)}</div>
                    <div class="piggy-cell-label">Долг</div>
                </div>
            </div>
        </div>
    `;

    const filtered = d.items.filter(x => {
        if (piggyFilter === 'deposit') return x.type === 'deposit';
        if (piggyFilter === 'withdraw') return x.type === 'withdraw';
        return true;
    });

    const filterHtml = `<div class="piggy-filter">
        <button class="piggy-filter-btn ${piggyFilter === 'all' ? 'active' : ''}" onclick="setPiggyFilter('all')">Все</button>
        <button class="piggy-filter-btn ${piggyFilter === 'deposit' ? 'active' : ''}" onclick="setPiggyFilter('deposit')">↓ Пополнения</button>
        <button class="piggy-filter-btn ${piggyFilter === 'withdraw' ? 'active' : ''}" onclick="setPiggyFilter('withdraw')">↑ Списания</button>
    </div>`;

    const list = document.getElementById('piggyList');
    if (!filtered.length) {
        list.innerHTML = filterHtml + `<div class="widget-empty">Пусто</div>`;
        return;
    }
    list.innerHTML = filterHtml + filtered.map(x => `
        <div class="cash-item" onclick="openPiggyModal(${x.id})">
            <div style="flex:1;min-width:0;">
                <div class="cash-item-name">${escapeHtml(x.description || (x.type === 'deposit' ? 'Пополнение' : 'Трата'))}</div>
                <div class="cash-item-date">${formatDate(x.date)}</div>
            </div>
            <div class="cash-item-amount ${x.type === 'withdraw' ? 'minus' : 'plus-green'}">
                ${x.type === 'withdraw' ? '−' : '+'}${fmt(x.amount)}
            </div>
        </div>
    `).join('');
}

function setPiggyFilter(f) { piggyFilter = f; renderPiggy(); }

function openPiggyModal(id = null) {
    piggyCtx = { id, type: 'withdraw' };
    const titleEl = document.getElementById('piggyTitle');
    const descEl = document.getElementById('piggyDesc');
    const amountEl = document.getElementById('piggyAmount');
    const dateEl = document.getElementById('piggyDate');
    const delBtn = document.getElementById('piggyDeleteBtn');

    if (id) {
        const x = piggyData.items.find(i => i.id === id);
        if (x) {
            titleEl.textContent = 'Редактировать запись';
            descEl.value = x.description || '';
            amountEl.value = x.amount;
            dateEl.value = x.date || '';
            piggyCtx.type = x.type;
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая запись';
        descEl.value = '';
        amountEl.value = '';
        dateEl.value = localDate(new Date());
        delBtn.style.display = 'none';
    }

    document.querySelectorAll('#piggyModal [data-ptype]').forEach(b =>
        b.classList.toggle('active', b.dataset.ptype === piggyCtx.type));
    openModal('piggyModal');
}
function closePiggyModal() { closeModal('piggyModal'); }

function pickPiggyType(t, btn) {
    piggyCtx.type = t;
    document.querySelectorAll('#piggyModal [data-ptype]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function savePiggy() {
    const amount = document.getElementById('piggyAmount').value;
    if (!amount) return alert('Введи сумму');
    const payload = {
        type: piggyCtx.type,
        amount,
        description: document.getElementById('piggyDesc').value,
        date: document.getElementById('piggyDate').value || null,
    };
    try {
        if (piggyCtx.id) await api(`/api/cash/piggy/${piggyCtx.id}`, 'PATCH', payload);
        else await api('/api/cash/piggy', 'POST', payload);
        closePiggyModal();
        await loadPiggy();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deletePiggyFromModal() {
    if (!piggyCtx.id) return;
    if (!confirm('Удалить запись?')) return;
    await api(`/api/cash/piggy/${piggyCtx.id}`, 'DELETE');
    closePiggyModal();
    await loadPiggy();
}

function openFactModal() {
    document.getElementById('factAmount').value = piggyData?.totals?.fact || '';
    openModal('factModal');
}
function closeFactModal() { closeModal('factModal'); }
async function saveFact() {
    try {
        await api('/api/cash/piggy/fact', 'POST', { fact_amount: document.getElementById('factAmount').value });
        closeFactModal();
        await loadPiggy();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ==========================================
// ===== GYM: ПРОГРАММЫ =====
// ==========================================
let programs = [];
let openProgramIds = new Set();
let openDayIds = new Set();
let openExerciseIds = new Set();
let programCtx = { id: null };
let dayCtx = { id: null, programId: null };
let exerciseCtx = { id: null, dayId: null };
let setCtx = { id: null, exerciseId: null };

async function loadPrograms() {
    try {
        const { programs: data } = await api('/api/gym/programs');
        programs = data;
        renderPrograms();
    } catch (e) { console.error(e); }
}

function renderPrograms() {
    const c = document.getElementById('programsList');
    if (!programs.length) {
        c.innerHTML = `<div class="empty-state">Нет программ. Нажми +</div>`;
        return;
    }

    c.innerHTML = programs.map(p => {
        const isOpen = openProgramIds.has(p.id);
        return `<div class="program-card ${isOpen ? 'open' : ''}">
            <div class="program-header">
                <span class="program-arrow" onclick="toggleProgram(${p.id})">▶</span>
                <div class="program-name" onclick="openProgramModal(${p.id})">${escapeHtml(p.name)}</div>
            </div>
            <div class="program-body">
                ${p.days.map((d, di) => renderDay(d, di)).join('')}
                <button class="program-add-day" onclick="openDayModal(null, ${p.id})">+ Добавить тренировку</button>
            </div>
        </div>`;
    }).join('');
}

function renderDay(d, di) {
    const isOpen = openDayIds.has(d.id);
    return `<div class="day-block ${isOpen ? 'open' : ''}">
        <div class="day-header" onclick="toggleDay(${d.id})">
            <span class="day-arrow">▶</span>
            <span class="day-num">${di + 1}.</span>
            <span class="day-name">${escapeHtml(d.name)}</span>
            <button class="area-delete" onclick="event.stopPropagation(); openDayModal(${d.id}, ${d.program_id})">✎</button>
        </div>
        <div class="day-body">
            ${d.exercises.map((e, ei) => renderExercise(e, ei)).join('')}
            <button class="day-add-exercise" onclick="openExerciseModal(null, ${d.id})">+ Упражнение</button>
        </div>
    </div>`;
}

function renderExercise(e, ei) {
    const isOpen = openExerciseIds.has(e.id);
    const summary = e.sets.length ? `${e.sets.length} подх.` : 'нет подходов';

    const setsHtml = e.sets.map((s, si) => `
        <div class="set-row">
            <span class="set-num">${si + 1})</span>
            <span class="set-value">${s.reps || '?'} × ${s.weight || '?'}</span>
            <button class="set-del" onclick="openSetModal(${s.id}, ${e.id}, ${s.reps || 'null'}, ${s.weight || 'null'})">✎</button>
        </div>
    `).join('');

    return `<div class="exercise-block ${isOpen ? 'open' : ''}">
        <div class="exercise-header">
            <span class="ex-arrow" onclick="toggleExercise(${e.id})">▶</span>
            <span class="set-num">${ei + 1}.</span>
            <span class="exercise-name" onclick="openExerciseModal(${e.id}, ${e.day_id})">${escapeHtml(e.name)}</span>
            <span class="exercise-summary">${summary}</span>
        </div>
        <div class="exercise-body">
            ${setsHtml}
            <button class="exercise-add-set" onclick="openSetModal(null, ${e.id})">+ подход</button>
        </div>
    </div>`;
}

function toggleProgram(id) {
    if (openProgramIds.has(id)) openProgramIds.delete(id); else openProgramIds.add(id);
    renderPrograms();
}
function toggleDay(id) {
    if (openDayIds.has(id)) openDayIds.delete(id); else openDayIds.add(id);
    renderPrograms();
}
function toggleExercise(id) {
    if (openExerciseIds.has(id)) openExerciseIds.delete(id); else openExerciseIds.add(id);
    renderPrograms();
}

// Программа
function openProgramModal(id = null) {
    programCtx = { id };
    const titleEl = document.getElementById('programTitle');
    const nameEl = document.getElementById('programName');
    const delBtn = document.getElementById('programDeleteBtn');

    if (id) {
        const p = programs.find(x => x.id === id);
        if (p) { titleEl.textContent = 'Редактировать программу'; nameEl.value = p.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая программа';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('programModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeProgramModal() { closeModal('programModal'); }

async function saveProgram() {
    const name = document.getElementById('programName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (programCtx.id) await api(`/api/gym/programs/${programCtx.id}`, 'PATCH', { name });
        else await api('/api/gym/programs', 'POST', { name });
        closeProgramModal();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteProgramFromModal() {
    if (!programCtx.id) return;
    if (!confirm('Удалить программу со всеми тренировками?')) return;
    await api(`/api/gym/programs/${programCtx.id}`, 'DELETE');
    closeProgramModal();
    openProgramIds.delete(programCtx.id);
    await loadPrograms();
}

// День
function openDayModal(id = null, programId = null) {
    dayCtx = { id, programId };
    const titleEl = document.getElementById('dayTitle');
    const nameEl = document.getElementById('dayName');
    const delBtn = document.getElementById('dayDeleteBtn');

    if (id) {
        for (const p of programs) {
            const d = p.days.find(x => x.id === id);
            if (d) { titleEl.textContent = 'Редактировать тренировку'; nameEl.value = d.name; break; }
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая тренировка';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('dayModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeDayModal() { closeModal('dayModal'); }

async function saveDay() {
    const name = document.getElementById('dayName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (dayCtx.id) {
            await api(`/api/gym/days/${dayCtx.id}`, 'PATCH', { name });
        } else {
            await api(`/api/gym/programs/${dayCtx.programId}/days`, 'POST', { name });
            openProgramIds.add(dayCtx.programId);
        }
        closeDayModal();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteDayFromModal() {
    if (!dayCtx.id) return;
    if (!confirm('Удалить тренировку?')) return;
    await api(`/api/gym/days/${dayCtx.id}`, 'DELETE');
    closeDayModal();
    openDayIds.delete(dayCtx.id);
    await loadPrograms();
}

// Упражнение
function openExerciseModal(id = null, dayId = null) {
    exerciseCtx = { id, dayId };
    const titleEl = document.getElementById('exerciseTitle');
    const nameEl = document.getElementById('exerciseName');
    const delBtn = document.getElementById('exerciseDeleteBtn');

    if (id) {
        for (const p of programs) {
            for (const d of p.days) {
                const e = d.exercises.find(x => x.id === id);
                if (e) { titleEl.textContent = 'Редактировать упражнение'; nameEl.value = e.name; break; }
            }
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новое упражнение';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('exerciseModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeExerciseModal() { closeModal('exerciseModal'); }

async function saveExercise() {
    const name = document.getElementById('exerciseName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (exerciseCtx.id) {
            await api(`/api/gym/exercises/${exerciseCtx.id}`, 'PATCH', { name });
        } else {
            await api(`/api/gym/days/${exerciseCtx.dayId}/exercises`, 'POST', { name });
            openDayIds.add(exerciseCtx.dayId);
        }
        closeExerciseModal();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteExerciseFromModal() {
    if (!exerciseCtx.id) return;
    if (!confirm('Удалить упражнение?')) return;
    await api(`/api/gym/exercises/${exerciseCtx.id}`, 'DELETE');
    closeExerciseModal();
    openExerciseIds.delete(exerciseCtx.id);
    await loadPrograms();
}

// Подход
function openSetModal(id = null, exerciseId = null, reps = null, weight = null) {
    setCtx = { id, exerciseId };
    const titleEl = document.getElementById('setTitle');
    const repsEl = document.getElementById('setReps');
    const weightEl = document.getElementById('setWeight');
    const delBtn = document.getElementById('setDeleteBtn');

    titleEl.textContent = id ? 'Редактировать подход' : 'Новый подход';
    repsEl.value = reps !== null ? reps : '';
    weightEl.value = weight !== null ? weight : '';
    delBtn.style.display = id ? 'block' : 'none';

    openModal('setModal');
    setTimeout(() => repsEl.focus(), 200);
}
function closeSetModal() { closeModal('setModal'); }

async function saveSet() {
    const reps = document.getElementById('setReps').value;
    const weight = document.getElementById('setWeight').value;
    if (reps === '' && weight === '') return alert('Заполни повторения или вес');
    try {
        if (setCtx.id) {
            // PATCH подход не реализован — удалим и создадим заново (упрощение)
            await api(`/api/gym/sets/${setCtx.id}`, 'DELETE');
        }
        await api(`/api/gym/exercises/${setCtx.exerciseId}/sets`, 'POST', { reps, weight });
        openExerciseIds.add(setCtx.exerciseId);
        closeSetModal();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteSetFromModal() {
    if (!setCtx.id) return;
    if (!confirm('Удалить подход?')) return;
    await api(`/api/gym/sets/${setCtx.id}`, 'DELETE');
    closeSetModal();
    await loadPrograms();
}

// ==========================================
// ===== GYM: МЕТРИКИ =====
// ==========================================
let metrics = [];
let metricCtx = { id: null, category: 'bio' };
let metricLogCtx = { metricId: null, date: null, logId: null };

async function loadMetrics() {
    try {
        const { metrics: data } = await api('/api/gym/metrics');
        metrics = data;
        renderMetricsTable();
    } catch (e) { console.error(e); }
}

function renderMetricsTable() {
    renderTable('bioTable', metrics.filter(m => m.category === 'bio'));
    renderTable('strengthTable', metrics.filter(m => m.category === 'strength'));
}

function renderTable(containerId, list) {
    const c = document.getElementById(containerId);
    if (!list.length) {
        c.innerHTML = `<div class="widget-empty">Нет метрик. Нажми +</div>`;
        return;
    }

    const datesSet = new Set();
    list.forEach(m => m.logs.forEach(l => datesSet.add(l.date)));
    const dates = [...datesSet].sort();

    let html = `<div class="metrics-table-wrap"><table class="metrics-table"><thead><tr>`;
    html += `<th class="col-name">Метрика</th><th class="col-target">Цель</th>`;
    dates.forEach(d => { html += `<th>${formatDate(d)}</th>`; });
    html += `<th>+</th></tr></thead><tbody>`;

    list.forEach(m => {
        const map = {};
        m.logs.forEach(l => { map[l.date] = l; });
        const unit = m.unit || '';
        const target = m.target ? `${m.target}${unit}` : '—';

        html += `<tr>`;
        html += `<td class="col-name" onclick="openMetricModal('${m.category}', ${m.id})">${escapeHtml(m.name)}</td>`;
        html += `<td class="col-target">${target}</td>`;
        dates.forEach(d => {
            const log = map[d];
            if (log) {
                html += `<td class="cell" onclick="openMetricLogModal(${m.id}, '${d}', ${log.id}, ${log.value})">${log.value}</td>`;
            } else {
                html += `<td class="cell empty" onclick="openMetricLogModal(${m.id}, '${d}', null, null)">—</td>`;
            }
        });
        html += `<td class="cell add-cell" onclick="openMetricLogModal(${m.id}, null, null, null)">+</td>`;
        html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    c.innerHTML = html;

    requestAnimationFrame(() => {
        c.querySelectorAll('.metrics-table-wrap').forEach(wrap => {
            wrap.scrollLeft = wrap.scrollWidth;
        });
    });
}

function openMetricModal(category, id = null) {
    metricCtx = { id, category };
    const titleEl = document.getElementById('metricTitle');
    const nameEl = document.getElementById('metricName');
    const unitEl = document.getElementById('metricUnit');
    const targetEl = document.getElementById('metricTarget');
    const delBtn = document.getElementById('metricDeleteBtn');

    if (id) {
        const m = metrics.find(x => x.id === id);
        if (m) {
            titleEl.textContent = 'Редактировать метрику';
            nameEl.value = m.name;
            unitEl.value = m.unit || 'кг';
            targetEl.value = m.target || '';
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = category === 'bio' ? 'Новая метрика биометрии' : 'Новая метрика силы';
        nameEl.value = '';
        unitEl.value = 'кг';
        targetEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('metricModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeMetricModal() { closeModal('metricModal'); }

async function saveMetric() {
    const name = document.getElementById('metricName').value.trim();
    if (!name) return alert('Введи название');
    const payload = {
        name,
        category: metricCtx.category,
        unit: document.getElementById('metricUnit').value,
        target: document.getElementById('metricTarget').value || null,
    };
    try {
        if (metricCtx.id) await api(`/api/gym/metrics/${metricCtx.id}`, 'PATCH', payload);
        else await api('/api/gym/metrics', 'POST', payload);
        closeMetricModal();
        await loadMetrics();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteMetricFromModal() {
    if (!metricCtx.id) return;
    if (!confirm('Удалить метрику и все её замеры?')) return;
    await api(`/api/gym/metrics/${metricCtx.id}`, 'DELETE');
    closeMetricModal();
    await loadMetrics();
}

function openMetricLogModal(metricId, date, logId, value) {
    metricLogCtx = { metricId, date, logId };
    const m = metrics.find(x => x.id === metricId);
    document.getElementById('metricLogTitle').textContent =
        m ? m.name + (m.unit ? ` (${m.unit})` : '') : 'Замер';
    document.getElementById('logValue').value = (value !== null && value !== undefined) ? value : '';
    document.getElementById('logDate').value = date || localDate(new Date());
    document.getElementById('logDeleteBtn').style.display = logId ? 'block' : 'none';
    openModal('metricLogModal');
    setTimeout(() => document.getElementById('logValue').focus(), 200);
}
function closeMetricLogModal() { closeModal('metricLogModal'); }

async function saveMetricLog() {
    const value = document.getElementById('logValue').value;
    if (value === '') return alert('Введи значение');
    try {
        await api(`/api/gym/metrics/${metricLogCtx.metricId}/logs`, 'POST', {
            value, date: document.getElementById('logDate').value,
        });
        closeMetricLogModal();
        await loadMetrics();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteLogFromModal() {
    if (!metricLogCtx.logId) return;
    if (!confirm('Удалить замер?')) return;
    await api(`/api/gym/metrics/logs/${metricLogCtx.logId}`, 'DELETE');
    closeMetricLogModal();
    await loadMetrics();
}

// ==========================================
// ===== FILM =====
// ==========================================
let filmGenres = [];
let filmOrphans = [];
let filmGenreCtx = { id: null };
let filmCtx = { id: null, genreId: null, priority: null, status: 'want' };
let filmRandomType = 'want';

async function loadFilm() {
    try {
        const { genres, orphans } = await api('/api/film');
        filmGenres = genres;
        filmOrphans = orphans;
        renderFilmGenres();
        renderFilmWatched();
    } catch (e) { console.error(e); }
}

function renderFilmGenres() {
    const c = document.getElementById('filmGenres');
    const all = [...filmGenres, { id: null, name: 'Без жанра', movies: filmOrphans }];

    c.innerHTML = all.map(g => {
        const isOrphan = !g.id;
        const movies = (g.movies || []).filter(m => m.status !== 'watched');
        const nameClick = isOrphan ? '' : `onclick="openFilmGenreModal(${g.id})"`;
        return `<div class="film-genre-card">
            <div class="group-header">
                <div class="group-name ${isOrphan ? '' : 'clickable'}" ${nameClick}>${escapeHtml(g.name)}</div>
                <div class="group-count">${movies.length}</div>
                <button class="btn-icon-add" onclick="openFilmModal(null, ${isOrphan ? 'null' : g.id})">+</button>
            </div>
            ${movies.length === 0 ? `<div class="widget-empty">Пусто</div>`
                : movies.map(m => filmItemHTML(m)).join('')}
        </div>`;
    }).join('');
}

function filmItemHTML(m) {
    const p = m.priority || 0;
    const pClass = p >= 5 ? 'p5' : p >= 4 ? 'p4' : p >= 3 ? 'p3' : '';
    const statusLabels = { want: 'Хочу', watching: 'Смотрю', watched: 'Видел' };
    return `<div class="list-item" onclick="openFilmModal(${m.id})">
        ${p ? `<div class="item-priority ${pClass}">${p}</div>` : ''}
        <div class="item-info">
            <div class="item-title">${escapeHtml(m.title)}</div>
            <div class="item-sub">${m.year || ''}${m.review ? ' · ' + escapeHtml(m.review.slice(0, 40)) : ''}</div>
        </div>
        ${m.rating ? `<div class="item-rating">★ ${m.rating}</div>` : ''}
        <div class="item-badge ${m.status}">${statusLabels[m.status] || ''}</div>
    </div>`;
}

function renderFilmWatched() {
    const c = document.getElementById('filmWatched');
    const byGenre = [];
    filmGenres.forEach(g => {
        const watched = (g.movies || []).filter(m => m.status === 'watched');
        if (watched.length) byGenre.push({ name: g.name, movies: watched });
    });
    const orphans = filmOrphans.filter(m => m.status === 'watched');
    if (orphans.length) byGenre.push({ name: 'Без жанра', movies: orphans });

    if (!byGenre.length) {
        c.innerHTML = `<div class="empty-state">Пока ничего не посмотрел</div>`;
        return;
    }

    c.innerHTML = byGenre.map(g => {
        const sorted = [...g.movies].sort((a, b) => (b.rating || 0) - (a.rating || 0));
        return `<div class="film-genre-card">
            <div class="group-header">
                <div class="group-name">${escapeHtml(g.name)}</div>
                <div class="group-count">${sorted.length}</div>
            </div>
            ${sorted.map(m => filmItemHTML(m)).join('')}
        </div>`;
    }).join('');
}

function openFilmGenreModal(id = null) {
    filmGenreCtx = { id };
    const titleEl = document.getElementById('filmGenreTitle');
    const nameEl = document.getElementById('filmGenreName');
    const delBtn = document.getElementById('filmGenreDeleteBtn');

    if (id) {
        const g = filmGenres.find(x => x.id === id);
        if (g) { titleEl.textContent = 'Редактировать жанр'; nameEl.value = g.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новый жанр';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('filmGenreModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeFilmGenreModal() { closeModal('filmGenreModal'); }

async function saveFilmGenre() {
    const name = document.getElementById('filmGenreName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (filmGenreCtx.id) await api(`/api/film/genres/${filmGenreCtx.id}`, 'PATCH', { name });
        else await api('/api/film/genres', 'POST', { name });
        closeFilmGenreModal();
        await loadFilm();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteFilmGenreFromModal() {
    if (!filmGenreCtx.id) return;
    if (!confirm('Удалить жанр? Фильмы останутся без жанра.')) return;
    await api(`/api/film/genres/${filmGenreCtx.id}`, 'DELETE');
    closeFilmGenreModal();
    await loadFilm();
}

function openFilmModal(id = null, genreId = null) {
    filmCtx = { id, genreId, priority: null, status: 'want' };
    const titleEl = document.getElementById('filmTitle');
    const nameEl = document.getElementById('filmName');
    const yearEl = document.getElementById('filmYear');
    const ratingEl = document.getElementById('filmRating');
    const reviewEl = document.getElementById('filmReview');
    const delBtn = document.getElementById('filmDeleteBtn');
    const sel = document.getElementById('filmGenreSelect');

    sel.innerHTML = `<option value="">Без жанра</option>` +
        filmGenres.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

    if (id) {
        let movie = null;
        for (const g of filmGenres) { const m = g.movies.find(x => x.id === id); if (m) { movie = m; break; } }
        if (!movie) movie = filmOrphans.find(x => x.id === id);

        if (movie) {
            titleEl.textContent = 'Редактировать фильм';
            nameEl.value = movie.title;
            yearEl.value = movie.year || '';
            sel.value = movie.genre_id || '';
            ratingEl.value = movie.rating || '';
            reviewEl.value = movie.review || '';
            filmCtx.priority = movie.priority || null;
            filmCtx.status = movie.status || 'want';
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новый фильм';
        nameEl.value = '';
        yearEl.value = '';
        ratingEl.value = '';
        reviewEl.value = '';
        if (genreId) sel.value = genreId;
        delBtn.style.display = 'none';
    }

    document.querySelectorAll('#filmPriority button').forEach(b =>
        b.classList.toggle('active', filmCtx.priority === parseInt(b.dataset.p)));
    document.querySelectorAll('#filmStatusTabs [data-st]').forEach(b =>
        b.classList.toggle('active', b.dataset.st === filmCtx.status));

    openModal('filmModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeFilmModal() { closeModal('filmModal'); }

function pickFilmPriority(p, btn) {
    if (filmCtx.priority === p) {
        filmCtx.priority = null;
        btn.classList.remove('active');
    } else {
        filmCtx.priority = p;
        document.querySelectorAll('#filmPriority button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

function pickFilmStatus(st, btn) {
    filmCtx.status = st;
    document.querySelectorAll('#filmStatusTabs [data-st]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function saveFilm() {
    const title = document.getElementById('filmName').value.trim();
    if (!title) return alert('Введи название');
    const genreVal = document.getElementById('filmGenreSelect').value;
    const payload = {
        title,
        year: document.getElementById('filmYear').value || null,
        genre_id: genreVal ? parseInt(genreVal) : null,
        priority: filmCtx.priority,
        status: filmCtx.status,
        rating: document.getElementById('filmRating').value || null,
        review: document.getElementById('filmReview').value || null,
    };
    try {
        if (filmCtx.id) await api(`/api/film/movies/${filmCtx.id}`, 'PATCH', payload);
        else await api('/api/film/movies', 'POST', payload);
        closeFilmModal();
        await loadFilm();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteFilmFromModal() {
    if (!filmCtx.id) return;
    if (!confirm('Удалить фильм?')) return;
    await api(`/api/film/movies/${filmCtx.id}`, 'DELETE');
    closeFilmModal();
    await loadFilm();
}

async function randomMovie(type) {
    filmRandomType = type;
    try {
        const { movie } = await api(`/api/film/random?type=${type}`);
        const box = document.getElementById('randomFilmBox');
        const titleEl = document.getElementById('randomFilmTitle');
        titleEl.textContent = type === 'rewatch' ? '🔁 Что пересмотреть?' : '🎬 Что посмотреть?';
        if (!movie) {
            box.innerHTML = `<div class="film-meta-random">${
                type === 'rewatch' ? 'Нет просмотренных фильмов' : 'Пусто — добавь фильмы со статусом «Хочу»'
            }</div>`;
        } else {
            box.innerHTML = `
                <div class="film-title-random">${escapeHtml(movie.title)}</div>
                <div class="film-meta-random">${[
                    movie.year, movie.rating ? `★ ${movie.rating}` : null,
                    movie.priority ? `Приоритет ${movie.priority}` : null,
                ].filter(Boolean).join(' · ')}</div>`;
        }
        openModal('randomFilmModal');
    } catch (e) { alert('Ошибка: ' + e.message); }
}
function randomAgain() { randomMovie(filmRandomType); }
function closeRandomFilm() { closeModal('randomFilmModal'); }

// ==========================================
// ===== TEA =====
// ==========================================
let teaGroups = [];
let teaOrphans = [];
let teaShops = [];
let teaGroupCtx = { id: null };
let teaCtx = { id: null, rating: null };
let teaShopCtx = { id: null };

async function loadTea() {
    try {
        const { groups, orphans, shops } = await api('/api/tea');
        teaGroups = groups;
        teaOrphans = orphans;
        teaShops = shops;
        renderTea();
        renderTeaShops();
    } catch (e) { console.error(e); }
}

function renderTea() {
    const c = document.getElementById('teaGroups');
    const all = [...teaGroups];
    if (teaOrphans.length) all.push({ id: null, name: 'Без группы', items: teaOrphans });

    if (!all.length) {
        c.innerHTML = `<div class="empty-state">Нет чая. Нажми +</div>`;
        return;
    }

    c.innerHTML = all.map(g => {
        const isOrphan = !g.id;
        const nameClick = isOrphan ? '' : `onclick="openTeaGroupModal(${g.id})"`;
        return `<div class="tea-group-card">
            <div class="group-header">
                <div class="group-name ${isOrphan ? '' : 'clickable'}" ${nameClick}>${escapeHtml(g.name)}</div>
                <div class="group-count">${g.items.length}</div>
                ${isOrphan ? '' : `<button class="btn-icon-add" onclick="openTeaModal(null, ${g.id})">+</button>`}
            </div>
            ${g.items.length === 0 ? `<div class="widget-empty">Пусто</div>`
                : g.items.map(i => teaItemHTML(i)).join('')}
        </div>`;
    }).join('');
}

function teaItemHTML(i) {
    const parts = [];
    if (i.temp_c) parts.push(`${i.temp_c}°C`);
    if (i.review) parts.push(escapeHtml(i.review.slice(0, 40)));
    return `<div class="list-item" onclick="openTeaModal(${i.id})">
        <div class="item-info">
            <div class="item-title">${escapeHtml(i.name)}</div>
            <div class="item-sub">${parts.join(' · ') || '—'}</div>
        </div>
        ${i.rating ? `<div class="item-rating">★ ${i.rating}</div>` : ''}
    </div>`;
}

function renderTeaShops() {
    const c = document.getElementById('teaShops');
    if (!teaShops.length) {
        c.innerHTML = `<div class="widget-empty">Нет магазинов</div>`;
        return;
    }
    c.innerHTML = teaShops.map(s => `
        <div class="tea-shop-item" onclick="openTeaShopModal(${s.id})">
            <div class="tea-shop-info">
                ${s.name ? `<div class="tea-shop-name">${escapeHtml(s.name)}</div>` : ''}
                <div class="tea-shop-url">${escapeHtml(s.url)}</div>
            </div>
        </div>
    `).join('');
}

function openTeaGroupModal(id = null) {
    teaGroupCtx = { id };
    const titleEl = document.getElementById('teaGroupTitle');
    const nameEl = document.getElementById('teaGroupName');
    const delBtn = document.getElementById('teaGroupDeleteBtn');

    if (id) {
        const g = teaGroups.find(x => x.id === id);
        if (g) { titleEl.textContent = 'Редактировать группу'; nameEl.value = g.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новая группа';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('teaGroupModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeTeaGroupModal() { closeModal('teaGroupModal'); }

async function saveTeaGroup() {
    const name = document.getElementById('teaGroupName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (teaGroupCtx.id) await api(`/api/tea/groups/${teaGroupCtx.id}`, 'PATCH', { name });
        else await api('/api/tea/groups', 'POST', { name });
        closeTeaGroupModal();
        await loadTea();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteTeaGroupFromModal() {
    if (!teaGroupCtx.id) return;
    if (!confirm('Удалить группу? Чай останется без группы.')) return;
    await api(`/api/tea/groups/${teaGroupCtx.id}`, 'DELETE');
    closeTeaGroupModal();
    await loadTea();
}

function openTeaModal(id = null, groupId = null) {
    teaCtx = { id, rating: null };
    const titleEl = document.getElementById('teaTitle');
    const nameEl = document.getElementById('teaName');
    const tempEl = document.getElementById('teaTemp');
    const reviewEl = document.getElementById('teaReview');
    const delBtn = document.getElementById('teaDeleteBtn');
    const sel = document.getElementById('teaGroupSelect');

    sel.innerHTML = `<option value="">Без группы</option>` +
        teaGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');

    if (id) {
        let item = null;
        for (const g of teaGroups) { const x = g.items.find(y => y.id === id); if (x) { item = x; break; } }
        if (!item) item = teaOrphans.find(x => x.id === id);

        if (item) {
            titleEl.textContent = 'Редактировать чай';
            nameEl.value = item.name;
            tempEl.value = item.temp_c || '';
            reviewEl.value = item.review || '';
            sel.value = item.group_id || '';
            teaCtx.rating = item.rating || null;
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новый чай';
        nameEl.value = '';
        tempEl.value = '';
        reviewEl.value = '';
        if (groupId) sel.value = groupId;
        delBtn.style.display = 'none';
    }

    document.querySelectorAll('#teaRating button').forEach(b =>
        b.classList.toggle('active', teaCtx.rating === parseInt(b.dataset.r)));
    openModal('teaModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeTeaModal() { closeModal('teaModal'); }

function pickTeaRating(r, btn) {
    if (teaCtx.rating === r) {
        teaCtx.rating = null;
        btn.classList.remove('active');
    } else {
        teaCtx.rating = r;
        document.querySelectorAll('#teaRating button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

async function saveTea() {
    const name = document.getElementById('teaName').value.trim();
    if (!name) return alert('Введи название');
    const gVal = document.getElementById('teaGroupSelect').value;
    const payload = {
        name,
        group_id: gVal ? parseInt(gVal) : null,
        temp_c: document.getElementById('teaTemp').value || null,
        review: document.getElementById('teaReview').value || null,
        rating: teaCtx.rating,
    };
    try {
        if (teaCtx.id) await api(`/api/tea/items/${teaCtx.id}`, 'PATCH', payload);
        else await api('/api/tea/items', 'POST', payload);
        closeTeaModal();
        await loadTea();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteTeaFromModal() {
    if (!teaCtx.id) return;
    if (!confirm('Удалить чай?')) return;
    await api(`/api/tea/items/${teaCtx.id}`, 'DELETE');
    closeTeaModal();
    await loadTea();
}

function openTeaShopModal(id = null) {
    teaShopCtx = { id };
    const titleEl = document.getElementById('teaShopTitle');
    const nameEl = document.getElementById('teaShopName');
    const urlEl = document.getElementById('teaShopUrl');
    const delBtn = document.getElementById('teaShopDeleteBtn');

    if (id) {
        const s = teaShops.find(x => x.id === id);
        if (s) { titleEl.textContent = 'Редактировать магазин'; nameEl.value = s.name || ''; urlEl.value = s.url; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новый магазин';
        nameEl.value = '';
        urlEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('teaShopModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closeTeaShopModal() { closeModal('teaShopModal'); }

async function saveTeaShop() {
    const url = document.getElementById('teaShopUrl').value.trim();
    if (!url) return alert('Введи ссылку');
    const payload = { name: document.getElementById('teaShopName').value, url };
    try {
        if (teaShopCtx.id) await api(`/api/tea/shops/${teaShopCtx.id}`, 'PATCH', payload);
        else await api('/api/tea/shops', 'POST', payload);
        closeTeaShopModal();
        await loadTea();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteTeaShopFromModal() {
    if (!teaShopCtx.id) return;
    if (!confirm('Удалить магазин?')) return;
    await api(`/api/tea/shops/${teaShopCtx.id}`, 'DELETE');
    closeTeaShopModal();
    await loadTea();
}

// ==========================================
// ===== PLACES =====
// ==========================================
let placesTypes = [];
let placesOrphans = [];
let placeTypeCtx = { id: null };
let placeCtx = { id: null, typeId: null, priority: null, status: 'want' };
let placesFilter = { type: '', city: '', rating: '' };

async function loadPlaces() {
    try {
        const { types, orphans } = await api('/api/places');
        placesTypes = types;
        placesOrphans = orphans;
        updatePlacesFilters();
        renderPlacesWant();
        renderPlacesVisited();
    } catch (e) { console.error(e); }
}

function updatePlacesFilters() {
    const typeSel = document.getElementById('placesFilterType');
    const curType = typeSel.value;
    typeSel.innerHTML = `<option value="">Все типы</option>` +
        placesTypes.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    typeSel.value = curType;

    const allItems = [];
    placesTypes.forEach(t => (t.items || []).forEach(i => allItems.push(i)));
    placesOrphans.forEach(i => allItems.push(i));
    const cities = [...new Set(allItems.map(i => i.city).filter(Boolean))].sort();

    const citySel = document.getElementById('placesFilterCity');
    const curCity = citySel.value;
    citySel.innerHTML = `<option value="">Все города</option>` +
        cities.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    citySel.value = curCity;
}

function onPlacesFilterChange() {
    placesFilter.type = document.getElementById('placesFilterType').value;
    placesFilter.city = document.getElementById('placesFilterCity').value;
    placesFilter.rating = document.getElementById('placesFilterRating').value;
    renderPlacesWant();
    renderPlacesVisited();
}

function placeMatchesFilter(p) {
    if (placesFilter.type && String(p.type_id) !== placesFilter.type) return false;
    if (placesFilter.city && (p.city || '') !== placesFilter.city) return false;
    if (placesFilter.rating && (!p.rating || p.rating < parseInt(placesFilter.rating))) return false;
    return true;
}

function renderPlacesWant() {
    const c = document.getElementById('placesWantList');
    const all = [...placesTypes, { id: null, name: 'Без типа', items: placesOrphans }];

    c.innerHTML = all.map(t => {
        const isOrphan = !t.id;
        const items = (t.items || []).filter(i => i.status !== 'visited' && placeMatchesFilter(i));
        const nameClick = isOrphan ? '' : `onclick="openPlaceTypeModal(${t.id})"`;
        return `<div class="place-card">
            <div class="group-header">
                <div class="group-name ${isOrphan ? '' : 'clickable'}" ${nameClick}>${escapeHtml(t.name)}</div>
                <div class="group-count">${items.length}</div>
                <button class="btn-icon-add" onclick="openPlaceModal(null, ${isOrphan ? 'null' : t.id})">+</button>
            </div>
            ${items.length === 0 ? `<div class="widget-empty">Пусто</div>`
                : items.map(p => placeItemHTML(p)).join('')}
        </div>`;
    }).join('');
}

function renderPlacesVisited() {
    const c = document.getElementById('placesVisitedList');
    const byType = [];
    placesTypes.forEach(t => {
        const visited = (t.items || []).filter(i => i.status === 'visited' && placeMatchesFilter(i));
        if (visited.length) byType.push({ name: t.name, items: visited });
    });
    const orphans = placesOrphans.filter(i => i.status === 'visited' && placeMatchesFilter(i));
    if (orphans.length) byType.push({ name: 'Без типа', items: orphans });

    if (!byType.length) {
        c.innerHTML = `<div class="empty-state">Пока ничего не посетил</div>`;
        return;
    }

    c.innerHTML = byType.map(t => {
        const sorted = [...t.items].sort((a, b) => (b.rating || 0) - (a.rating || 0));
        return `<div class="place-card">
            <div class="group-header">
                <div class="group-name">${escapeHtml(t.name)}</div>
                <div class="group-count">${sorted.length}</div>
            </div>
            ${sorted.map(p => placeItemHTML(p)).join('')}
        </div>`;
    }).join('');
}

function placeItemHTML(p) {
    const pr = p.priority || 0;
    const pClass = pr >= 5 ? 'p5' : pr >= 4 ? 'p4' : pr >= 3 ? 'p3' : '';
    const parts = [];
    if (p.city) parts.push(p.city);
    if (p.country) parts.push(p.country);
    return `<div class="list-item" onclick="openPlaceModal(${p.id})">
        ${pr ? `<div class="item-priority ${pClass}">${pr}</div>` : ''}
        <div class="item-info">
            <div class="item-title">${escapeHtml(p.name)}</div>
            <div class="item-sub">${parts.join(', ') || '—'}</div>
        </div>
        ${p.rating ? `<div class="item-rating">★ ${p.rating}</div>` : ''}
    </div>`;
}

function openPlaceTypeModal(id = null) {
    placeTypeCtx = { id };
    const titleEl = document.getElementById('placeTypeTitle');
    const nameEl = document.getElementById('placeTypeName');
    const delBtn = document.getElementById('placeTypeDeleteBtn');

    if (id) {
        const t = placesTypes.find(x => x.id === id);
        if (t) { titleEl.textContent = 'Редактировать тип'; nameEl.value = t.name; }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новый тип';
        nameEl.value = '';
        delBtn.style.display = 'none';
    }
    openModal('placeTypeModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closePlaceTypeModal() { closeModal('placeTypeModal'); }

async function savePlaceType() {
    const name = document.getElementById('placeTypeName').value.trim();
    if (!name) return alert('Введи название');
    try {
        if (placeTypeCtx.id) await api(`/api/places/types/${placeTypeCtx.id}`, 'PATCH', { name });
        else await api('/api/places/types', 'POST', { name });
        closePlaceTypeModal();
        await loadPlaces();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deletePlaceTypeFromModal() {
    if (!placeTypeCtx.id) return;
    if (!confirm('Удалить тип? Места останутся без типа.')) return;
    await api(`/api/places/types/${placeTypeCtx.id}`, 'DELETE');
    closePlaceTypeModal();
    await loadPlaces();
}

function openPlaceModal(id = null, typeId = null) {
    placeCtx = { id, typeId, priority: null, status: 'want' };
    const titleEl = document.getElementById('placeTitle');
    const nameEl = document.getElementById('placeName');
    const cityEl = document.getElementById('placeCity');
    const countryEl = document.getElementById('placeCountry');
    const mapEl = document.getElementById('placeMapUrl');
    const ratingEl = document.getElementById('placeRating');
    const reviewEl = document.getElementById('placeReview');
    const delBtn = document.getElementById('placeDeleteBtn');
    const mapBtn = document.getElementById('placeOpenMapBtn');
    const sel = document.getElementById('placeTypeSelect');

    sel.innerHTML = `<option value="">Без типа</option>` +
        placesTypes.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

    if (id) {
        let item = null;
        for (const t of placesTypes) { const x = t.items.find(y => y.id === id); if (x) { item = x; break; } }
        if (!item) item = placesOrphans.find(x => x.id === id);

        if (item) {
            titleEl.textContent = 'Редактировать место';
            nameEl.value = item.name;
            cityEl.value = item.city || '';
            countryEl.value = item.country || '';
            mapEl.value = item.map_url || '';
            ratingEl.value = item.rating || '';
            reviewEl.value = item.review || '';
            sel.value = item.type_id || '';
            placeCtx.priority = item.priority || null;
            placeCtx.status = item.status || 'want';
            mapBtn.style.display = item.map_url ? 'block' : 'none';
        }
        delBtn.style.display = 'block';
    } else {
        titleEl.textContent = 'Новое место';
        nameEl.value = '';
        cityEl.value = '';
        countryEl.value = '';
        mapEl.value = '';
        ratingEl.value = '';
        reviewEl.value = '';
        if (typeId) sel.value = typeId;
        delBtn.style.display = 'none';
        mapBtn.style.display = 'none';
    }

    document.querySelectorAll('#placePriority button').forEach(b =>
        b.classList.toggle('active', placeCtx.priority === parseInt(b.dataset.p)));
    document.querySelectorAll('#placeStatusTabs [data-st]').forEach(b =>
        b.classList.toggle('active', b.dataset.st === placeCtx.status));

    openModal('placeModal');
    setTimeout(() => nameEl.focus(), 200);
}
function closePlaceModal() { closeModal('placeModal'); }

function pickPlacePriority(p, btn) {
    if (placeCtx.priority === p) {
        placeCtx.priority = null;
        btn.classList.remove('active');
    } else {
        placeCtx.priority = p;
        document.querySelectorAll('#placePriority button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

function pickPlaceStatus(st, btn) {
    placeCtx.status = st;
    document.querySelectorAll('#placeStatusTabs [data-st]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

async function savePlace() {
    const name = document.getElementById('placeName').value.trim();
    if (!name) return alert('Введи название');
    const typeVal = document.getElementById('placeTypeSelect').value;
    const payload = {
        name,
        type_id: typeVal ? parseInt(typeVal) : null,
        city: document.getElementById('placeCity').value,
        country: document.getElementById('placeCountry').value,
        map_url: document.getElementById('placeMapUrl').value,
        status: placeCtx.status,
        priority: placeCtx.priority,
        rating: document.getElementById('placeRating').value || null,
        review: document.getElementById('placeReview').value || null,
    };
    try {
        if (placeCtx.id) await api(`/api/places/items/${placeCtx.id}`, 'PATCH', payload);
        else await api('/api/places/items', 'POST', payload);
        closePlaceModal();
        await loadPlaces();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deletePlaceFromModal() {
    if (!placeCtx.id) return;
    if (!confirm('Удалить место?')) return;
    await api(`/api/places/items/${placeCtx.id}`, 'DELETE');
    closePlaceModal();
    await loadPlaces();
}

function openPlaceMap() {
    const url = document.getElementById('placeMapUrl').value.trim();
    if (url) window.open(url, '_blank');
}

// ==========================================
// ===== BACKUP =====
// ==========================================
async function backupDownload(section) {
    try {
        const endpoint = section === 'all' ? '/api/backup/all' : `/api/backup/section/${section}`;
        const data = await api(endpoint);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tracker-${section}-${localDate(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function backupGithub(section = 'all') {
    try {
        const { file } = await api('/api/backup/save-github', 'POST', { section });
        alert('✅ Сохранено: ' + file);
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function backupToTelegram(section = 'all') {
    try {
        await api('/api/backup/send-tg', 'POST', { section });
        alert('✅ Отправлено в чат с ботом');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ==========================================
// ===== СТАРТ =====
// ==========================================
(async function start() {
    goToScreen(0);
    const ok = await auth();
    if (ok) {
        await loadMain();
    }
})();