/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/05-my-plan.js file-for-file: личный кабинет («Мой план») —
 * профиль, кольцо дневного плана, месяц/неделя/BFQ, быстрые действия,
 * привязка Telegram, кастомная аватарка (выбор файла + client-side resize).
 *
 * me's ambient declaration was widened (bound/id/telegram_id added, const ->
 * let) to cover what this file's loadMyPlan()/bindMe() actually assign —
 * this is its real owner/reassigner, previously only read elsewhere.
 */
import type { EmployeeProgressResponse } from '../../../../src/shared/api-types.js';

function ringSVG(pct: number): string {
  const r = 36;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const offset = c - (p / 100) * c;
  const tone = pctTone(p);
  return `
        <div class="lk-ring">
          <svg viewBox="0 0 88 88">
            <circle class="bg" cx="44" cy="44" r="${r}" />
            <circle class="fg ${tone}" cx="44" cy="44" r="${r}"
              stroke-dasharray="${c}" stroke-dashoffset="${offset}" />
          </svg>
          <div class="lk-ring-val">${Math.round(p)}%<small>план</small></div>
        </div>`;
}

// roleLabel() — общий хелпер из 01-core.js

export async function loadMyPlan(): Promise<void> {
  const bindSec = document.getElementById('myBindSection');
  const root = document.getElementById('lkRoot');
  if (root) {
    root.style.display = 'block';
    ['lkProfile', 'lkShift', 'lkInsight', 'lkToday', 'lkMonth', 'lkWeek', 'lkBfq', 'lkGamification', 'lkActions', 'lkPhoneAuth'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="skeleton" style="margin-bottom:10px"></div>';
    });
  }

  const user = tgUser();
  const avatarEl = document.getElementById('userAvatar');
  if (user?.photo_url && avatarEl) {
    avatarEl.innerHTML = `<img src="${user.photo_url}" alt="">`;
  } else if (user?.first_name && avatarEl) {
    avatarEl.textContent = user.first_name[0];
  }

  try {
    me = await window.apiClient.getMe(authHeaders());
  } catch {
    me = null;
  }

  // employee_id может быть в разных полях; bound:false = не привязан
  const empId = me && me.bound !== false ? me.employee_id || me.id || null : null;

  if (!empId) {
    if (root) root.style.display = 'none';
    if (bindSec) (bindSec as HTMLElement).style.display = 'block';
    try {
      employees = await window.apiClient.getEmployees(authHeaders(), '');
      const unbound = (employees || []).filter((e: any) => !e.telegram_id || Number(e.telegram_id) === 0);
      const list = unbound.length ? unbound : employees || [];
      const bindEl = document.getElementById('bindEmployee');
      if (bindEl) bindEl.innerHTML = list.map((e: any) => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('');
    } catch (_) {}
    return;
  }

  if (bindSec) (bindSec as HTMLElement).style.display = 'none';
  if (root) root.style.display = 'block';

  const today = todayMoscow();
  const month = today.slice(0, 7);

  // Параллельная загрузка
  const [dayRes, progRes, monthSchRes, bfqRes, monthPlanRes] = await Promise.allSettled([
    window.apiClient.getMyDay(authHeaders()),
    window.apiClient.getEmployeeProgress(authHeaders(), empId, today),
    window.apiClient.getScheduleMonth(authHeaders(), month, ''),
    window.apiClient.getBfqList(authHeaders(), month, ''),
    window.apiClient.getPlansEmployeesMonth(authHeaders(), month, '')
  ]);

  function settledOk<T>(settled: PromiseSettledResult<T>): T | null {
    return settled.status === 'fulfilled' ? settled.value : null;
  }

  const dayData: any = settledOk(dayRes);
  const progData: EmployeeProgressResponse | null = settledOk(progRes);
  const monthSch: any = settledOk(monthSchRes);
  const bfqData: any = settledOk(bfqRes);
  const monthPlansRaw: any = settledOk(monthPlanRes);
  // API: { month, rows, totals }
  const monthPlans: any[] = Array.isArray(monthPlansRaw) ? monthPlansRaw : monthPlansRaw?.rows || monthPlansRaw?.items || [];

  // --- Профиль ---
  const fullName = me.full_name || user?.first_name || 'Сотрудник';
  const role = me.role || 'employee';
  const photo = user?.photo_url;
  const shift = dayData?.shift || null;
  const storeName = shift?.store_name || shift?.store_id || null;
  const storeId = shift?.store_id;
  const color = storeColor(storeId);

  const lkProfile = document.getElementById('lkProfile');
  if (lkProfile) {
    lkProfile.innerHTML = `
        <div class="lk-hero">
          <div class="lk-hero-top">
            <div class="lk-avatar-wrap">
              <div class="lk-avatar" id="lkAvatar">
                ${photo ? `<img src="${photo}" alt="">` : fullName[0] || 'T'}
              </div>
              <button type="button" class="lk-avatar-edit" onclick="pickAvatarFile()" title="Сменить аватарку"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /> <circle cx="12" cy="13" r="3" /> </svg></button>
            </div>
            <div>
              <div class="lk-name">${fullName}</div>
              <span class="lk-role ${role === 'manager' || role === 'admin' ? 'manager' : ''}">${roleLabel(role)}</span>
            </div>
          </div>
          <div class="lk-hero-meta">
            ${storeName ? `<div class="lk-pill"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" /> </svg> <strong>${storeName}</strong></div>` : `<div class="lk-pill">Сегодня выходной</div>`}
            ${shift?.shift_text ? `<div class="lk-pill"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /> </svg> <strong>${shift.shift_text}</strong>${shift.hours ? ' · ' + shift.hours + 'ч' : ''}</div>` : ''}
            <div class="lk-pill"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M8 2v3" /> <path d="M16 2v3" /> <rect x="3" y="3" width="18" height="18" rx="2" /> <path d="M3 9h18" /> </svg> <strong>${formatDateRu(today)}</strong></div>
          </div>
        </div>`;
  }
  // Кастомная аватарка (19) приоритетнее photo_url из Telegram — подменяет
  // содержимое, только если реально есть (иначе остаётся то, что уже
  // отрендерено выше: фото из Telegram или буква).
  applyAvatarImg('lkAvatar', empId);
  applyAvatarImg('userAvatar', empId);

  // --- Кольцо прогресса дня ---
  const tot: any = dayData?.total || progData?.total || {};
  const dayPct = tot.pct != null ? tot.pct : tot.plan > 0 ? Math.round((tot.fact / tot.plan) * 100) : 0;

  // 11: на выходной кольцо «0% план / Нет смены» дублирует и pill «Сегодня
  // выходной» в шапке профиля, и текст блока «Смена» ниже — три места об
  // одном и том же. На выходной просто не рендерим кольцо.
  const lkToday = document.getElementById('lkToday');
  if (lkToday) {
    lkToday.innerHTML = storeName
      ? `
        <div class="section-title" style="margin-bottom:8px">Сегодня</div>
        <div class="lk-ring-card">
          ${ringSVG(dayPct)}
          <div class="lk-ring-info">
            <div class="lk-ring-title">Смена на точке</div>
            <div class="lk-ring-sub">Выполнение дневного плана по ключевым метрикам.</div>
            <div class="lk-ring-store">
              <span class="lk-dot" style="background:${color}"></span>
              ${storeName}${shift?.shift_text ? ' · ' + shift.shift_text : ''}
            </div>
          </div>
        </div>`
      : '';
  }

  // --- Месяц (22: формат «БЛОК GI / Товарка / Ростелеком / Кредиты» — тот
  // же, что у карточки точки на «План» (loadPlanDay, 04-schedule.js), а не
  // числовая сетка «Планы и факт за месяц» — там речь про сеть, здесь про
  // себя, и факт/план в процентах читается понятнее ) ---
  let monthHtml = '';
  const myMonth = (monthPlans || []).find((p: any) => String(p.employee_id) === String(empId) || String(p.id) === String(empId)) || null;

  if (myMonth) {
    const plan = myMonth.plan || {};
    const fact = myMonth.fact || {};
    const GROUPS = [
      { label: 'Блок GI', rows: [['sim'], ['mnp'], ['pa'], ['hb']] },
      { label: 'Товарка', rows: [['combo'], ['phones'], ['accessories'], ['insurance']] },
      { label: 'Ростелеком', rows: [['wink'], ['shpd'], ['focus']] },
      { label: 'Кредиты', rows: [['credit_request', 'Заявка'], ['credit_issued', 'Выданный']] }
    ];
    monthHtml = `
          <div class="mt-card">
            <div class="mt-card-head">
              <div>
                <div class="mt-name">Месяц ${month}</div>
                <div class="mt-meta">Смен: ${myMonth.shifts || 0} · осталось: ${myMonth.remaining_shifts || 0}</div>
              </div>
            </div>
            ${GROUPS.map(
              (g) => `
              <div class="block-label">${g.label}</div>
              ${g.rows.map(([id, label]) => progressHTML(label || metricLabel(id), fact[id], plan[id])).join('')}
            `
            ).join('')}
          </div>`;
  } else {
    monthHtml = `
          <div class="mt-card">
            <div class="mt-name" style="margin-bottom:8px">Месяц ${month}</div>
            <div class="empty" style="padding:8px 0">Месячный план подтянется, когда будут данные</div>
          </div>`;
  }
  const lkMonth = document.getElementById('lkMonth');
  if (lkMonth) lkMonth.innerHTML = `<div class="section-title" style="margin-bottom:8px">Прогресс за месяц</div>` + monthHtml;

  // --- Неделя (график) ---
  const schedules: any[] = Array.isArray(monthSch) ? monthSch : monthSch?.items || monthSch?.schedules || [];
  const mySch = schedules.filter((s) => String(s.employee_id) === String(empId));
  const byDate: Record<string, any> = {};
  mySch.forEach((s) => {
    const d = String(s.work_date || s.date || '').slice(0, 10);
    if (d) byDate[d] = s;
  });

  // 7 дней вокруг сегодня (сегодня ±3, или текущая неделя пн-вс)
  const base = new Date(today + 'T12:00:00');
  let weekDays: string[] = [];
  // показываем 7 дней начиная с понедельника текущей недели
  const dow = base.getDay(); // 0 вс
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + mondayOffset + i);
    const iso = dt.toISOString().slice(0, 10);
    weekDays.push(iso);
  }
  // если сегодня не в диапазоне — сдвиг: просто 7 дней от сегодня-3
  if (!weekDays.includes(today)) {
    weekDays = [];
    for (let i = -3; i <= 3; i++) {
      const dt = new Date(base);
      dt.setDate(base.getDate() + i);
      weekDays.push(dt.toISOString().slice(0, 10));
    }
  }

  const wdNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const lkWeek = document.getElementById('lkWeek');
  if (lkWeek) {
    lkWeek.innerHTML = `
        <div class="section-title" style="margin-bottom:8px">Моя неделя</div>
        <div class="lk-week">
          ${weekDays
            .map((iso) => {
              const d = new Date(iso + 'T12:00:00');
              const sch = byDate[iso];
              const isToday = iso === today;
              const col = sch ? storeColor(sch.store_id) : 'var(--surface-2)';
              return `
              <div class="lk-day ${isToday ? 'today' : ''} ${sch ? '' : 'off'}">
                <div class="wd">${wdNames[d.getDay()]}</div>
                <div class="dn">${d.getDate()}</div>
                <div class="st" style="background:${col}" title="${sch ? sch.store_name || sch.store_id || '' : 'вых'}"></div>
              </div>`;
            })
            .join('')}
        </div>
        <div style="font-size:11px;color:var(--hint);margin:4px 0 12px">
          Цвет точки = смена · серый = выходной
        </div>`;
  }

  // --- BFQ ---
  const bfqList: any[] = Array.isArray(bfqData) ? bfqData : bfqData?.items || bfqData?.employees || [];
  const myBfq = bfqList.find((e) => String(e.employee_id) === String(empId) || String(e.id) === String(empId));
  const sorted = [...bfqList].sort((a, b) => Number(b.total ?? b.bfq ?? 0) - Number(a.total ?? a.bfq ?? 0));
  const rank = myBfq ? sorted.findIndex((e) => String(e.employee_id) === String(empId) || String(e.id) === String(empId)) + 1 : null;
  const score = myBfq ? myBfq.total ?? myBfq.bfq ?? '—' : '—';

  const lkBfq = document.getElementById('lkBfq');
  if (lkBfq) {
    lkBfq.innerHTML = `
        <div class="lk-bfq-card" onclick="switchPage('bfq')" style="cursor:pointer">
          <div>
            <div class="bfq-label">BFQ за месяц</div>
            <div class="bfq-score">${score}</div>
          </div>
          <div class="bfq-rank">
            ${rank ? `#${rank} в сети` : 'Нет рейтинга'}
            <div style="font-size:11px;opacity:0.6;margin-top:4px">открыть →</div>
          </div>
        </div>`;
  }

  // --- Быстрые действия ---
  const lkActions = document.getElementById('lkActions');
  if (lkActions) {
    lkActions.innerHTML = `
        <div class="section-title" style="margin-bottom:8px">Действия</div>
        <div class="lk-actions-grid">
          <button class="lk-action" onclick="openAddSale(${empId})">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M5 12h14" /> <path d="M12 5v14" /> </svg></div>
            <div class="la-title">Продажа</div>
            <div class="la-sub">Внести метрики</div>
          </button>
          <button class="lk-action" onclick="switchPage('schedule')">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M8 2v3" /> <path d="M16 2v3" /> <rect x="3" y="3" width="18" height="18" rx="2" /> <path d="M3 9h18" /> </svg></div>
            <div class="la-title">График</div>
            <div class="la-sub">Месяц целиком</div>
          </button>
          <button class="lk-action" onclick="switchPage('plan')">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <circle cx="12" cy="12" r="6" /> <circle cx="12" cy="12" r="2" /> </svg></div>
            <div class="la-title">План дня</div>
            <div class="la-sub">Все точки</div>
          </button>
          <button class="lk-action" onclick="startTutorial('employee')">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /> <path d="M22 10v6" /> <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /> </svg></div>
            <div class="la-title">Обучение</div>
            <div class="la-sub">Как пользоваться</div>
          </button>
          <button class="lk-action" onclick="openShiftSession()">
            <div class="la-ico"><span class="status-dot" style="background:var(--success)"></span></div>
            <div class="la-title">Смена</div>
            <div class="la-sub">Открыть / закрыть</div>
          </button>
          <button class="lk-action" onclick="openQuickSale()">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" /> </svg></div>
            <div class="la-title">Быстрый ввод</div>
            <div class="la-sub">«две симки mnp»</div>
          </button>
          <button class="lk-action" onclick="switchPage('live')">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" /> <path d="M15 5.764v15" /> <path d="M9 3.236v15" /> </svg></div>
            <div class="la-title">Сеть live</div>
            <div class="la-sub">Все точки</div>
          </button>
          <button class="lk-action" onclick="historyEmployeeFilter=${empId};switchPage('history')">
            <div class="la-ico"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 17V7" /> <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" /> <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" /> </svg></div>
            <div class="la-title">История продаж</div>
            <div class="la-sub">Твои продажи</div>
          </button>
        </div>`;
  }

  // --- Не-Telegram вход (20.36): привязка телефона+пароля к своей же
  // карточке — второй способ входа для тех, у кого сегодня Telegram
  // недоступен (VPN, нет аккаунта у коллеги и т.п.). ---
  const lkPhoneAuth = document.getElementById('lkPhoneAuth');
  if (lkPhoneAuth) {
    const linkRow = me?.phone
      ? `
          <div class="row" style="cursor:default">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 6 9 17l-5-5" /> </svg></div>
            <div class="row-body">
              <div class="row-title">Подключено</div>
              <div class="row-sub">${esc(me.phone)}</div>
            </div>
          </div>`
      : `
          <button class="row" onclick="openLinkPhone()">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="14" height="20" x="5" y="2" rx="2" ry="2" /> <path d="M12 18h.01" /> </svg></div>
            <div class="row-body">
              <div class="row-title">Привязать телефон и пароль</div>
              <div class="row-sub">Понадобится, если Telegram недоступен</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`;
    // Сессия по телефону (не Telegram) — единственный способ выйти отсюда,
    // выход из Telegram-сессии самим Telegram и управляется, кнопка ему не нужна.
    const logoutRow = !user?.id
      ? `
          <button class="row" onclick="logoutSelf()">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /> <polyline points="16 17 21 12 16 7" /> <line x1="21" x2="9" y1="12" y2="12" /> </svg></div>
            <div class="row-body"><div class="row-title">Выйти</div></div>
          </button>`
      : '';
    lkPhoneAuth.innerHTML = `<div class="section"><div class="section-title">Вход с компьютера</div>${linkRow}${logoutRow}</div>`;
  }

  // 20.48.0 (Web Security & Trust Layer) — активные сессии: работает для
  // любого provider'а (Telegram-пользователь тоже видит и может отозвать
  // свою браузерную сессию), не только для phone-входа выше.
  loadSessionsSection();

  // v13: сессия смены + инсайт + геймификация
  loadShiftAndInsight(empId);
}

// 20.48.1 — formatDateRu() рассчитан на "YYYY-MM-DD" (split('-'), 3 части);
// created_at/last_seen_at — полный ISO-datetime ("2026-08-28T13:24:26.937Z"),
// split('-') даёт 3 "неправильные" части → "28T13:24:26.937Z.08.2026" на
// экране. Остальные вызывающие formatDateRu() передают чистую дату —
// не трогаем её, заводим отдельный форматтер только для этого экрана.
function formatSessionDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadSessionsSection(): Promise<void> {
  const el = document.getElementById('lkSessions');
  if (!el) return;
  let data;
  try {
    data = await window.apiClient.listSessions(authHeaders(true));
  } catch (_) {
    el.innerHTML = '';
    return;
  }
  if (!data.sessions.length) {
    el.innerHTML = '';
    return;
  }
  const rows = data.sessions
    .map(
      (s) => `
          <div class="row" style="cursor:default">
            <div class="row-body">
              <div class="row-title">${s.current ? 'Эта сессия' : 'Активна с ' + formatSessionDateTime(s.created_at)}</div>
              <div class="row-sub">Последняя активность: ${formatSessionDateTime(s.last_seen_at)}</div>
            </div>
            ${s.current ? '' : `<button class="mchip" onclick="revokeSessionRow(${s.id})">Завершить</button>`}
          </div>`
    )
    .join('');
  const revokeOthers =
    data.sessions.length > 1
      ? `<button class="row" onclick="revokeOtherSessionsRow()"><div class="row-body"><div class="row-title">Завершить остальные</div></div></button>`
      : '';
  el.innerHTML = `<div class="section"><div class="section-title">Активные сессии</div>${rows}${revokeOthers}</div>`;
}

export async function revokeSessionRow(id: number): Promise<void> {
  try {
    // 20.48.1 — DELETE без тела; authHeaders(true) ставит Content-Type:
    // application/json без тела, Fastify's body-parser отвечает "Body
    // cannot be empty" на пустое тело с этим заголовком.
    await window.apiClient.revokeSession(authHeaders(), id);
    toast('Сессия завершена', 'ok');
    loadSessionsSection();
  } catch (e: any) {
    toast(e?.message || 'Не удалось завершить сессию', 'err');
  }
}

export async function revokeOtherSessionsRow(): Promise<void> {
  try {
    await window.apiClient.revokeOtherSessions(authHeaders(true));
    toast('Остальные сессии завершены', 'ok');
    loadSessionsSection();
  } catch (e: any) {
    toast(e?.message || 'Не удалось завершить сессии', 'err');
  }
}

export function openLinkPhone(): void {
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  if (title) title.textContent = 'Вход с компьютера';
  if (body) {
    body.innerHTML = `
      <div class="empty" style="text-align:left;padding:0 0 10px">
        Придумай телефон и пароль — так можно будет войти в T2 Sales с
        компьютера или телефона без Telegram.
      </div>
      <div class="field"><label>Телефон</label><input id="linkPhoneInput" type="tel" placeholder="+79001234567" autocomplete="tel"></div>
      <div class="field"><label>Пароль</label><input id="linkPasswordInput" type="password" placeholder="Минимум 8 символов" autocomplete="new-password"></div>
      <div class="field"><label>Повторите пароль</label><input id="linkPasswordConfirmInput" type="password" autocomplete="new-password"></div>
      <button class="btn-main" style="margin-top:8px" onclick="saveLinkPhone(this)">Привязать</button>
    `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function logoutSelf(): Promise<void> {
  try {
    await window.apiClient.logoutPhone(authHeaders(true));
  } catch (_) {
    // Cookie могла уже протухнуть/быть удалена — не блокируем выход этим.
  }
  location.reload();
}

export async function saveLinkPhone(btnEl: HTMLButtonElement | null): Promise<void> {
  if (btnEl?.disabled) return;
  const phone = (document.getElementById('linkPhoneInput') as HTMLInputElement | null)?.value.trim() || '';
  const password = (document.getElementById('linkPasswordInput') as HTMLInputElement | null)?.value || '';
  const confirm = (document.getElementById('linkPasswordConfirmInput') as HTMLInputElement | null)?.value || '';

  if (!phone) {
    toast('Введите телефон', 'err');
    return;
  }
  if (password.length < 8) {
    toast('Пароль должен быть от 8 символов', 'err');
    return;
  }
  if (password !== confirm) {
    toast('Пароли не совпадают', 'err');
    return;
  }

  if (btnEl) btnEl.disabled = true;
  try {
    await window.apiClient.linkPhone(authHeaders(true), { phone, password });
    toast('Телефон привязан', 'ok');
    closeModal();
    loadMyPlan();
  } catch (e: any) {
    toast(e?.message || 'Не удалось привязать телефон', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

export async function bindMe(): Promise<void> {
  const user = tgUser();
  if (!user?.id) {
    toast('Откройте из Telegram', 'err');
    return;
  }
  const employeeId = (document.getElementById('bindEmployee') as HTMLSelectElement | null)?.value;
  try {
    me = await window.apiClient.bindMe(authHeaders(true), { telegram_id: user.id, employee_id: Number(employeeId) });
    toast('Привязано', 'ok');
    loadMyPlan();
  } catch (e) {
    toast('Ошибка привязки', 'err');
  }
}

// 19: кастомная аватарка. Открывает системный пикер файла, скрытый <input>
// создаётся один раз и переиспользуется.
export function pickAvatarFile(): void {
  let input = document.getElementById('avatarFileInput') as HTMLInputElement | null;
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = 'avatarFileInput';
    input.style.display = 'none';
    input.addEventListener('change', onAvatarFileChosen);
    document.body.appendChild(input);
  }
  input.value = '';
  input.click();
}

// Сжимаем на клиенте до ~256×256 перед загрузкой — держит bytea в базе
// маленьким, не тянем библиотеку ради этого (голый Canvas API хватает).
function resizeImageFile(file: File, maxSize = 256, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob fail'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('image load fail'));
    img.src = URL.createObjectURL(file);
  });
}

async function onAvatarFileChosen(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const blob = await resizeImageFile(file);
    const form = new FormData();
    form.append('file', blob, 'avatar.jpg');
    await window.apiClient.uploadAvatar(authHeaders(), form);
    toast('Аватарка обновлена', 'ok');
    loadMyPlan();
  } catch (err) {
    toast('Не удалось загрузить фото', 'err');
  }
}

declare global {
  interface Window {
    loadMyPlan: typeof loadMyPlan;
    bindMe: typeof bindMe;
    pickAvatarFile: typeof pickAvatarFile;
    openLinkPhone: typeof openLinkPhone;
    saveLinkPhone: typeof saveLinkPhone;
    logoutSelf: typeof logoutSelf;
    revokeSessionRow: typeof revokeSessionRow;
    revokeOtherSessionsRow: typeof revokeOtherSessionsRow;
  }
}
window.loadMyPlan = loadMyPlan;
window.bindMe = bindMe;
window.pickAvatarFile = pickAvatarFile;
window.openLinkPhone = openLinkPhone;
window.saveLinkPhone = saveLinkPhone;
window.logoutSelf = logoutSelf;
window.revokeSessionRow = revokeSessionRow;
window.revokeOtherSessionsRow = revokeOtherSessionsRow;
