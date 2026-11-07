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
import { renderLoadError } from '../../shared/load-error.js';
import type { MeDayResponse, TaskItem, SupervisorHealthResponse, StatsDailyRow, DashboardResponse, SafeStoreInfo } from '../../../../src/shared/api-types.js';

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

// ===== Beta UI 3.0 «Ночная смена» — разметка главной =====
// Блоки .u3h рендерятся всегда, но с атрибутом hidden: в старом UI их не
// видно, ui3/home.css показывает их только при body[data-ui="beta"], а
// старые блоки (.u3-legacy) там же прячет — переключатель работает без
// перерисовки. Данные те же, что уже пришли (/me/day, /stats/daily);
// новый запрос только один — лента продаж (GET /sales за сегодня и вчера),
// и только когда бета включена.
const U3_PATHS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  sim: '<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="9" y="11" width="6" height="6" rx="1"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  chart: '<path d="M4 20h16"/><path d="M5 16l4-5 4 3 6-8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M7 9.5v5M17 9.5v5"/>',
  calc: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 6h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 18h6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  pin: '<path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
};
const U3_METRIC_ICON: Record<string, string> = {
  sim: 'sim', mnp: 'swap', pa: 'target', combo: 'plus', phones: 'phone',
  accessories: 'bag', wink: 'play', insurance: 'shield', esim: 'sim'
};
function u3Ic(name: string): string {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${U3_PATHS[name] || U3_PATHS.chart}</svg>`;
}
function u3IsMoney(id: string): boolean {
  const m = (window.METRICS || []).find((x: { id: string }) => x.id === id) as { unit?: string } | undefined;
  return m?.unit === '₽' || m?.unit === 'money';
}
function u3Num(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}
function u3Dec1(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function u3Plural(n: number, a: string, b: string, c: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c;
}
/** Минуты от полуночи по Москве. */
function u3NowMin(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [h, m] = parts.split(':').map(Number);
  return (h % 24) * 60 + (m || 0);
}
/** «10-21», «10:00–21:30» → минуты начала/конца смены. */
function u3ShiftWindow(text: string | null | undefined): { start: number; end: number } | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/.exec(String(text || ''));
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2] || 0);
  const end = Number(m[3]) * 60 + Number(m[4] || 0);
  return end > start ? { start, end } : null;
}
function u3Hm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
function u3Pie(p: number, tone: string, label: string): string {
  return `<span class="u3h-pie ${tone}" style="--p:${Math.max(0, Math.min(1, p)).toFixed(3)}" role="img" aria-label="${esc(label)}"></span>`;
}

/** Hero «Продажи сегодня X из Y» + темп смены + прогноз к концу смены. */
function u3HeroHTML(d: MeDayResponse): string {
  const pr = d.progress || {};
  let fact = 0;
  let plan = 0;
  Object.keys(pr).forEach((k) => {
    if (u3IsMoney(k) || !(pr[k]?.plan > 0)) return;
    fact += Number(pr[k].fact) || 0;
    plan += Number(pr[k].plan) || 0;
  });
  const win = d.shift ? u3ShiftWindow(d.shift.shift_text) : null;
  const now = u3NowMin();
  const e = win ? Math.max(0, Math.min(1, (now - win.start) / (win.end - win.start))) : 1;
  const forecast = win && e > 0.05 && e < 1 ? Math.round(fact / e) : null;
  const behind = plan > 0 && e > 0 && fact < plan * e * 0.9;
  const left = Math.max(0, plan - fact);
  const minsLeft = win ? Math.max(0, win.end - now) : 0;
  let sub: string;
  if (!d.shift) sub = 'Сегодня выходной, продажи всё равно считаются';
  else if (plan <= 0) sub = 'На сегодня план не задан';
  else if (left === 0) sub = 'План дня закрыт';
  else sub = `Ещё ${u3Num(left)} до плана`;
  // Темп — подписью под линией (начало смены слева, остаток справа); прогноз — только в чипе.
  const hLeft = Math.floor(minsLeft / 60);
  const ended = !!win && e >= 1;
  const leftTxt = !win ? '' : ended ? `смена закончилась, итог ${u3Num(fact)}` : e === 0 ? `смена с ${u3Hm(win.start)}` : `осталось ${hLeft ? hLeft + ' ч ' : ''}${minsLeft % 60} мин`;
  const axis = win && plan > 0 ? `<div class="u3h-axis"><span>${u3Hm(win.start)}</span><span>${leftTxt}</span><span>${u3Hm(win.end)}</span></div>` : '';
  // Линия темпа: план — пунктир 0→план через всю смену, факт — сплошная до «сейчас», прогноз — точки.
  const W = 320;
  const H = 44;
  const top = Math.max(plan, forecast || 0, fact, 1);
  const y = (v: number): number => H - 4 - (v / top) * (H - 10);
  const xNow = e * W;
  const chart = plan > 0
    ? `<svg class="u3h-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="pp" x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(plan).toFixed(1)}"/>
        ${forecast !== null ? `<line class="pf" x1="${xNow.toFixed(1)}" y1="${y(fact).toFixed(1)}" x2="${W}" y2="${y(forecast).toFixed(1)}"/>` : ''}
        <path class="l" d="M0,${y(0).toFixed(1)} L${xNow.toFixed(1)},${y(fact).toFixed(1)}"/>
        <circle class="dot" cx="${Math.min(W - 3, Math.max(3, xNow)).toFixed(1)}" cy="${y(fact).toFixed(1)}" r="3.5"/>
      </svg>`
    : '';
  const chip = forecast !== null && win
    ? `<span class="u3h-chip${forecast < plan ? ' warn' : ''}">прогноз ${u3Num(forecast)} к ${u3Hm(win.end)}</span>`
    : d.total?.pct ? `<span class="u3h-chip">${d.total.pct}% плана</span>` : '';
  return `<section class="u3h-hero${behind ? ' behind' : ''}" aria-label="Продажи сегодня">
      <div class="u3h-hero-row"><span class="u3h-h-label">Продажи сегодня</span>${chip}</div>
      <p class="u3h-h-num">${u3Num(fact)}${plan > 0 ? ` <small>из ${u3Num(plan)}</small>` : ''}</p>
      <p class="u3h-h-sub">${esc(sub)}</p>
      ${chart}${axis}
    </section>`;
}

/** «План дня» — Apple grouped строки с пирогом темпа на каждую метрику. */
function u3DayRowsHTML(d: MeDayResponse): string {
  const pr = d.progress || {};
  const mp = (d.month_plan || {}) as Record<string, unknown>;
  const mf = d.month_fact || {};
  const shiftsLeft = Math.max(1, Number(d.remaining_shifts) || 1);
  const win = d.shift ? u3ShiftWindow(d.shift.shift_text) : null;
  const e = win ? Math.max(0, Math.min(1, (u3NowMin() - win.start) / (win.end - win.start))) : 1;
  const rows = Object.keys(pr)
    .filter((k) => (pr[k]?.plan || 0) > 0)
    .map((k) => {
      const f = Number(pr[k].fact) || 0;
      const p = Number(pr[k].plan) || 0;
      const r = f / p;
      const money = u3IsMoney(k);
      const done = r >= 1;
      // Отставание от темпа смены: до 15% — мягкое (жёлтый), больше — красный.
      const lag = !done && e > 0 ? 1 - r / e : 0;
      const behind = lag > 0.15;
      const mild = !behind && lag > 0.05;
      const tone = done ? 'done' : behind ? 'bad' : mild ? 'warn' : 'ok';
      const state = done ? 'план дня закрыт' : behind ? 'отстаёт от темпа' : mild ? 'чуть ниже темпа' : 'в темпе';
      const mPlan = Number(mp[k]) || 0;
      const mFact = Number(mf[k]) || 0;
      const need = mPlan > 0 ? Math.max(0, (mPlan - mFact) / shiftsLeft) : 0;
      const rub = (v: number): string => (v >= 10000 ? `${u3Dec1(v / 1000)} тыс ₽` : `${u3Num(v)} ₽`);
      const needTxt = mPlan > 0 && need > 0 ? (money ? `нужно ${rub(need)} в день` : `нужно ${u3Dec1(need)} в день`) + ', ' : '';
      const unit = money ? ' ₽' : '';
      return `<div class="u3h-cell${behind ? ' behind' : ''}${mild ? ' mild' : ''}">
          ${u3Pie(r, tone, `${Math.round(r * 100)}%, ${state}`)}
          <span class="u3h-c-main"><span class="u3h-c-t">${esc(metricShort(k))}</span><span class="u3h-c-s">${needTxt}${state}</span></span>
          <span class="u3h-c-r">${u3Num(f)}${unit}<span class="u3h-c-s">из ${u3Num(p)}${unit}</span></span>
        </div>`;
    })
    .join('');
  return rows
    ? `<div class="u3h-g-head"><span>План дня</span><button type="button" class="u3h-link" data-on="switchPage" data-on-event="click" data-arg="monthplan">Месяц</button></div>
       <div class="u3h-group">${rows}</div>`
    : '';
}

// Лента продаж: строка продажи — одна запись на сотрудника/точку/день с
// суммами по метрикам, отдельных чеков в модели нет. Поэтому каждая
// ненулевая метрика своей записи = строка ленты.
function u3FeedRows(rows: any[]): { html: string; count: number } {
  let count = 0;
  const html = rows
    .map((s) => {
      const t = timeMoscow(s.updated_at);
      return (window.METRICS || [])
        .map((m: { id: string; label: string }) => {
          const v = Number(s[m.id]) || 0;
          if (v <= 0) return '';
          count++;
          const money = u3IsMoney(m.id);
          return `<div class="u3h-cell">
              <span class="u3h-tile">${u3Ic(U3_METRIC_ICON[m.id] || 'chart')}</span>
              <span class="u3h-c-main"><span class="u3h-c-t">${esc(m.label)}</span><span class="u3h-c-s">${[t, s.store_name].filter(Boolean).map((x) => esc(String(x))).join(', ')}</span></span>
              <span class="u3h-c-r">${money ? u3Num(v) + ' ₽' : '+' + u3Num(v) + ' шт'}</span>
            </div>`;
        })
        .join('');
    })
    .join('');
  return { html, count };
}

let u3FeedSeq = 0;
async function u3LoadFeed(): Promise<void> {
  const boxes = document.querySelectorAll<HTMLElement>('.u3h-feed');
  if (!boxes.length || !isBetaUi()) return;
  const seq = ++u3FeedSeq;
  const empId = String(me?.employee_id || '');
  const today = todayMoscow();
  const yd = new Date(today + 'T12:00:00');
  yd.setDate(yd.getDate() - 1);
  const yday = yd.toISOString().slice(0, 10);
  const [a, b] = await Promise.all([
    window.apiClient.getSales(authHeaders(), today, orgQueryParam()).catch(() => null),
    window.apiClient.getSales(authHeaders(), yday, orgQueryParam()).catch(() => null)
  ]);
  if (seq !== u3FeedSeq) return;
  const mine = (list: any): any[] => (Array.isArray(list) ? list : []).filter((s) => String(s.employee_id) === empId && !s.voided_at);
  const t = u3FeedRows(mine(a));
  const y = u3FeedRows(mine(b));
  let html: string;
  if (a === null && b === null) {
    html = `<div class="u3h-g-head"><span>Сегодня</span></div><div class="u3h-group"><div class="u3h-empty">Не удалось загрузить продажи</div></div>`;
  } else {
    html =
      `<div class="u3h-g-head"><span>Сегодня</span><span class="u3h-meta">${t.count ? `${t.count} ${u3Plural(t.count, 'позиция', 'позиции', 'позиций')}` : ''}</span></div>` +
      `<div class="u3h-group has-tile">${t.html || '<div class="u3h-empty">Сегодня продаж ещё нет. Первая — кнопкой «Продажа» выше</div>'}</div>` +
      (y.count ? `<div class="u3h-g-head sub"><span>Вчера</span><span class="u3h-meta">${y.count} ${u3Plural(y.count, 'позиция', 'позиции', 'позиций')}</span></div><div class="u3h-group has-tile">${y.html}</div>` : '');
  }
  boxes.forEach((el) => {
    el.innerHTML = html;
  });
  (document.getElementById('homeTodaySwipe') as any)?._swipeRefreshHeight?.();
}

// «Сеть сегодня»: /stats/daily (loadHome) и точка смены (loadMyDay) приходят
// независимо — рендер по готовности любого из двух.
let u3NetStats: StatsDailyRow[] | null = null;
let u3MyStoreId: string | null = null;
function u3RenderNet(): void {
  const boxes = document.querySelectorAll<HTMLElement>('.u3h-net');
  if (!boxes.length || !u3NetStats) return;
  const units = (s: any): number => ['sim', 'mnp', 'pa', 'combo'].reduce((a, k) => a + (Number(s[k]) || 0), 0);
  const list = u3NetStats.map((s: any) => ({ id: String(s.store_id), name: String(s.name || s.code || ''), u: units(s) })).sort((x, y) => y.u - x.u);
  const total = list.reduce((a, s) => a + s.u, 0);
  const sum = (k: string): number => u3NetStats!.reduce((a, s: any) => a + (Number(s[k]) || 0), 0);
  const idx = u3MyStoreId ? list.findIndex((s) => s.id === u3MyStoreId) : -1;
  const mineRow = idx >= 0 ? list[idx] : null;
  const share = mineRow && total > 0 ? mineRow.u / total : 0;
  const html =
    `<div class="u3h-g-head sub"><span>Сеть сегодня</span><span class="u3h-meta">${list.length} ${u3Plural(list.length, 'магазин', 'магазина', 'магазинов')}</span></div>` +
    `<div class="u3h-group has-tile">
      <div class="u3h-cell"><span class="u3h-tile neu">${u3Ic('chart')}</span>
        <span class="u3h-c-main"><span class="u3h-c-t">${u3Num(total)} ${u3Plural(total, 'продажа', 'продажи', 'продаж')} по сети</span><span class="u3h-c-s">SIM, MNP, ПА, Комбо</span></span></div>
      <div class="u3h-cell"><span class="u3h-tile neu">${u3Ic('bag')}</span>
        <span class="u3h-c-main"><span class="u3h-c-t">${esc(metricShort('phones'))} ${u3Num(sum('phones'))}, ${esc(metricShort('accessories'))} ${u3Num(sum('accessories'))} ₽</span><span class="u3h-c-s">телефоны и аксессуары за день</span></span></div>
      ${mineRow ? `<div class="u3h-cell"><span class="u3h-tile neu">${u3Ic('trophy')}</span>
        <span class="u3h-c-main"><span class="u3h-c-t">«${esc(mineRow.name)}» на ${idx + 1} месте из ${list.length}</span><span class="u3h-c-s">${Math.round(share * 100)}% продаж сети</span></span>
        ${u3Pie(share, 'ok', `${Math.round(share * 100)}% продаж сети`)}</div>` : ''}
    </div>`;
  boxes.forEach((el) => {
    el.innerHTML = html;
  });
  (document.getElementById('homeTodaySwipe') as any)?._swipeRefreshHeight?.();
}

/** Large title + подпись + слот hero + круглые быстрые действия (Revolut). */
function u3HomeTopHTML(firstName: string): string {
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const qa = (icon: string, label: string, attrs: string, pri = false): string =>
    `<button type="button" class="u3h-qa-btn" ${attrs}><span class="u3h-round${pri ? ' pri' : ''}">${u3Ic(icon)}</span>${label}</button>`;
  return `<div class="u3h u3h-top" hidden>
      <h2 class="u3h-large">${esc(greetingByHour())}, ${esc(firstName)}</h2>
      <p class="u3h-lede" id="u3hLede">${esc(date.charAt(0).toUpperCase() + date.slice(1))}</p>
      <div class="u3h-hero-slot" id="u3hHero"><section class="u3h-hero" aria-label="Продажи сегодня"><div class="u3h-hero-row"><span class="u3h-h-label">Продажи сегодня</span></div><p class="u3h-h-num">—</p><p class="u3h-h-sub">Загружаем день…</p></section></div>
      <div class="u3h-qa">
        ${qa('plus', 'Продажа', 'data-on="openAddSale" data-on-event="click"', true)}
        ${qa('chart', 'План', 'data-on="switchPage" data-on-event="click" data-arg="monthplan"')}
        ${qa('cash', 'Касса', 'data-on="switchPage" data-on-event="click" data-arg="cash"')}
        ${qa('calc', 'Комбо', 'data-on="openComboCalc" data-on-event="click"')}
      </div>
    </div>`;
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

    // Replacement shift (замена) — the store card becomes interactive:
    // "Сменить точку" while no shift is open (store not yet fixed), a
    // "Замена" badge once an open shift is in REPLACEMENT mode (store fixed
    // for the session, per the lifecycle rule — must close before switching).
    let currentSession: { work_mode?: string } | null = null;
    try {
      const cur = await window.apiClient.getShiftCurrent(authHeaders());
      currentSession = (cur.session as { work_mode?: string } | null) || null;
    } catch (_) { /* best-effort — card still renders without the badge/button */ }
    const isReplacementOpen = currentSession?.work_mode === 'REPLACEMENT';
    const canChangeStore = !currentSession; // no open shift at all — store not fixed yet

    const changeStoreButtonHtml = canChangeStore
      ? `<button class="btn-main" data-tutorial-id="academy-change-store-btn" style="margin-top:6px;padding:6px 12px;font-size:12px;width:auto" onclick="openChangeStoreModal()">Сменить точку</button>`
      : currentSession
        ? `<div style="margin-top:6px;font-size:11px;color:var(--hint)">Закройте смену, чтобы сменить точку</div>`
        : '';
    const replacementBadgeHtml = isReplacementOpen
      ? `<div style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:8px;background:var(--accent,#2AABEE);color:#fff;font-size:11px;font-weight:600">Замена · другая сеть</div>`
      : '';

    const headHtml = shift
      ? `<div style="padding:0 16px 10px">
                ${isReplacementOpen ? `<div style="font-size:11px;font-weight:700;color:var(--hint)">ТОЧКА ЗАМЕНЫ</div>` : ''}
                <div style="font-size:15px;font-weight:700">${esc(shift.store_code || shift.store_name || '')}</div>
                ${shift.store_address ? `<div style="font-size:12px;color:var(--hint);margin-top:2px">${esc(shift.store_address)}</div>` : ''}
                ${replacementBadgeHtml}
                ${changeStoreButtonHtml}
              </div>`
      : `<div style="padding:0 16px 10px">
                <div style="font-size:15px;font-weight:700">Выходной</div>
                ${changeStoreButtonHtml}
              </div>`;
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
                  <div class="row-title">${esc(shift.store_name || 'Точка')}</div>
                  <div class="row-sub">${esc(shift.shift_text || '')} · ${shift.hours || ''}ч</div>
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
            <button class="btn-main u3-legacy" style="margin-top:8px" onclick="openAddSale()">+ Продажа</button>
          </div>
          <div class="u3h u3h-day" hidden>
            ${u3DayRowsHTML(d)}
            <div class="u3h-feed"></div>
            <div class="u3h-net"></div>
          </div>
          ${myTasksHTML(d.tasks)}`;
    setBothHTML('myDayBody', 'myDayBodyDesktop', bodyHtml);
    // Beta: hero над быстрыми действиями + подпись «Гелиос, смена до 21:00».
    const heroSlot = document.getElementById('u3hHero');
    if (heroSlot) heroSlot.innerHTML = u3HeroHTML(d);
    const lede = document.getElementById('u3hLede');
    if (lede) {
      // Точка и «сменить» — прямо в подписи под приветствием (отдельная строка
      // точки в бете скрыта, см. ui3/home.css).
      const win = shift ? u3ShiftWindow(shift.shift_text) : null;
      const base = (lede.dataset.date ||= lede.textContent || '');
      const chipHtml = canChangeStore
        ? ` <button type="button" class="u3h-store-chip" data-on="openChangeStoreModal" data-on-event="click" data-tutorial-id="academy-change-store-btn" aria-label="Сменить точку">сменить →</button>`
        : '';
      const where = shift
        ? `, «${esc(shift.store_name || shift.store_code || 'точка')}»${isReplacementOpen ? ' (замена)' : ''}`
        : ', выходной';
      lede.innerHTML = `${esc(base)}${where}${win ? `, смена до ${u3Hm(win.end)}` : ''}${chipHtml}`;
    }
    u3MyStoreId = shift ? String(shift.store_id) : null;
    u3RenderNet();
    u3LoadFeed();
  } catch (e) {
    console.error(e);
    setBothHTML(
      'myDayBody',
      'myDayBodyDesktop',
      '<div class="empty" id="myDayLoadError"></div>'
    );
    ['myDayBody', 'myDayBodyDesktop'].forEach((id) => {
      const errorBox = document.getElementById(id);
      if (errorBox) {
        renderLoadError(errorBox, 'Не удалось загрузить «Мой день»', () => loadMyDay());
      }
    });
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
              : `<div class="empty-state" style="padding:14px 0 0">
                  <div class="es-icon" style="background:var(--success-soft);color:var(--success)"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></div>
                  <div class="es-title">Сеть в ритме</div>
                  <div class="es-sub">Критических просадок нет — все точки идут по плану</div>
                </div>`
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
    greetEl.innerHTML = `${u3HomeTopHTML(firstName)}
          <div class="greet-card u3-legacy">
            <div class="greet-shift-badge" id="greetShiftBadge" style="display:none"></div>
            <div class="greet-hi">${greetingByHour()}</div>
            <div class="greet-name">${esc(firstName)}</div>
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
    u3NetStats = list;
    u3RenderNet();
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
        <!-- "Пройти обучение" temporarily removed — Academy is disabled while
             the illustrated-story rework is iterated on, see
             app/core.ts's ACADEMY_ENABLED. -->
        <button class="btn-main" onclick="closeModal()">Закрыть</button>
      `;
  }
  if (typeof openModal === 'function') openModal();
  else document.getElementById('overlay')?.classList.add('show');
}

// ---------- Replacement shift: manual store-code entry ----------
// Minimal UI on the existing store card — no separate page, no
// marketplace. resolveStore() is a pure preview (no mutation); the actual
// authorization is re-checked by the backend at /shifts/open itself.
let pendingReplacementStore: SafeStoreInfo | null = null;
let pendingReplacementMode: 'NORMAL' | 'REPLACEMENT' | null = null;

export function openChangeStoreModal(): void {
  pendingReplacementStore = null;
  pendingReplacementMode = null;
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Сменить точку';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="field"><label>Код точки</label>
          <input type="text" id="changeStoreCode" inputmode="numeric" placeholder="888967" autofocus></div>
        <div id="changeStoreResult" style="margin:8px 0;font-size:13px"></div>
        <button type="button" class="btn-main" id="changeStoreCheckBtn" onclick="checkChangeStoreCode()">Проверить</button>
      `;
  }
  if (typeof openModal === 'function') openModal();
  else document.getElementById('overlay')?.classList.add('show');
}

export async function checkChangeStoreCode(): Promise<void> {
  const input = document.getElementById('changeStoreCode') as HTMLInputElement | null;
  const resultEl = document.getElementById('changeStoreResult');
  const code = (input?.value || '').trim();
  if (!code || !resultEl) return;
  resultEl.textContent = 'Проверяем…';
  try {
    const res = await window.apiClient.resolveStore(authHeaders(true), { code });
    if (!res.allowed || !res.store || !res.mode) {
      resultEl.innerHTML = `<div style="color:var(--danger)">${esc(res.message || 'Точка недоступна')}</div>`;
      pendingReplacementStore = null;
      pendingReplacementMode = null;
      return;
    }
    pendingReplacementStore = res.store;
    pendingReplacementMode = res.mode;
    const storeLine = `<div style="font-weight:600">${esc(res.store.code)} — ${esc(res.store.display_name || res.store.name)}</div>${res.store.address ? `<div style="color:var(--hint);font-size:12px">${esc(res.store.address)}</div>` : ''}`;
    const confirmLine = res.mode === 'REPLACEMENT'
      ? `<div style="margin-top:8px;padding:8px;border-radius:8px;background:var(--surface-2)">Вы войдёте в режиме замены.</div>`
      : '';
    resultEl.innerHTML = `${storeLine}${confirmLine}
        <button type="button" class="btn-main" style="margin-top:8px" onclick="confirmChangeStoreAndOpenShift()">Продолжить</button>`;
  } catch (e: any) {
    resultEl.innerHTML = `<div style="color:var(--danger)">${esc(e?.message || 'Ошибка проверки')}</div>`;
  }
}

export async function confirmChangeStoreAndOpenShift(): Promise<void> {
  if (!pendingReplacementStore) return;
  const resultEl = document.getElementById('changeStoreResult');
  try {
    await window.apiClient.openShift(authHeaders(true), {
      store_code: pendingReplacementStore.code,
      lat: null, lng: null, accuracy_m: null
    });
    pendingReplacementStore = null;
    pendingReplacementMode = null;
    if (typeof closeModal === 'function') closeModal();
    else document.getElementById('overlay')?.classList.remove('show');
    await loadMyDay();
    await loadGreetShiftAndDaysOff();
  } catch (e: any) {
    if (resultEl) resultEl.innerHTML = `<div style="color:var(--danger)">${esc(e?.message || 'Не удалось открыть смену')}</div>`;
  }
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
    openChangeStoreModal: typeof openChangeStoreModal;
    checkChangeStoreCode: typeof checkChangeStoreCode;
    confirmChangeStoreAndOpenShift: typeof confirmChangeStoreAndOpenShift;
  }
}
window.loadMyDay = loadMyDay;
window.completeMyTask = completeMyTask;
window.commandCenterTone = commandCenterTone;
window.loadCommandCenter = loadCommandCenter;
window.loadHome = loadHome;
window.bumpStreak = bumpStreak;
window.openAbout = openAbout;
window.openChangeStoreModal = openChangeStoreModal;
window.checkChangeStoreCode = checkChangeStoreCode;
window.confirmChangeStoreAndOpenShift = confirmChangeStoreAndOpenShift;
