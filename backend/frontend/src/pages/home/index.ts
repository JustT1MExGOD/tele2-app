/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/03-home.js file-for-file: главная («Мой день», Command Center
 * виджет, недельный дэшборд/топ-7, приветствие+стрик-бейджи, «О приложении»).
 *
 * commandCenterTone()/bumpStreak() already had ambient declarations in
 * legacy-globals.d.ts (read by already-migrated command-center/add-sale
 * modules) — this file is their real owner/implementation; declarations
 * stay as-is (still accurate, now backed by this module instead of the
 * classic script), same precedent as openModal/closeModal.
 */
import type { MeDayResponse, TaskItem, SupervisorHealthResponse, StatsDailyRow, DashboardResponse } from '../../../../src/shared/api-types.js';

// Пишет в оба места разом — id элемента и его Desktop-версию (20.40,
// docs/DESKTOP-DESIGN.md): данные получены один раз, два тонких
// render-таргета их потребляют — мобильная swipe-панель и десктопный
// dashboard (см. #homeDesktopDashboard, index.html), не два отдельных
// источника данных.
function setBothHTML(mobileId: string, desktopId: string, html: string): void {
  const a = document.getElementById(mobileId);
  if (a) a.innerHTML = html;
  const b = document.getElementById(desktopId);
  if (b) b.innerHTML = html;
}

export async function loadMyDay(): Promise<void> {
  const box = document.getElementById('myDayBody');
  if (!box) return;
  // Раньше здесь был безусловный ранний return по !tgUser()?.id — стало
  // неверным с 20.35+ (не-Telegram вход): у GET /me/day (routes/me) и так
  // уже есть свой graceful "нет identity" ответ ({bound:false, message:
  // 'Привяжите аккаунт во вкладке Профиль'}, см. ветку !d.bound ниже) —
  // тот же самый случай, каким бы способом ни резолвилась (или не
  // резолвилась) identity. Старый гейт молча ломал «Мой день» для
  // ЛЮБОГО desktop/phone-login пользователя — данные были доступны, но
  // экран показывал «Открой из Telegram», хотя человек и так был внутри
  // приложения залогинен.
  try {
    const d: MeDayResponse = await window.apiClient.getMyDay(authHeaders());
    if (!d.bound) {
      setBothHTML(
        'myDayBody',
        'myDayBodyDesktop',
        `<div class="empty" style="text-align:left;padding:8px 0">Аккаунт не привязан</div>
            <button class="btn-main" onclick="switchPage('my')">Привязать себя</button>`
      );
      (document.getElementById('homeTodaySwipe') as any)?._swipeRefreshHeight?.();
      return;
    }
    const shift = d.shift;
    const tot = d.total || ({} as { fact?: number; plan?: number; pct?: number });
    const pr = d.progress || {};
    const headHtml = shift
      ? `<div style="padding:0 16px 10px">
                <div style="font-size:15px;font-weight:700">${esc(shift.store_code || shift.store_name || '')}</div>
                ${shift.store_address ? `<div style="font-size:12px;color:var(--hint);margin-top:2px">${esc(shift.store_address)}</div>` : ''}
              </div>`
      : `<div style="padding:0 16px 10px"><div style="font-size:15px;font-weight:700">Выходной</div></div>`;
    setBothHTML('myDayStoreHead', 'myDayStoreHeadDesktop', headHtml);
    // Тот же код/адрес — ещё и в шапке приложения, той же плашкой, что
    // «Сегодня»: видно на любой вкладке, не только на Главной, пока не
    // перейдёшь на Главную заново (обновляется вместе с «Мой день»).
    const headerPill = document.getElementById('headerStorePill');
    if (headerPill) {
      if (shift && (shift.store_code || shift.store_address)) {
        const codeEl = document.getElementById('headerStoreCode');
        if (codeEl) codeEl.textContent = shift.store_code || shift.store_name || '';
        const addrEl = document.getElementById('headerStoreAddr');
        if (addrEl) addrEl.textContent = shift.store_address || '';
        headerPill.style.display = '';
      } else {
        headerPill.style.display = 'none';
      }
    }
    const bodyHtml = `
          <div class="progress-block">
            ${
              shift
                ? `
              <div class="row" style="border:none;padding:0 0 10px">
                <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" /> </svg></div>
                <div class="row-body">
                  <div class="row-title">${shift.store_name || 'Точка'}</div>
                  <div class="row-sub">${shift.shift_text || ''} · ${shift.hours || ''}ч</div>
                </div>
                <div class="row-value">${tot.pct || 0}%</div>
              </div>`
                : `
              <div class="empty" style="text-align:left;padding:0 0 10px">Сегодня выходной / нет в графике</div>`
            }
            ${Object.keys(pr)
              .filter((m) => (pr[m]?.plan || 0) > 0)
              .map((m) => {
                const x = pr[m] || { fact: 0, plan: 0, pct: 0 };
                return progressHTML(metricShort(m), x.fact, x.plan);
              })
              .join('')}
            <button class="btn-main" style="margin-top:8px" onclick="openAddSale()">+ Продажа</button>
          </div>
          ${myTasksHTML(d.tasks)}`;
    setBothHTML('myDayBody', 'myDayBodyDesktop', bodyHtml);
  } catch (e) {
    setBothHTML('myDayBody', 'myDayBodyDesktop', '<div class="empty">Не удалось загрузить «Мой день»</div>');
  }
  (document.getElementById('homeTodaySwipe') as any)?._swipeRefreshHeight?.();
}

/* 18.4 — задачи, назначенные менеджером (Command Center → create_task), на
   единственном персональном экране сотрудника. */
function myTasksHTML(tasks?: TaskItem[]): string {
  if (!Array.isArray(tasks) || !tasks.length) return '';
  return `
        <div class="section-title" style="padding:12px 0 8px">Мои задачи</div>
        ${tasks
          .map(
            (t) => `
          <div class="row" style="cursor:default">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg></div>
            <div class="row-body">
              <div class="row-title">${esc(t.title)}</div>
              <div class="row-sub">${t.store_name ? esc(t.store_name) + ' · ' : ''}${t.status === 'in_progress' ? 'В работе' : 'Открыта'}${t.due_at ? ' · до ' + new Date(t.due_at).toLocaleString('ru') : ''}</div>
            </div>
            <button class="mchip" onclick="completeMyTask(${t.id})">Готово</button>
          </div>`
          )
          .join('')}`;
}

export async function completeMyTask(id: number): Promise<void> {
  try {
    await window.apiClient.changeTaskStatus(authHeaders(true), id, { status: 'done' });
    toast('Задача выполнена', 'ok');
    loadMyDay();
  } catch (e) {
    toast('Не удалось отметить задачу', 'err');
  }
}

// ===== COMMAND CENTER (14.5) =====
// Health + просадки в одном виджете на главной — вместо того чтобы
// управляющий сам собирал это из /supervisor и /live по отдельности.
// /supervisor/health для того и заведён ("короткий срез для виджетов"),
// просто раньше не был подключён ни к одному экрану.
export function commandCenterTone(health: number): string {
  if (health >= 75) return 'good';
  if (health >= 45) return 'mid';
  return 'bad';
}

export async function loadCommandCenter(): Promise<void> {
  const section = document.getElementById('commandCenterSection');
  const box = document.getElementById('commandCenterBody');
  // Desktop-версия панели аналитики (20.40) — отдельная секция в
  // #homeDesktopDashboard, не показывается вместе с мобильной. Класс
  // .insights-panel добавляется здесь же, только когда роль реально
  // видит панель — styles.css's :has(.insights-panel) на 1600px+ читает
  // именно этот класс, не строку инлайн-style, чтобы не оставлять
  // пустую 3-ю колонку у роли без доступа к аналитике.
  const sectionDesktop = document.getElementById('homeDesktopInsights');
  const boxDesktop = document.getElementById('commandCenterBodyDesktop');
  if (!section || !box) return;
  if (!canViewAnalytics()) {
    section.style.display = 'none';
    if (sectionDesktop) {
      sectionDesktop.style.display = 'none';
      sectionDesktop.classList.remove('insights-panel');
    }
    return;
  }
  section.style.display = '';
  if (sectionDesktop) {
    sectionDesktop.style.display = '';
    sectionDesktop.classList.add('insights-panel');
  }
  try {
    const d: SupervisorHealthResponse = await window.apiClient.getSupervisorHealth(authHeaders(), orgQueryParam());
    const health = Number(d.health) || 0;
    const tone = commandCenterTone(health);
    const pace = Number(d.pace_delta) || 0;
    const paceText = (pace >= 0 ? '+' : '') + pace + '% к темпу дня';
    const drops = Array.isArray(d.drops) ? (d.drops as any[]) : [];

    const ccHtml = `
          <div class="cc-row">
            <div class="cc-health ${tone}">${health}</div>
            <div class="cc-meta">
              <div class="cc-line"><b>${d.overall_pct || 0}%</b> план дня</div>
              <div class="cc-line cc-${pace >= 0 ? 'up' : 'down'}">${paceText}</div>
            </div>
            <button class="row-chevron" style="background:none;border:none;font-size:20px;color:var(--hint)" onclick="switchPage('command-center')">›</button>
          </div>
          ${
            drops.length
              ? drops
                  .slice(0, 3)
                  .map(
                    (x) => `
              <div class="sv-drop ${x.severity === 'critical' ? '' : 'warn'}" style="margin:8px 0 0">
                <div class="ico">${x.severity === 'critical' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>'}</div>
                <div style="flex:1">
                  <div class="t">${esc(x.store_name || 'Точка')}</div>
                  <div class="s">${esc(x.message || '')}</div>
                  ${x.ai_comment ? `<div class="s" style="margin-top:4px;font-style:italic"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" /> </svg> ${esc(x.ai_comment)}</div>` : ''}
                  ${x.store_id ? `<button class="mchip" style="margin-top:6px" onclick="event.stopPropagation();proposeMoveForStore('${x.store_id}')">Предложить перенос</button>` : ''}
                </div>
              </div>`
                  )
                  .join('')
              : '<div class="empty" style="padding:10px 0 0">Критических просадок нет — сеть в ритме</div>'
          }`;
    box.innerHTML = ccHtml;
    if (boxDesktop) boxDesktop.innerHTML = ccHtml;
  } catch (e) {
    section.style.display = 'none';
    if (sectionDesktop) {
      sectionDesktop.style.display = 'none';
      sectionDesktop.classList.remove('insights-panel');
    }
  }
}

/* Карточка приветствия: динамический индикатор смены (top-right угол, по
   факту из /shifts/current, а не догадка) + бейдж «N дн. до выходного»
   вместо статичного стрика — считаем по /schedules/month: первый день от
   сегодня, которого нет в графике (или hours=0). Обе вещи асинхронные —
   карточка уже отрисована синхронно с фолбэком («Внеси продажу…»/бейдж
   скрыт), эта функция патчит их по готовности. */
async function loadGreetShiftAndDaysOff(): Promise<void> {
  const empId = me?.employee_id;
  const badgeEl = document.getElementById('greetShiftBadge');
  const daysEl = document.getElementById('greetDaysOffBadge');
  if (!empId) return;
  try {
    const today = todayMoscow();
    const [cur, sch] = await Promise.all([
      window.apiClient.getShiftCurrent(authHeaders()).catch(() => null),
      window.apiClient.getScheduleMonth(authHeaders(), today.slice(0, 7), '').catch(() => null)
    ]);

    if (badgeEl) {
      const open = !!(cur as any)?.session;
      badgeEl.innerHTML = `<span class="dot"></span>${open ? 'Смена открыта' : 'Смена закрыта'}`;
      badgeEl.classList.toggle('open', open);
      badgeEl.style.display = '';
    }

    if (daysEl) {
      const rows = Array.isArray(sch) ? sch : (sch as any)?.items || (sch as any)?.schedules || [];
      const workDates = new Set(
        (rows as any[])
          .filter((s) => String(s.employee_id) === String(empId) && Number(s.hours) > 0)
          .map((s) => String(s.work_date || s.date || '').slice(0, 10))
      );
      let daysUntil: number | null = null;
      for (let i = 0; i <= 31; i++) {
        const d = new Date(today + 'T12:00:00');
        d.setDate(d.getDate() + i);
        if (!workDates.has(d.toISOString().slice(0, 10))) {
          daysUntil = i;
          break;
        }
      }
      daysEl.textContent = daysUntil === 0 ? 'Сегодня выходной' : daysUntil === null ? 'Внеси продажу — начни стрик' : `${daysUntil} дн. до выходного`;
    }
  } catch (e) {
    console.warn('loadGreetShiftAndDaysOff', e);
  }
}

export async function loadHome(): Promise<void> {
  const dateEl = document.getElementById('headerDate');
  if (dateEl) dateEl.textContent = formatDateRu(todayMoscow());

  // Приветствие
  const user = tgUser();
  const firstName = me?.full_name?.split(' ')[1] || me?.full_name?.split(' ')[0] || user?.first_name || 'команда';
  const today = todayMoscow();
  const greetEl = document.getElementById('greetingCard');
  if (greetEl) {
    greetEl.innerHTML = `
          <div class="greet-card">
            <div class="greet-shift-badge" id="greetShiftBadge" style="display:none"></div>
            <div class="greet-hi">${greetingByHour()}</div>
            <div class="greet-name">${firstName}</div>
            <div class="greet-badges">
              <span class="greet-badge">T2 Sales v${APP_VERSION}</span>
              <span class="greet-badge" id="greetDaysOffBadge">Внеси продажу — начни стрик</span>
              ${me?.role ? `<span class="greet-badge">${esc(roleLabel(me.role))}</span>` : ''}
            </div>
          </div>`;
  }
  loadGreetShiftAndDaysOff();

  loadMyDay();
  loadCommandCenter();
  initSwipePanels(document.getElementById('homeTodaySwipe'));
  try {
    const [stats, dash] = await Promise.all([
      window.apiClient.getStatsDaily(authHeaders(), today, orgQueryParam()).catch(() => [] as StatsDailyRow[]),
      window.apiClient.getDashboard(authHeaders(), orgQueryParam()).catch(() => null as DashboardResponse | null)
    ]);
    const list = Array.isArray(stats) ? stats : [];

    const t = list.reduce(
      (a, s) => ({
        sim: a.sim + (+s.sim || 0),
        mnp: a.mnp + (+s.mnp || 0),
        pa: a.pa + (+s.pa || 0),
        combo: a.combo + (+s.combo || 0),
        phones: a.phones + (+s.phones || 0),
        accessories: a.accessories + (+s.accessories || 0)
      }),
      { sim: 0, mnp: 0, pa: 0, combo: 0, phones: 0, accessories: 0 }
    );

    const setTxt = (id: string, v: unknown) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(v);
      const elDesktop = document.getElementById(id + 'Desktop');
      if (elDesktop) elDesktop.textContent = String(v);
    };
    setTxt('hSim', t.sim);
    setTxt('hMnp', t.mnp);
    setTxt('hPa', t.pa);
    setTxt('hCombo', t.combo);
    setTxt('hPhones', t.phones);
    setTxt('hAcc', t.accessories);

    // Пульс сети
    const units = (t.sim || 0) + (t.mnp || 0) + (t.pa || 0) + (t.combo || 0);
    const pulseHtml = `
            <div class="pulse-row">
              <div class="pulse-chip">
                <div class="pc-l">Единицы</div>
                <div class="pc-v">${units}</div>
              </div>
              <div class="pulse-chip">
                <div class="pc-l">${metricShort('phones')} ₽</div>
                <div class="pc-v">${Number(t.phones || 0).toLocaleString('ru-RU')}</div>
              </div>
              <div class="pulse-chip">
                <div class="pc-l">${metricShort('accessories')} ₽</div>
                <div class="pc-v">${Number(t.accessories || 0).toLocaleString('ru-RU')}</div>
              </div>
            </div>`;
    setBothHTML('networkPulse', 'networkPulseDesktop', pulseHtml);
    (document.getElementById('homeTodaySwipe') as any)?._swipeRefreshHeight?.();

    const box = document.getElementById('homeTop');
    const boxDesktop = document.getElementById('homeTopDesktop');
    if (box) {
      if (dash) {
        const leaders = (dash as any).top || (dash as any).top7 || (dash as any).leaders || (dash as any).employees || [];
        if (!leaders.length) {
          box.innerHTML = '<div class="empty">Нет данных за 7 дней</div>';
          if (boxDesktop) boxDesktop.innerHTML = box.innerHTML;
        } else {
          box.innerHTML = leaders
            .slice(0, 7)
            .map((e: any, i: number) => {
              const total = (+e.sim || 0) + (+e.mnp || 0) + (+e.pa || 0) + (+e.combo || 0);
              const medal =
                i === 0
                  ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" /> <path d="M11 12 5.12 2.2" /> <path d="m13 12 5.88-9.8" /> <path d="M8 7h8" /> <circle cx="12" cy="17" r="5" /> <path d="M12 18v-2h-.5" /> </svg>'
                  : i === 1
                    ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" /> <path d="M11 12 5.12 2.2" /> <path d="m13 12 5.88-9.8" /> <path d="M8 7h8" /> <circle cx="12" cy="17" r="5" /> <path d="M12 18v-2h-.5" /> </svg>'
                    : i === 2
                      ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15" /> <path d="M11 12 5.12 2.2" /> <path d="m13 12 5.88-9.8" /> <path d="M8 7h8" /> <circle cx="12" cy="17" r="5" /> <path d="M12 18v-2h-.5" /> </svg>'
                      : String(i + 1);
              return `
                <button class="row" onclick="openEmployeeCard(${e.id || e.employee_id})">
                  <div class="row-icon">${medal}</div>
                  <div class="row-body">
                    <div class="row-title">${esc(e.full_name)}</div>
                    <div class="row-sub">SIM ${e.sim || 0} · MNP ${e.mnp || 0} · ПА ${e.pa || 0}</div>
                  </div>
                  <div class="row-value">${total}</div>
                  <div class="row-chevron">›</div>
                </button>`;
            })
            .join('');
          if (boxDesktop) boxDesktop.innerHTML = box.innerHTML;
        }
      } else {
        box.innerHTML = '<div class="empty">Топ за 7 дней недоступен</div>';
        if (boxDesktop) boxDesktop.innerHTML = box.innerHTML;
      }
    }
    populateDesktopTools();
  } catch (e) {
    console.error(e);
  }
}

// Секция "Инструменты" на десктопном дашборде (20.40) — клонирует уже
// существующие мобильные .row-кнопки из #homeToolsSection один раз, а не
// дублирует ~16 строк SVG-разметки вручную во второй раз. onclick-атрибуты
// (switchPage(...)/openComboCalc() и т.д.) переживают cloneNode, работают
// на клоне так же, как на оригинале. Идемпотентно — повторные вызовы
// loadHome() не плодят дубликаты.
function populateDesktopTools(): void {
  const target = document.getElementById('homeDesktopTools');
  const source = document.getElementById('homeToolsSection');
  if (!target || !source || target.childElementCount) return;
  source.querySelectorAll(':scope > button.row').forEach((btn) => {
    const clone = btn.cloneNode(true) as HTMLElement;
    // btnMgrTutorial имеет id (гейтится ролью в bootApp() до первого
    // loadHome()) — без снятия id было бы два элемента с одинаковым id в
    // DOM, document.getElementById() слепо вернул бы только мобильный.
    clone.removeAttribute('id');
    target.appendChild(clone);
  });
}

export function bumpStreak(): number {
  const today = todayMoscow();
  const last = localStorage.getItem('t2_last_sale_day') || '';
  let streak = Number(localStorage.getItem('t2_streak') || 0);
  if (last === today) return streak;
  const yday = (() => {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  streak = last === yday ? streak + 1 : 1;
  localStorage.setItem('t2_streak', String(streak));
  localStorage.setItem('t2_last_sale_day', today);
  return streak;
}

export function openAbout(): void {
  haptic('light');
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'О приложении';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="about-ver">T2 Sales</div>
        <div style="font-size:13px;color:var(--hint);margin-bottom:14px">версия ${APP_VERSION} · Railway · МСК</div>
        <div class="about-block">
          <b>v13 — операционное ядро</b><br>
          • Смена-сессия (open/close + гео + самоотчёт)<br>
          • Быстрый ввод: «две симки mnp»<br>
          • Офлайн-очередь продаж<br>
          • Live-карта сети · инсайты · геймификация<br>
          • Умные алерты · what-if · прогноз
        </div>
        <div class="about-block">
          <b>v14 — аналитика и масштаб</b><br>
          • Кабинет супервайзера (health, просадки, тренды)<br>
          • Кастомные метрики · PNG-отчёты в чат<br>
          • Heatmap / forecast / announcements<br>
          • Доли точек: 55% / 25% / 20%
        </div>
        <div class="about-block">
          <b>v12–13.3</b><br>
          • Личный кабинет · мульти-метрики · BFQ<br>
          • Планы месяца (все метрики + архив)<br>
          • Касса: Δ = факт − (1С + 2000)<br>
          • Промокоды РТК · поддержка · роли
        </div>
        <div class="about-block">
          <b>Стек</b><br>
          Telegram Mini App · Node.js · Fastify · PostgreSQL · Grammy · Railway
        </div>
        <div class="about-block">
          <b>Точки</b><br>
          Космонавтов 20А · Калинина 2 · Калинина 11
        </div>
        <button class="btn-main" onclick="startTutorial('employee');closeModal()">Пройти обучение</button>
        <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)" onclick="closeModal()">Закрыть</button>
      `;
  }
  if (typeof openModal === 'function') openModal();
  else document.getElementById('overlay')?.classList.add('show');
}

declare global {
  interface Window {
    loadMyDay: typeof loadMyDay;
    completeMyTask: typeof completeMyTask;
    commandCenterTone: typeof commandCenterTone;
    loadCommandCenter: typeof loadCommandCenter;
    loadHome: typeof loadHome;
    bumpStreak: typeof bumpStreak;
    openAbout: typeof openAbout;
  }
}
window.loadMyDay = loadMyDay;
window.completeMyTask = completeMyTask;
window.commandCenterTone = commandCenterTone;
window.loadCommandCenter = loadCommandCenter;
window.loadHome = loadHome;
window.bumpStreak = bumpStreak;
window.openAbout = openAbout;
