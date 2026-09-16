// ===== СОСТОЯНИЕ =====
let tgUser = { id: 0, name: 'Друг' };
let initData = '';
let currentUser = null;
let tg = null;
const TOTAL_MAIN_SCREENS = 8;
let currentScreenIndex = 0;

// ===== TELEGRAM INIT =====
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

// ===== API =====
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

// ===== AUTH =====
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

// ===== SCREENS =====
const track = document.getElementById('screensTrack');
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
        const t = btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;
        nav.scrollTo({ left: t, behavior: animate ? 'smooth' : 'auto' });
    }
    window.scrollTo(0, 0);

    if (index === 0) loadHome();
    if (index === 1) { loadAreas(); loadHabits(); loadWeek(); loadMonthChart(); }
    if (index === 2) { loadBudget(); loadWishlist(); loadPiggy(); }
    if (index === 3) { loadPrograms(); loadMetrics(); }
    if (index === 5) { loadFilm(); }
}

// ===== SUBTABS =====
function switchSubTab(parent, tab, btn) {
    btn.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const ps = btn.closest('.screen');
    ps.querySelectorAll('.subtab').forEach(st => st.classList.remove('active'));
    const target = document.getElementById(`${parent}-${tab}`);
    if (target) target.classList.add('active');
}

// ===== SETTINGS =====
function openSettings() {
    updateSettingsUI();
    track.style.transform = `translateX(-${TOTAL_MAIN_SCREENS * 100}vw)`;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
}
function closeSettings() { goToScreen(currentScreenIndex); }
function updateSettingsUI() {
    const name = currentUser?.name || tgUser.name || 'Друг';
    document.getElementById('settingsUserName').textContent = name;
    document.getElementById('settingsUserId').textContent = 'ID: ' + (currentUser?.id || tgUser.id || '—');
    document.getElementById('settingsAvatar').textContent = (name[0] || '?').toUpperCase();
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
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ===== HOME =====
async function loadHome() {
    try { renderHome(await api('/api/home')); } catch (e) { console.error(e); }
}
function renderHome(data) {
    renderGreeting();
    const widgets = document.getElementById('homeWidgets');
    const habitsToday = data.habits.filter(h => h.doneToday).length;
    const habitsTotal = data.habits.length;
    let html = '';
    if (habitsTotal > 0) {
        html += `<div class="stats-row">
            <div class="stat-box"><div class="stat-box-value">${habitsToday}/${habitsTotal}</div><div class="stat-box-label">Сегодня</div></div>
            <div class="stat-box"><div class="stat-box-value">${data.habits.reduce((m,h) => Math.max(m,h.streak), 0)}</div><div class="stat-box-label">🔥 Рекорд</div></div>
        </div>`;
    }
    html += `<div class="widget"><div class="widget-title"><span>Привычки сегодня</span>${habitsTotal > 0 ? `<span class="widget-title-count">${habitsToday}/${habitsTotal}</span>` : ''}</div>`;
    if (habitsTotal === 0) html += `<div class="widget-empty">Пока нет привычек</div>`;
    else {
        html += `<div class="habits-today-list">`;
        data.habits.forEach(h => {
            html += `<button class="habit-quick ${h.doneToday ? 'done' : ''}" onclick="quickToggleHabit(${h.id})">
                <div class="habit-quick-check">✓</div>
                <div class="habit-quick-name">${escapeHtml(h.name)}</div>
                ${h.streak > 0 ? `<div class="habit-quick-streak">🔥 ${h.streak}</div>` : ''}
            </button>`;
        });
        html += `</div>`;
    }
    html += `</div>`;

    const awg = data.areas.filter(a => a.total > 0);
    html += `<div class="widget"><div class="widget-title"><span>Прогресс целей</span></div>`;
    if (awg.length === 0) html += `<div class="widget-empty">Пока нет целей</div>`;
    else awg.forEach(a => {
        const pct = a.total > 0 ? (a.done / a.total * 100) : 0;
        html += `<div class="area-progress-row">
            <div class="area-progress-name">${escapeHtml(a.name)}</div>
            <div class="area-progress-bar"><div class="area-progress-fill" style="width:${pct}%"></div></div>
            <div class="area-progress-count">${a.done}/${a.total}</div>
        </div>`;
    });
    html += `</div>`;
    widgets.innerHTML = html;
}
function renderGreeting() {
    const h = new Date().getHours();
    const g = h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    document.getElementById('homeGreeting').textContent = `${g}, ${tgUser.name}`;
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const d = new Date();
    document.getElementById('homeDate').textContent = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}
async function quickToggleHabit(id) {
    const today = new Date().toISOString().slice(0,10);
    await api(`/api/disc/habits/${id}/toggle`, 'POST', { date: today });
    await loadHome();
}

// ===== HABITS =====
let habits = [];
async function loadHabits() {
    try { const { habits: d } = await api('/api/disc/habits'); habits = d; } catch (e) { console.error(e); }
}

let weekStart = getMonday(new Date());
function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0,0,0,0);
    return date;
}
async function loadWeek() {
    const start = weekStart.toISOString().slice(0,10);
    try { const { habits: d } = await api(`/api/disc/habits/week?start=${start}`); renderWeek(d); }
    catch (e) { console.error(e); }
}
function renderWeek(data) {
    const rangeEl = document.getElementById('weekRange');
    const grid = document.getElementById('weekGrid');
    const end = new Date(weekStart); end.setDate(end.getDate() + 6);
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    rangeEl.textContent = `${weekStart.getDate()} ${months[weekStart.getMonth()]} — ${end.getDate()} ${months[end.getMonth()]}`;
    if (!data?.length) { grid.innerHTML = `<div class="empty-state">Нет привычек. Нажми +</div>`; return; }
    const today = new Date().toISOString().slice(0,10);
    const dn = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    let html = `<div class="week-grid-table"><div class="week-header"><div class="week-header-cell">Привычка</div>`;
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart); d.setDate(d.getDate() + i);
        const ds = d.toISOString().slice(0,10);
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
    await api(`/api/disc/habits/${habitId}/toggle`, 'POST', { date });
    await loadWeek();
    await loadMonthChart();
}
function weekPrev() { weekStart.setDate(weekStart.getDate() - 7); loadWeek(); }
function weekNext() { weekStart.setDate(weekStart.getDate() + 7); loadWeek(); }

// Chart
async function loadMonthChart() {
    try {
        const { year, month, days } = await api('/api/disc/habits/month-stats');
        const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
        document.getElementById('chartTitle').textContent = `Активность — ${months[month - 1]}`;
        const max = Math.max(1, ...days.map(d => d.count));
        const today = new Date().toISOString().slice(0,10);
        document.getElementById('habitsChart').innerHTML = days.map(d => {
            const h = Math.max(4, (d.count / max) * 100);
            const cls = ['chart-bar', d.count === 0 ? 'zero' : '', d.date === today ? 'today' : ''].filter(Boolean).join(' ');
            return `<div class="${cls}" style="height:${h}%"></div>`;
        }).join('');
        document.getElementById('chartLegend').innerHTML = `<span>1</span><span>${Math.ceil(days.length/2)}</span><span>${days.length}</span>`;
    } catch (e) { console.error(e); }
}

// Habit modal
let habitCtx = { id: null, freq: 'daily', days: [1,2,3,4,5,6,7], interval: 2 };
function openHabitModal(id = null) {
    habitCtx = { id, freq: 'daily', days: [1,2,3,4,5,6,7], interval: 2 };
    const titleEl = document.getElementById('habitModalTitle');
    const nameEl = document.getElementById('habitName');
    if (id) {
        const h = habits.find(x => x.id === id);
        if (h) {
            titleEl.textContent = 'Настройки';
            nameEl.value = h.name;
            habitCtx.freq = h.frequency || 'daily';
            habitCtx.days = h.days_of_week?.length ? h.days_of_week : [1,2,3,4,5,6,7];
            habitCtx.interval = h.interval_days || 2;
        }
    } else { titleEl.textContent = 'Новая привычка'; nameEl.value = ''; }
    document.getElementById('intervalInput').value = habitCtx.interval;
    document.querySelectorAll('#habitModal [data-freq]').forEach(b => b.classList.toggle('active', b.dataset.freq === habitCtx.freq));
    document.querySelectorAll('#habitModal .day-opt').forEach(b => b.classList.toggle('active', habitCtx.days.includes(parseInt(b.dataset.dow))));
    document.getElementById('freqDays').style.display = habitCtx.freq === 'days' ? 'block' : 'none';
    document.getElementById('freqInterval').style.display = habitCtx.freq === 'interval' ? 'block' : 'none';
    document.getElementById('habitModal').classList.add('open');
    setTimeout(() => nameEl.focus(), 200);
}
function closeHabitModal() { document.getElementById('habitModal').classList.remove('open'); }
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
    document.querySelectorAll('#habitModal .day-opt').forEach(b => b.classList.toggle('active', habitCtx.days.includes(parseInt(b.dataset.dow))));
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
        await loadMonthChart();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ===== GOALS =====
let areas = [];
async function loadAreas() {
    try { const { areas: d, orphanGoals } = await api('/api/disc/areas'); areas = d; renderAreas(orphanGoals); }
    catch (e) { console.error(e); }
}
function renderAreas(orphans = []) {
    const c = document.getElementById('areasList');
    if (!areas.length && !orphans.length) { c.innerHTML = `<div class="empty-state">Нет областей. Нажми +</div>`; return; }
    let html = areas.map(a => {
        const done = a.goals.filter(g => g.status === 'done').length;
        const prog = a.goals.length ? `${done}/${a.goals.length}` : '';
        return `<div class="area-card">
            <div class="area-header">
                <div class="area-name">${escapeHtml(a.name)}</div>
                ${prog ? `<div class="area-progress">${prog}</div>` : ''}
                <button class="area-delete" onclick="deleteArea(${a.id})">🗑</button>
            </div>
            ${a.goals.map(g => goalHTML(g)).join('')}
            <button class="goal-add-inline" onclick="openAddModal('goal', ${a.id})">+ Добавить цель</button>
        </div>`;
    }).join('');
    if (orphans.length) {
        html += `<div class="area-card"><div class="area-header"><div class="area-name">Без области</div></div>
            ${orphans.map(g => goalHTML(g)).join('')}
            <button class="goal-add-inline" onclick="openAddModal('goal', null)">+ Добавить цель</button></div>`;
    }
    c.innerHTML = html;
}
function goalHTML(g) {
    return `<div class="goal-item">
        <div class="goal-check ${g.status === 'done' ? 'done' : ''}" onclick="toggleGoal(${g.id}, '${g.status}')">✓</div>
        <div class="goal-name ${g.status === 'done' ? 'done' : ''}">${escapeHtml(g.name)}</div>
        <button class="goal-delete" onclick="deleteGoal(${g.id})">✕</button>
    </div>`;
}
async function toggleGoal(id, s) { await api(`/api/disc/goals/${id}`, 'PATCH', { status: s === 'done' ? 'plan' : 'done' }); await loadAreas(); }
async function deleteGoal(id) { if (!confirm('Удалить?')) return; await api(`/api/disc/goals/${id}`, 'DELETE'); await loadAreas(); }
async function deleteArea(id) { if (!confirm('Удалить область со всеми целями?')) return; await api(`/api/disc/areas/${id}`, 'DELETE'); await loadAreas(); }

// Input modal
let modalCtx = { type: null, areaId: null };
function openAddModal(type, areaId = null) {
    modalCtx = { type, areaId };
    document.getElementById('inputModalTitle').textContent = type === 'area' ? 'Новая область' : 'Новая цель';
    const f = document.getElementById('inputModalField');
    f.value = '';
    f.placeholder = type === 'area' ? 'Например: Спорт' : 'Например: кмс';
    document.getElementById('inputModal').classList.add('open');
    setTimeout(() => f.focus(), 200);
}
function closeInputModal() { document.getElementById('inputModal').classList.remove('open'); }
async function submitInputModal() {
    const v = document.getElementById('inputModalField').value.trim();
    if (!v) return;
    try {
        if (modalCtx.type === 'area') await api('/api/disc/areas', 'POST', { name: v });
        else await api('/api/disc/goals', 'POST', { name: v, area_id: modalCtx.areaId });
        closeInputModal();
        await loadAreas();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
document.getElementById('inputModalField')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitInputModal(); });

// ==========================================
// ===== CASH =====
// ==========================================
function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₽'; }
function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
}

// --- BUDGET ---
let cashBudget = null;
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

    html += `<div class="budget-row">
        <div class="budget-row-label">Запланировано</div>
        <div class="budget-row-value">${fmt(t.planned)}</div>
    </div>`;

    d.customStats.forEach(s => {
        const val = s.type === 'percent' ? (t.budget * Number(s.value) / 100) : Number(s.value);
        const label = s.type === 'percent' ? `${s.name} (${s.value}%)` : s.name;
        html += `<div class="budget-row">
            <button class="budget-row-del" onclick="deleteCustomStat(${s.id})">✕</button>
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

    // Subs с чекбоксом
    const subsEl = document.getElementById('subsList');
    subsEl.innerHTML = d.subs.length === 0
        ? `<div class="widget-empty">Нет трат</div>`
        : d.subs.map(s => `<div class="cash-item ${s.paid ? 'paid' : ''}">
            <div class="cash-item-check ${s.paid ? 'done' : ''}" onclick="toggleSubPaid(${s.id}, ${s.paid})">✓</div>
            <div class="cash-item-name">${escapeHtml(s.name)}</div>
            <div class="cash-item-amount">${fmt(s.amount)}</div>
            <button class="cash-item-del" onclick="deleteSub(${s.id})">✕</button>
        </div>`).join('');
    document.getElementById('subsTotal').innerHTML = `Итого: <b>${fmt(t.subs)}</b>`;

    // Weekly
    const weekEl = document.getElementById('weeklyList');
    weekEl.innerHTML = d.weekly.length === 0
        ? `<div class="widget-empty">Нет позиций</div>`
        : d.weekly.map(w => `<div class="cash-item">
            <div class="cash-item-name">${escapeHtml(w.name)}</div>
            <div class="cash-item-amount">${fmt(w.amount)}</div>
            <button class="cash-item-del" onclick="deleteWeekly(${w.id})">✕</button>
        </div>`).join('');
    document.getElementById('weeklyTotal').innerHTML = `× ${d.weeksInMonth} нед. = <b>${fmt(t.weekly)}</b>`;
}

// Свайп-удаление для custom stats
function initSwipeRows() {
    document.querySelectorAll('.swipe-row').forEach(row => {
        const content = row.querySelector('.swipe-row-content');
        if (!content) return;

        let startX = 0, startY = 0, currentX = 0, isDragging = false, isHorizontal = false;
        const REVEAL = 80;

        content.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            currentX = 0;
            isDragging = true;
            isHorizontal = false;
            content.classList.add('swiping');
        }, { passive: true });

        content.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;

            if (!isHorizontal && Math.abs(dx) > 8) {
                if (Math.abs(dx) > Math.abs(dy)) isHorizontal = true;
                else { isDragging = false; content.classList.remove('swiping'); return; }
            }
            if (!isHorizontal) return;

            let offset = dx + currentX;
            if (offset > 0) offset = 0;
            if (offset < -REVEAL) offset = -REVEAL;
            content.style.transform = `translateX(${offset}px)`;
        }, { passive: true });

        content.addEventListener('touchend', (e) => {
            if (!isDragging) { content.classList.remove('swiping'); return; }
            isDragging = false;
            content.classList.remove('swiping');

            const dx = e.changedTouches[0].clientX - startX;
            if (dx < -40) {
                content.style.transform = `translateX(-${REVEAL}px)`;
                currentX = -REVEAL;
            } else {
                content.style.transform = 'translateX(0)';
                currentX = 0;
            }
        });

        // Тап вне — закрыть
        content.addEventListener('click', () => {
            if (currentX < 0) {
                content.style.transform = 'translateX(0)';
                currentX = 0;
            }
        });
    });
}

async function toggleSubPaid(id, paid) {
    await api(`/api/cash/subs/${id}`, 'PATCH', { paid: !paid });
    await loadBudget();
}

function openBudgetModal() {
    document.getElementById('budgetAmount').value = cashBudget?.budget?.budget_amount || '';
    document.getElementById('budgetModal').classList.add('open');
}
function closeBudgetModal() { document.getElementById('budgetModal').classList.remove('open'); }
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
let statCtx = { type: 'rub' };
function openCustomStatModal() {
    document.getElementById('customStatName').value = '';
    document.getElementById('customStatValue').value = '';
    statCtx.type = 'rub';
    document.querySelectorAll('#customStatModal [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === 'rub'));
    document.getElementById('customStatModal').classList.add('open');
}
function closeCustomStatModal() { document.getElementById('customStatModal').classList.remove('open'); }
function pickStatType(t, btn) {
    statCtx.type = t;
    document.querySelectorAll('#customStatModal [data-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
async function saveCustomStat() {
    const name = document.getElementById('customStatName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/cash/custom-stats', 'POST', {
            name, type: statCtx.type, value: document.getElementById('customStatValue').value,
        });
        closeCustomStatModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteCustomStat(id) {
    if (!confirm('Удалить панель?')) return;
    await api(`/api/cash/custom-stats/${id}`, 'DELETE');
    await loadBudget();
}

// Cash add modal (sub/weekly)
let cashAddCtx = { type: null };
function openCashAddModal(type) {
    cashAddCtx.type = type;
    document.getElementById('cashAddTitle').textContent = type === 'sub' ? 'Трата месяца' : 'Недельная покупка';
    document.getElementById('cashAddName').value = '';
    document.getElementById('cashAddAmount').value = '';
    document.getElementById('cashAddModal').classList.add('open');
    setTimeout(() => document.getElementById('cashAddName').focus(), 200);
}
function closeCashAddModal() { document.getElementById('cashAddModal').classList.remove('open'); }
async function saveCashAdd() {
    const name = document.getElementById('cashAddName').value.trim();
    if (!name) return alert('Введи название');
    const amount = document.getElementById('cashAddAmount').value;
    try {
        if (cashAddCtx.type === 'sub') await api('/api/cash/subs', 'POST', { name, amount });
        else await api('/api/cash/weekly', 'POST', { name, amount });
        closeCashAddModal();
        await loadBudget();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteSub(id) { if (!confirm('Удалить?')) return; await api(`/api/cash/subs/${id}`, 'DELETE'); await loadBudget(); }
async function deleteWeekly(id) { if (!confirm('Удалить?')) return; await api(`/api/cash/weekly/${id}`, 'DELETE'); await loadBudget(); }

// --- WISHLIST ---
let wishlistItems = [];
let wishlistAreas = [];

async function loadWishlist() {
    try {
        const [itemsR, areasR] = await Promise.all([
            api('/api/cash/wishlist'),
            api('/api/cash/wishlist/areas'),
        ]);
        wishlistItems = itemsR.items;

        const dbAreas = areasR.areas.map(a => ({ id: a.id, name: a.name }));
        const dbNames = new Set(dbAreas.map(a => a.name));
        wishlistItems.forEach(i => {
            const n = i.area || 'Общее';
            if (!dbNames.has(n)) { dbAreas.push({ id: null, name: n }); dbNames.add(n); }
        });
        wishlistAreas = dbAreas;

        renderWishlist();
    } catch (e) { console.error(e); }
}

function renderWishlist() {
    const c = document.getElementById('wishlistGrid');
    if (!wishlistAreas.length && !wishlistItems.length) {
        c.innerHTML = `<div class="empty-state">Пока нет областей. Нажми +</div>`;
        return;
    }

    let html = '';
    wishlistAreas.forEach(area => {
        const areaName = area.name;
        const items = wishlistItems.filter(i => (i.area || 'Общее') === areaName);
        const safeName = escapeHtml(areaName).replace(/'/g, "\\'");

        html += `<div class="wishlist-area-card">
            <div class="wishlist-area-header">
                <div class="wishlist-area-name">${escapeHtml(areaName)}</div>
                <div class="wishlist-area-count">${items.length}</div>
                <button class="btn-icon-add" onclick="openWishlistModal('${safeName}')">+</button>
                <button class="area-delete" onclick="deleteWishlistArea('${safeName}')">🗑</button>
            </div>`;

        if (items.length === 0) {
            html += `<div class="widget-empty" style="padding:8px 4px;">Пусто</div>`;
        } else {
            items.forEach(it => {
                html += `<div class="wishlist-item">
                    <div class="wishlist-check ${it.done ? 'done' : ''}" onclick="toggleWish(${it.id}, ${it.done})">✓</div>
                    <div class="wishlist-name ${it.done ? 'done' : ''}">${escapeHtml(it.name)}</div>
                    ${it.price ? `<div class="wishlist-price">${fmt(it.price)}</div>` : ''}
                    <button class="wishlist-del" onclick="deleteWish(${it.id})">✕</button>
                </div>`;
            });
        }
        html += `</div>`;
    });

    c.innerHTML = html;
}

// Wishlist modal (добавление товара в область)
function openWishlistModal(area = '') {
    document.getElementById('wishName').value = '';
    document.getElementById('wishPrice').value = '';
    document.getElementById('wishArea').value = area || 'Общее';
    document.getElementById('wishUrl').value = '';
    document.getElementById('wishlistModal').classList.add('open');
    setTimeout(() => document.getElementById('wishName').focus(), 200);
}

function closeWishlistModal() {
    document.getElementById('wishlistModal').classList.remove('open');
}

async function saveWishlist() {
    const name = document.getElementById('wishName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/cash/wishlist', 'POST', {
            name,
            price: document.getElementById('wishPrice').value,
            area: document.getElementById('wishArea').value || 'Общее',
            url: document.getElementById('wishUrl').value,
        });
        closeWishlistModal();
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}


// Wishlist area modal
function openWishlistAreaModal() {
    document.getElementById('wishAreaName').value = '';
    document.getElementById('wishlistAreaModal').classList.add('open');
    setTimeout(() => document.getElementById('wishAreaName').focus(), 200);
}
function closeWishlistAreaModal() { document.getElementById('wishlistAreaModal').classList.remove('open'); }
async function saveWishlistArea() {
    const name = document.getElementById('wishAreaName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/cash/wishlist/areas', 'POST', { name });
        closeWishlistAreaModal();
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteWishlistArea(name) {
    if (!confirm(`Удалить область "${name}" и все товары в ней?`)) return;
    try {
        await api(`/api/cash/wishlist/areas/by-name/${encodeURIComponent(name)}`, 'DELETE');
        await loadWishlist();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function toggleWish(id, done) {
    await api(`/api/cash/wishlist/${id}`, 'PATCH', { done: !done });
    await loadWishlist();
}
async function deleteWish(id) {
    if (!confirm('Удалить?')) return;
    await api(`/api/cash/wishlist/${id}`, 'DELETE');
    await loadWishlist();
}

// --- PIGGY ---
let piggyData = null;
async function loadPiggy() {
    try { piggyData = await api('/api/cash/piggy'); renderPiggy(); }
    catch (e) { console.error(e); }
}
let piggyFilter = 'all';

function renderPiggy() {
    const d = piggyData;
    if (!d) return;
    const t = d.totals;

    document.getElementById('piggyGrid').innerHTML = `
        <div class="piggy-hero-new">
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

    // Фильтр
    const filtered = d.items.filter(x => {
        if (piggyFilter === 'deposit') return x.type === 'deposit';
        if (piggyFilter === 'withdraw') return x.type === 'withdraw';
        return true;
    });

    const filterHtml = `
        <div class="piggy-filter">
            <button class="piggy-filter-btn ${piggyFilter === 'all' ? 'active' : ''}" onclick="setPiggyFilter('all')">Все</button>
            <button class="piggy-filter-btn ${piggyFilter === 'deposit' ? 'active' : ''}" onclick="setPiggyFilter('deposit')">↓ Пополнения</button>
            <button class="piggy-filter-btn ${piggyFilter === 'withdraw' ? 'active' : ''}" onclick="setPiggyFilter('withdraw')">↑ Списания</button>
        </div>
    `;

    const list = document.getElementById('piggyList');
    if (!filtered.length) {
        list.innerHTML = filterHtml + `<div class="widget-empty">Пусто</div>`;
        return;
    }
    list.innerHTML = filterHtml + filtered.map(x => `
        <div class="cash-item">
            <div style="flex:1;min-width:0;">
                <div class="cash-item-name">${escapeHtml(x.description || (x.type === 'deposit' ? 'Пополнение' : 'Трата'))}</div>
                <div class="cash-item-date">${formatDate(x.date)}</div>
            </div>
            <div class="cash-item-amount ${x.type === 'withdraw' ? 'minus' : 'plus-green'}">
                ${x.type === 'withdraw' ? '−' : '+'}${fmt(x.amount)}
            </div>
            <button class="cash-item-del" onclick="deletePiggyItem(${x.id})">✕</button>
        </div>
    `).join('');
}

function setPiggyFilter(f) {
    piggyFilter = f;
    renderPiggy();
}

let piggyCtx = { type: 'withdraw' };
function openPiggyModal() {
    document.getElementById('piggyDesc').value = '';
    document.getElementById('piggyAmount').value = '';
    piggyCtx.type = 'withdraw';
    document.querySelectorAll('#piggyModal [data-ptype]').forEach(b => b.classList.toggle('active', b.dataset.ptype === 'withdraw'));
    document.getElementById('piggyModal').classList.add('open');
}
function closePiggyModal() { document.getElementById('piggyModal').classList.remove('open'); }
function pickPiggyType(t, btn) {
    piggyCtx.type = t;
    document.querySelectorAll('#piggyModal [data-ptype]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
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
    await api(`/api/cash/piggy/${id}`, 'DELETE');
    await loadPiggy();
}

function openFactModal() {
    document.getElementById('factAmount').value = piggyData?.totals?.fact || '';
    document.getElementById('factModal').classList.add('open');
}
function closeFactModal() { document.getElementById('factModal').classList.remove('open'); }
async function saveFact() {
    try {
        await api('/api/cash/piggy/fact', 'POST', { fact_amount: document.getElementById('factAmount').value });
        closeFactModal();
        await loadPiggy();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ===== УТИЛИТЫ =====
function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function haptic(type = 'light') {
    try { if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(type); } catch (e) {}
}
document.addEventListener('click', e => { if (e.target.closest('button')) haptic('light'); });

// ==========================================
// ===== GYM: ПРОГРАММЫ =====
// ==========================================
let programs = [];
let openProgramIds = new Set();
let openDayIds = new Set();
let openExerciseIds = new Set();
let namePromptCtx = { type: null, parentId: null };
let newSetCtx = { exerciseId: null };

async function loadPrograms() {
    try {
        const { programs: data } = await api('/api/gym/programs');
        programs = data;
        renderPrograms();
    } catch (e) { console.error(e); }
}

function renderPrograms() {
    const c = document.getElementById('programsList');
    if (!c) return;
    if (!programs.length) {
        c.innerHTML = `<div class="empty-state">Нет программ. Нажми +</div>`;
        return;
    }

    c.innerHTML = programs.map(p => {
        const isOpen = openProgramIds.has(p.id);
        return `<div class="program-card ${isOpen ? 'open' : ''}">
            <div class="program-header">
                <div class="program-name" onclick="toggleProgram(${p.id})">${escapeHtml(p.name)}</div>
                <span class="program-arrow" onclick="toggleProgram(${p.id})">▶</span>
                <button class="area-delete" onclick="event.stopPropagation(); deleteProgram(${p.id})">🗑</button>
            </div>
            <div class="program-body">
                ${p.days.map((d, di) => renderDay(d, di)).join('')}
                <button class="program-add-day" onclick="openNamePrompt('day', ${p.id})">+ Добавить тренировку</button>
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
            <button class="area-delete" onclick="event.stopPropagation(); deleteDay(${d.id})">✕</button>
        </div>
        <div class="day-body">
            ${d.exercises.map((e, ei) => renderExercise(e, ei)).join('')}
            <button class="day-add-exercise" onclick="openNamePrompt('exercise', ${d.id})">+ Упражнение</button>
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
            <button class="set-del" onclick="deleteSet(${s.id})">✕</button>
        </div>
    `).join('');

    return `<div class="exercise-block ${isOpen ? 'open' : ''}">
        <div class="exercise-header" onclick="toggleExercise(${e.id})">
            <span class="ex-arrow">▶</span>
            <span class="set-num">${ei + 1}.</span>
            <span class="exercise-name">${escapeHtml(e.name)}</span>
            <span class="exercise-summary">${summary}</span>
            <button class="area-delete" onclick="event.stopPropagation(); deleteExercise(${e.id})">✕</button>
        </div>
        <div class="exercise-body">
            ${setsHtml}
            <button class="exercise-add-set" onclick="openNewSetModal(${e.id}, '${escapeHtml(e.name).replace(/'/g, "\\'")}')">+ подход</button>
        </div>
    </div>`;
}

function toggleProgram(id) {
    if (openProgramIds.has(id)) openProgramIds.delete(id);
    else openProgramIds.add(id);
    renderPrograms();
}
function toggleDay(id) {
    if (openDayIds.has(id)) openDayIds.delete(id);
    else openDayIds.add(id);
    renderPrograms();
}
function toggleExercise(id) {
    if (openExerciseIds.has(id)) openExerciseIds.delete(id);
    else openExerciseIds.add(id);
    renderPrograms();
}

function openNewProgramModal() {
    document.getElementById('programName').value = '';
    document.getElementById('newProgramModal').classList.add('open');
    setTimeout(() => document.getElementById('programName').focus(), 200);
}
function closeNewProgramModal() { document.getElementById('newProgramModal').classList.remove('open'); }
async function saveNewProgram() {
    const name = document.getElementById('programName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/gym/programs', 'POST', { name });
        closeNewProgramModal();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteProgram(id) {
    if (!confirm('Удалить программу?')) return;
    await api(`/api/gym/programs/${id}`, 'DELETE');
    openProgramIds.delete(id);
    await loadPrograms();
}

function openNamePrompt(type, parentId) {
    namePromptCtx = { type, parentId };
    document.getElementById('namePromptTitle').textContent =
        type === 'day' ? 'Название тренировки' : 'Название упражнения';
    document.getElementById('namePromptField').value = '';
    document.getElementById('namePromptField').placeholder =
        type === 'day' ? 'Например: Грудь бицепс' : 'Например: Жим лежа';
    document.getElementById('namePromptModal').classList.add('open');
    setTimeout(() => document.getElementById('namePromptField').focus(), 200);
}
function closeNamePrompt() { document.getElementById('namePromptModal').classList.remove('open'); }
async function submitNamePrompt() {
    const v = document.getElementById('namePromptField').value.trim();
    if (!v) return;
    try {
        if (namePromptCtx.type === 'day') {
            await api(`/api/gym/programs/${namePromptCtx.parentId}/days`, 'POST', { name: v });
            openProgramIds.add(namePromptCtx.parentId);
        } else {
            await api(`/api/gym/days/${namePromptCtx.parentId}/exercises`, 'POST', { name: v });
            openDayIds.add(namePromptCtx.parentId);
        }
        closeNamePrompt();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteDay(id) {
    if (!confirm('Удалить тренировку?')) return;
    await api(`/api/gym/days/${id}`, 'DELETE');
    openDayIds.delete(id);
    await loadPrograms();
}
async function deleteExercise(id) {
    if (!confirm('Удалить упражнение?')) return;
    await api(`/api/gym/exercises/${id}`, 'DELETE');
    openExerciseIds.delete(id);
    await loadPrograms();
}

function openNewSetModal(exerciseId, exerciseName) {
    newSetCtx.exerciseId = exerciseId;
    document.getElementById('newSetTitle').textContent = exerciseName;
    document.getElementById('setReps').value = '';
    document.getElementById('setWeight').value = '';
    document.getElementById('newSetModal').classList.add('open');
    setTimeout(() => document.getElementById('setReps').focus(), 200);
}
function closeNewSetModal() { document.getElementById('newSetModal').classList.remove('open'); }
async function saveNewSet() {
    const reps = document.getElementById('setReps').value;
    const weight = document.getElementById('setWeight').value;
    if (reps === '' && weight === '') return alert('Заполни повторения или вес');
    try {
        await api(`/api/gym/exercises/${newSetCtx.exerciseId}/sets`, 'POST', { reps, weight });
        openExerciseIds.add(newSetCtx.exerciseId);
        closeNewSetModal();
        await loadPrograms();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteSet(id) {
    await api(`/api/gym/sets/${id}`, 'DELETE');
    await loadPrograms();
}

// ==========================================
// ===== GYM: МЕТРИКИ (таблица) =====
// ==========================================
let metrics = [];
let metricCtx = { category: 'bio' };
let metricLogCtx = { metricId: null, date: null, logId: null };

async function loadMetrics() {
    try {
        const { metrics: data } = await api('/api/gym/metrics');
        metrics = data;
        renderMetricsTable();
    } catch (e) { console.error(e); }
}

function renderMetricsTable() {
    const bio = metrics.filter(m => m.category === 'bio');
    const str = metrics.filter(m => m.category === 'strength');
    renderTable('bioTable', bio);
    renderTable('strengthTable', str);
}

function renderTable(containerId, list) {
    const c = document.getElementById(containerId);
    if (!c) return;

    if (!list.length) {
        c.innerHTML = `<div class="widget-empty">Нет метрик. Нажми +</div>`;
        return;
    }

    const datesSet = new Set();
    list.forEach(m => m.logs.forEach(l => datesSet.add(l.date)));
    const dates = [...datesSet].sort();

    let html = `<div class="metrics-table-wrap"><table class="metrics-table"><thead><tr>`;
    html += `<th class="col-name">Метрика</th>`;
    html += `<th class="col-target">Цель</th>`;
    dates.forEach(d => { html += `<th>${formatDate(d)}</th>`; });
    html += `<th>+</th>`;
    html += `</tr></thead><tbody>`;

    list.forEach(m => {
        const map = {};
        m.logs.forEach(l => { map[l.date] = l; });
        const unit = m.unit || '';
        const target = m.target ? `${m.target}${unit}` : '—';

        html += `<tr>`;
        html += `<td class="col-name" onclick="deleteMetric(${m.id})">${escapeHtml(m.name)}</td>`;
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

    // Автопрокрут вправо, чтобы видеть последние даты
    requestAnimationFrame(() => {
        c.querySelectorAll('.metrics-table-wrap').forEach(wrap => {
            wrap.scrollLeft = wrap.scrollWidth;
        });
    });
}

function openAddMetric(category) {
    metricCtx.category = category;
    document.getElementById('metricModalTitle').textContent =
        category === 'bio' ? 'Новая метрика биометрии' : 'Новая метрика силы';
    document.getElementById('metricName').value = '';
    document.getElementById('metricUnit').value = 'кг';
    document.getElementById('metricTarget').value = '';
    document.getElementById('metricModal').classList.add('open');
    setTimeout(() => document.getElementById('metricName').focus(), 200);
}
function closeMetricModal() { document.getElementById('metricModal').classList.remove('open'); }

async function saveMetric() {
    const name = document.getElementById('metricName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/gym/metrics', 'POST', {
            name,
            category: metricCtx.category,
            unit: document.getElementById('metricUnit').value,
            target: document.getElementById('metricTarget').value || null,
        });
        closeMetricModal();
        await loadMetrics();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteMetric(id) {
    if (!confirm('Удалить метрику и все её замеры?')) return;
    await api(`/api/gym/metrics/${id}`, 'DELETE');
    await loadMetrics();
}

function openMetricLogModal(metricId, date, logId, value) {
    metricLogCtx = { metricId, date, logId };
    const m = metrics.find(x => x.id === metricId);
    const title = m ? m.name + (m.unit ? ` (${m.unit})` : '') : 'Замер';
    document.getElementById('metricLogTitle').textContent = title;

    document.getElementById('logValue').value = value !== null && value !== undefined ? value : '';
    document.getElementById('logDate').value = date || new Date().toISOString().slice(0,10);

    const delBtn = document.getElementById('logDeleteBtn');
    delBtn.style.display = logId ? 'block' : 'none';

    document.getElementById('metricLogModal').classList.add('open');
    setTimeout(() => document.getElementById('logValue').focus(), 200);
}
function closeMetricLogModal() { document.getElementById('metricLogModal').classList.remove('open'); }

async function saveMetricLog() {
    const value = document.getElementById('logValue').value;
    if (value === '') return alert('Введи значение');
    try {
        await api(`/api/gym/metrics/${metricLogCtx.metricId}/logs`, 'POST', {
            value,
            date: document.getElementById('logDate').value,
        });
        closeMetricLogModal();
        await loadMetrics();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteCurrentLog() {
    if (!metricLogCtx.logId) return;
    if (!confirm('Удалить замер?')) return;
    await api(`/api/gym/metrics/logs/${metricLogCtx.logId}`, 'DELETE');
    closeMetricLogModal();
    await loadMetrics();
}

// ==========================================
// ===== FILM =====
// ==========================================
// ==========================================
// ===== FILM =====
// ==========================================
let filmGenres = [];
let filmOrphans = [];
let filmCtx = { genreId: null, priority: null, currentMovieId: null, status: 'want', cardPriority: null };
let filmGenreEditCtx = { id: null };
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
    if (!c) return;

    const allGenres = [...filmGenres];
    if (filmOrphans.length > 0) {
        allGenres.push({ id: null, name: 'Без жанра', movies: filmOrphans });
    }

    if (!allGenres.length) {
        c.innerHTML = `<div class="empty-state">Нет фильмов. Нажми +</div>`;
        return;
    }

    c.innerHTML = allGenres.map(g => {
        const movies = (g.movies || []).filter(m => m.status !== 'watched');
        return `<div class="film-genre-card">
            <div class="film-genre-header">
                <div class="film-genre-name" ${g.id ? `onclick="openFilmGenreEdit(${g.id})" style="cursor:pointer;"` : ''}>${escapeHtml(g.name)}</div>
                <div class="film-genre-count">${movies.length}</div>
                ${g.id ? `<button class="btn-icon-add" onclick="openFilmModal(${g.id})">+</button>` : ''}
                ${g.id ? `<button class="area-delete" onclick="deleteFilmGenre(${g.id})">🗑</button>` : ''}
            </div>
            ${movies.length === 0 ? `<div class="widget-empty">Пусто</div>`
                : movies.map(m => filmItemHTML(m)).join('')}
        </div>`;
    }).join('');
}

function filmItemHTML(m) {
    const p = m.priority || 0;
    const priorityClass = p >= 5 ? 'p5' : p >= 4 ? 'p4' : p >= 3 ? 'p3' : '';
    const statusLabels = { want: 'Хочу', watching: 'Смотрю', watched: 'Видел' };
    return `<div class="film-item" onclick="openFilmCard(${m.id})">
        ${p ? `<div class="film-priority ${priorityClass}">${p}</div>` : ''}
        <div class="film-info">
            <div class="film-title">${escapeHtml(m.title)}</div>
            <div class="film-sub">${m.year ? m.year : ''}${m.review ? ' · ' + escapeHtml(m.review.slice(0, 40)) : ''}</div>
        </div>
        ${m.rating ? `<div class="film-rating">★ ${m.rating}</div>` : ''}
        <div class="film-status-badge ${m.status}">${statusLabels[m.status] || ''}</div>
    </div>`;
}

function renderFilmWatched() {
    const c = document.getElementById('filmWatched');
    if (!c) return;

    const byGenre = [];
    filmGenres.forEach(g => {
        const watched = (g.movies || []).filter(m => m.status === 'watched');
        if (watched.length) byGenre.push({ name: g.name, movies: watched });
    });
    const orphansWatched = filmOrphans.filter(m => m.status === 'watched');
    if (orphansWatched.length) byGenre.push({ name: 'Без жанра', movies: orphansWatched });

    if (!byGenre.length) {
        c.innerHTML = `<div class="empty-state">Пока ничего не посмотрел</div>`;
        return;
    }

    c.innerHTML = byGenre.map(g => {
        const sorted = [...g.movies].sort((a,b) => (b.rating || 0) - (a.rating || 0));
        return `<div class="film-genre-card">
            <div class="film-genre-header">
                <div class="film-genre-name">${escapeHtml(g.name)}</div>
                <div class="film-genre-count">${sorted.length}</div>
            </div>
            ${sorted.map(m => filmItemHTML(m)).join('')}
        </div>`;
    }).join('');
}

// Редактирование жанра
function openFilmGenreEdit(id) {
    const genre = filmGenres.find(g => g.id === id);
    if (!genre) return;
    filmGenreEditCtx.id = id;
    document.getElementById('filmGenreEditName').value = genre.name;
    document.getElementById('filmGenreEditModal').classList.add('open');
    setTimeout(() => document.getElementById('filmGenreEditName').focus(), 200);
}
function closeFilmGenreEdit() { document.getElementById('filmGenreEditModal').classList.remove('open'); }
async function saveFilmGenreEdit() {
    const name = document.getElementById('filmGenreEditName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api(`/api/film/genres/${filmGenreEditCtx.id}`, 'PATCH', { name });
        closeFilmGenreEdit();
        await loadFilm();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// Создание жанра
function openFilmGenreModal() {
    document.getElementById('filmGenreName').value = '';
    document.getElementById('filmGenreModal').classList.add('open');
    setTimeout(() => document.getElementById('filmGenreName').focus(), 200);
}
function closeFilmGenreModal() { document.getElementById('filmGenreModal').classList.remove('open'); }
async function saveFilmGenre() {
    const name = document.getElementById('filmGenreName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api('/api/film/genres', 'POST', { name });
        closeFilmGenreModal();
        await loadFilm();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteFilmGenre(id) {
    if (!confirm('Удалить жанр? Фильмы останутся без жанра.')) return;
    await api(`/api/film/genres/${id}`, 'DELETE');
    await loadFilm();
}

// Фильм — создание
function openFilmModal(genreId = null) {
    filmCtx = { genreId, priority: null, currentMovieId: null, status: 'want', cardPriority: null };
    document.getElementById('filmModalTitle').textContent = 'Новый фильм';
    document.getElementById('filmTitle').value = '';
    document.getElementById('filmYear').value = '';
    document.getElementById('filmUrl').value = '';
    document.querySelectorAll('#filmPriority button').forEach(b => b.classList.remove('active'));

    const sel = document.getElementById('filmGenreSelect');
    sel.innerHTML = `<option value="">Без жанра</option>` +
        filmGenres.map(g => `<option value="${g.id}" ${g.id === genreId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('');

    document.getElementById('filmModal').classList.add('open');
    setTimeout(() => document.getElementById('filmTitle').focus(), 200);
}
function closeFilmModal() { document.getElementById('filmModal').classList.remove('open'); }
function pickPriority(p, btn) {
    filmCtx.priority = p;
    document.querySelectorAll('#filmPriority button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
async function saveFilm() {
    const title = document.getElementById('filmTitle').value.trim();
    if (!title) return alert('Введи название');
    const genreVal = document.getElementById('filmGenreSelect').value;
    try {
        await api('/api/film/movies', 'POST', {
            title,
            year: document.getElementById('filmYear').value || null,
            genre_id: genreVal ? parseInt(genreVal) : null,
            priority: filmCtx.priority,
            url: document.getElementById('filmUrl').value || null,
        });
        closeFilmModal();
        await loadFilm();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// Карточка фильма — редактирование
async function openFilmCard(movieId) {
    let movie = null;
    for (const g of filmGenres) {
        const found = (g.movies || []).find(m => m.id === movieId);
        if (found) { movie = found; break; }
    }
    if (!movie) movie = filmOrphans.find(m => m.id === movieId);
    if (!movie) return;

    filmCtx.currentMovieId = movieId;
    filmCtx.status = movie.status || 'want';
    filmCtx.cardPriority = movie.priority || null;

    document.getElementById('filmCardTitle').textContent = movie.title;
    document.getElementById('filmCardName').value = movie.title;
    document.getElementById('filmCardYear').value = movie.year || '';

    document.querySelectorAll('#filmCardPriority button').forEach(b => {
        b.classList.toggle('active', filmCtx.cardPriority === parseInt(b.dataset.p));
    });
    document.querySelectorAll('#filmStatusTabs [data-st]').forEach(b =>
        b.classList.toggle('active', b.dataset.st === filmCtx.status));

    document.getElementById('filmRating').value = movie.rating || '';
    document.getElementById('filmReview').value = movie.review || '';

    document.getElementById('filmCardModal').classList.add('open');
}
function closeFilmCardModal() { document.getElementById('filmCardModal').classList.remove('open'); }
function pickFilmStatus(st, btn) {
    filmCtx.status = st;
    document.querySelectorAll('#filmStatusTabs [data-st]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
function pickCardPriority(p, btn) {
    if (filmCtx.cardPriority === p) {
        filmCtx.cardPriority = null;
        btn.classList.remove('active');
    } else {
        filmCtx.cardPriority = p;
        document.querySelectorAll('#filmCardPriority button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
}
async function saveFilmCard() {
    const name = document.getElementById('filmCardName').value.trim();
    if (!name) return alert('Введи название');
    try {
        await api(`/api/film/movies/${filmCtx.currentMovieId}`, 'PATCH', {
            title: name,
            year: document.getElementById('filmCardYear').value || null,
            priority: filmCtx.cardPriority,
            status: filmCtx.status,
            rating: document.getElementById('filmRating').value || null,
            review: document.getElementById('filmReview').value || null,
        });
        closeFilmCardModal();
        await loadFilm();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function deleteCurrentFilm() {
    if (!confirm('Удалить фильм?')) return;
    await api(`/api/film/movies/${filmCtx.currentMovieId}`, 'DELETE');
    closeFilmCardModal();
    await loadFilm();
}

// Рандом
async function randomMovie(type = 'want') {
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
                    movie.year,
                    movie.rating ? `★ ${movie.rating}` : null,
                    movie.priority ? `Приоритет ${movie.priority}` : null,
                ].filter(Boolean).join(' · ')}</div>
            `;
        }
        document.getElementById('randomFilmModal').classList.add('open');
    } catch (e) { alert('Ошибка: ' + e.message); }
}
function randomAgain() { randomMovie(filmRandomType); }
function closeRandomFilm() { document.getElementById('randomFilmModal').classList.remove('open'); }


// ===== СТАРТ =====
(async function start() {
    goToScreen(0, false);
    const ok = await auth();
    if (ok) {
        await Promise.all([loadHome(), loadHabits(), loadWeek(), loadMonthChart(), loadAreas(),
                           loadBudget(), loadWishlist(), loadPiggy(),
                           loadMetrics(), loadPrograms(), loadFilm()]);
    }
})();