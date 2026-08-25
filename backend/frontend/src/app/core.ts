/**
 * 21.x (Frontend rewrite — final two files) — replacing
 * frontend/js/01-core.js file-for-file: Telegram WebApp bootstrap, session/
 * role helpers, metric catalog, org-scoped store list, gesture-physics
 * primitives.
 *
 * The one file in this migration that OWNS shared mutable state every other
 * already-migrated module reads/writes as a bare identifier (`me`, `stores`,
 * `employees`, `saleSelection`, `scheduleMonth`, `planMonth`,
 * `adminViewOrgId`, `METRICS`) — per legacy-globals.d.ts's own header
 * comment, those bare reads/writes resolve through the JS global object
 * (ECMA-262 Global Environment Record: HasBinding/GetBindingValue checks the
 * Object Record — i.e. genuine `window.*` properties — same as the
 * Declarative Record a classic <script>'s top-level `let` used to occupy).
 * That's why every one of these is assigned via `window.x = ...` here, NEVER
 * as a local `let x` — a local declaration would shadow the global within
 * this bundle's own closure and become invisible to the other 19 already-
 * shipped bundles, which still do bare `me = …`/`stores = …` etc. Strict-
 * mode code (which is what all these Rollup-bundled modules are) may freely
 * assign to an identifier that already resolves to an existing global
 * property — it only forbids *creating* a new implicit global via bare
 * assignment — so as long as this module runs first (it does; index.html
 * loads it before every other bundle) and establishes these as real
 * `window` properties up front, every existing bare `me = x` in already-
 * shipped code keeps working completely unchanged.
 *
 * Every function (not state) uses the same `window.foo = foo` bridge as
 * every other migrated module — functions are only ever invoked from
 * outside, never bare-assigned to, so they don't have this hazard.
 */
import type { MetricsResponse } from '../../../src/shared/api-types.js';

window.tg = (window as any).Telegram?.WebApp;
const tg = window.tg;
if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor('#000000');
    tg.setBackgroundColor('#f2f2f7');
  } catch (_) {}

  // Некоторые клиенты Telegram рисуют «Закрыть»/дату/шеврон/меню плавающими
  // поверх контента, а не отдельной полосой — из-за этого наш .app-header
  // (аватар, тема, обновить) оказывался под ними. contentSafeAreaInset —
  // именно про это: отступ под плавающий чужой UI (safeAreaInset — отдельно
  // про вырез/статус-бар устройства).
  const applyTgSafeArea = () => {
    const top = (tg.safeAreaInset?.top || 0) + (tg.contentSafeAreaInset?.top || 0);
    // На <html> не годится: [data-theme="light|dark"] на <body> сам
    // объявляет этот токен (0px) — своё значение элемента всегда перебивает
    // унаследованное, экран .app-header внутри body так и не увидел бы наш
    // инлайн-стиль с html. Ставим прямо на body.
    document.body.style.setProperty('--tg-content-safe-top', top + 'px');
  };
  try {
    applyTgSafeArea();
    tg.onEvent('safeAreaChanged', applyTgSafeArea);
    tg.onEvent('contentSafeAreaChanged', applyTgSafeArea);
  } catch (_) {}
}

// Клиентская версия (О приложении + бейдж на главной)
const APP_VERSION = '15.0';
const API = window.location.origin;

export function todayMoscow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

// Бэкенд отдаёт timestamptz как UTC ISO-строку (например открытие смены в
// 9:55 МСК приходит как ...T06:55:00Z) — .slice(11,16) на сырой строке
// печатал бы UTC-время как есть. Форматируем явно в Europe/Moscow.
export function timeMoscow(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
}

export function haptic(type = 'light'): void {
  try {
    if (!tg?.HapticFeedback) return;
    if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
    else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
    else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
    else tg.HapticFeedback.impactOccurred('light');
  } catch (_) {}
}

// Мини-пружина для жестовых анимаций (свайп-закрытие модалки, свайп между
// панелями) — без внешней библиотеки. damping/response — те же параметры,
// что в apple-design skill (WWDC Designing Fluid Interfaces): damping 1.0 =
// критическое затухание без bounce (дефолт для UI), damping ~0.8-0.86 =
// лёгкий bounce (только когда жест уже нёс скорость). Ключевое отличие от
// CSS transition — value/velocity живут в JS, поэтому stop() можно вызвать в
// любой момент и продолжить новую пружину от текущего (не целевого)
// значения — это и даёт «перехватываемость» жеста на лету, а не рывок к
// началу при повторном хватании.
interface SpringOpts {
  from: number;
  velocity?: number;
  to: number;
  damping?: number;
  response?: number;
  onUpdate: (v: number) => void;
  onSettle?: () => void;
}

export function createSpring({ from, velocity = 0, to, damping = 1, response = 0.3, onUpdate, onSettle }: SpringOpts): { stop: () => void; getValue: () => number } {
  const omega = (2 * Math.PI) / response;
  const stiffness = omega * omega;
  const dampCoef = 2 * damping * omega;
  let value = from,
    vel = velocity,
    last = performance.now(),
    raf: number;
  function tick(now: number) {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    const accel = -stiffness * (value - to) - dampCoef * vel;
    vel += accel * dt;
    value += vel * dt;
    onUpdate(value);
    if (Math.abs(value - to) < 0.5 && Math.abs(vel) < 30) {
      onUpdate(to);
      if (onSettle) onSettle();
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(raf), getValue: () => value };
}

// Скорость жеста из истории точек {x|y, t}. dt < 5мс не считается надёжным
// (совпадающие таймстемпы бывают у синтетических событий и на некоторых
// WebView) — без этой защиты почти нулевой dt даёт огромную мнимую скорость
// и пружина улетает far за экран вместо мягкого сеттла.
export function gestureVelocity(history: { x?: number; y?: number; t: number }[], axis: 'x' | 'y'): number {
  if (history.length < 2) return 0;
  const first = history[0],
    last = history[history.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.005) return 0;
  const v = ((last[axis] as number) - (first[axis] as number)) / dt;
  const MAX = 4000; // px/s — быстрее реального пальца не бывает
  return Math.max(-MAX, Math.min(MAX, v));
}

// Экранирование пользовательского текста перед вставкой в innerHTML.
// full_name/comment/message приходят от других пользователей (заявки на
// доступ, тикеты, продажи) и не должны интерпретироваться как HTML.
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function greetingByHour(): string {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hour12: false
    }).format(new Date())
  );
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

// Общее состояние приложения — реальные global-object свойства (не bare
// let), см. комментарий вверху файла.
window.page = 'home';
window.employees = [];
window.stores = [];
window.saleSelection = {}; // { sim: 2, mnp: 1 } — мультивыбор метрик
window.scheduleMonth = todayMoscow().slice(0, 7);
window.planMonth = todayMoscow().slice(0, 7);
window.me = null; // { employee_id, full_name, role, is_manager }
// Какую сеть сейчас просматривает admin в «Команде» (null = своя сеть по умолчанию).
window.adminViewOrgId = null;

export function canAdmin(): boolean {
  const r = (window.me && window.me.role) || '';
  return r === 'admin';
}

/** manager + admin (и is_manager с /me) — правка планов, графика, кассы */
export function canManage(): boolean {
  if (!window.me) return false;
  return window.me.role === 'manager' || window.me.role === 'admin' || window.me.is_manager === true;
}
/** Срез аналитики по своим точкам (без полного manage) */
export function isSupervisor(): boolean {
  return window.me?.role === 'supervisor';
}
/** Approve заявок на доступ */
export function canApprove(): boolean {
  return canManage() || isSupervisor();
}

// Иерархия ролей — зеркало backend/src/middleware-auth.ts ROLE_LEVEL. senior
// входит в canManage() (через is_manager с /me), но НЕ должен видеть Command
// Center/кабинет супервайзера — для этого отдельная canViewAnalytics(), не
// связанная с is_manager.
const ROLE_LEVEL: Record<string, number> = { guest: -1, trainee: 0, employee: 1, senior: 2, manager: 3, supervisor: 4, admin: 5 };
const ROLE_ORDER = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
const ROLE_LABELS: Record<string, string> = {
  trainee: 'Стажёр',
  employee: 'Продавец',
  senior: 'Старший продавец',
  manager: 'Руководитель',
  supervisor: 'Супервайзер',
  admin: 'Администратор'
};
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role || 'Продавец';
}
/** Command Center и кабинет супервайзера — намеренно без senior. */
export function canViewAnalytics(): boolean {
  return window.me?.role === 'manager' || window.me?.role === 'admin' || window.me?.role === 'supervisor';
}
/** Роли, которые текущий пользователь может назначить (строго ниже своей; admin — все). */
export function assignableRoles(myRole: string): string[] {
  if (myRole === 'admin') return ROLE_ORDER;
  const myLevel = ROLE_LEVEL[myRole] ?? -1;
  return ROLE_ORDER.filter((r) => ROLE_LEVEL[r] < myLevel);
}
/** '&org_id=...' если admin переключился на другую сеть, иначе '' — добавлять к URL запроса. */
export function orgQueryParam(): string {
  return window.me?.role === 'admin' && window.adminViewOrgId ? '&org_id=' + encodeURIComponent(window.adminViewOrgId) : '';
}

/** Точки СВОЕЙ сети (или сети, которую смотрит admin через переключатель) —
 * единая точка входа для всех пикеров точек в приложении. В отличие от
 * /stores (намеренно кросс-сетевой — нужен планировщику/аналитике), сюда
 * никогда не попадают чужие точки. */
export async function fetchOrgStores(): Promise<any[]> {
  try {
    const { stores } = await window.apiClient.getOrgStores(authHeaders(), orgQueryParam());
    return stores || [];
  } catch (_) {}
  return [];
}

const STORE_COLORS: Record<string, string> = {
  kosmonavtov: '#6d9eeb',
  kalinina2: '#ff6d01',
  kalinina11: '#ffd966'
};

export function storeColor(storeId: string, store?: { color?: string | null } | null): string {
  if (store && store.color) return store.color;
  return STORE_COLORS[storeId] || '#2aabee';
}

export function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {
    'X-Telegram-Id': String(tgUser()?.id || ''),
    // Сырой initData — бэкенд проверяет его подпись (HMAC), только так
    // telegram_id можно доверять. Голый X-Telegram-Id легко подделать с
    // любого сайта (используется лишь как dev-фоллбэк на сервере).
    'X-Telegram-Init-Data': tg?.initData || ''
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// Единственный список меток метрик на фронтенде — держим в точности как
// FALLBACK в backend/src/core/shared/metrics-catalog.ts (бэкенд отдаёт то же
// самое через /metrics, если plan_metrics в БД пусто). Раньше почти каждый
// экран (главная, график, план, команда) держал свою копию с мелкими
// расхождениями — «Аксы» vs «Аксессуары», «Тел» vs «Телефоны» — и они
// расходились по мере правок. Теперь все экраны читают отсюда через
// metricLabel()/metricShort(), а не хранят свои строки.
window.METRICS = [
  { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'шт' },
  { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'шт' },
  { id: 'pa', label: 'ПА', short_label: 'ПА', unit: 'шт' },
  { id: 'combo', label: 'Комбо', short_label: 'Комбо', unit: 'шт' },
  { id: 'phones', label: 'Телефоны', short_label: 'Тел', unit: '₽' },
  { id: 'accessories', label: 'Аксессуары', short_label: 'Аксы', unit: '₽' },
  { id: 'settings', label: 'Настройки', short_label: 'Доп', unit: '₽' },
  { id: 'insurance', label: 'Страховки', short_label: 'Страх', unit: '₽' },
  { id: 'wink', label: 'Wink', short_label: 'Wink', unit: '₽' },
  { id: 'shpd', label: 'ШПД', short_label: 'ШПД', unit: 'шт' },
  { id: 'focus', label: 'ФО', short_label: 'ФО', unit: '₽' },
  { id: 'credit_request', label: 'Кредит заявка', short_label: 'Кр.з', unit: 'шт' },
  { id: 'credit_issued', label: 'Кредит выдан', short_label: 'Кр.в', unit: '₽' },
  { id: 'plotter', label: 'Плоттер', short_label: 'Плот', unit: 'шт' },
  { id: 'hb', label: 'НВ', short_label: 'НВ', unit: 'шт' }
];

export async function loadMetricsCatalog(): Promise<void> {
  try {
    const data: MetricsResponse = await window.apiClient.getMetrics(authHeaders());
    const items = data.items || [];
    if (items.length) {
      window.METRICS = items.map((m) => ({
        id: m.id,
        label: m.label || m.id,
        short_label: m.short_label || m.label || m.id,
        unit: m.unit || ((m as any).unit_type === 'money' ? '₽' : 'шт')
      }));
    }
  } catch (e) {
    console.warn('metrics', e);
  }
}

// Единая точка чтения метки метрики — вместо своей копии на каждом экране.
export function metricLabel(id: string): string {
  return window.METRICS.find((m) => m.id === id)?.label || id;
}
export function metricShort(id: string): string {
  return window.METRICS.find((m) => m.id === id)?.short_label || metricLabel(id);
}

// tgUser() и авторизация Telegram-идентичности физически определены в
// nav.ts (там же, где и были в 02-nav-utils.js) — authHeaders() выше
// ссылается на неё как на bare-глобал, тот же бридж, что уже использовали
// все остальные 19 мигрированных файлов при чтении функций друг друга.

declare global {
  interface Window {
    todayMoscow: typeof todayMoscow;
    timeMoscow: typeof timeMoscow;
    haptic: typeof haptic;
    createSpring: typeof createSpring;
    gestureVelocity: typeof gestureVelocity;
    esc: typeof esc;
    greetingByHour: typeof greetingByHour;
    canAdmin: typeof canAdmin;
    canManage: typeof canManage;
    isSupervisor: typeof isSupervisor;
    canApprove: typeof canApprove;
    roleLabel: typeof roleLabel;
    canViewAnalytics: typeof canViewAnalytics;
    assignableRoles: typeof assignableRoles;
    orgQueryParam: typeof orgQueryParam;
    fetchOrgStores: typeof fetchOrgStores;
    storeColor: typeof storeColor;
    authHeaders: typeof authHeaders;
    loadMetricsCatalog: typeof loadMetricsCatalog;
    metricLabel: typeof metricLabel;
    metricShort: typeof metricShort;
    APP_VERSION: string;
    API: string;
  }
}
window.todayMoscow = todayMoscow;
window.timeMoscow = timeMoscow;
window.haptic = haptic;
window.createSpring = createSpring;
window.gestureVelocity = gestureVelocity;
window.esc = esc;
window.greetingByHour = greetingByHour;
window.canAdmin = canAdmin;
window.canManage = canManage;
window.isSupervisor = isSupervisor;
window.canApprove = canApprove;
window.roleLabel = roleLabel;
window.canViewAnalytics = canViewAnalytics;
window.assignableRoles = assignableRoles;
window.orgQueryParam = orgQueryParam;
window.fetchOrgStores = fetchOrgStores;
window.storeColor = storeColor;
window.authHeaders = authHeaders;
window.loadMetricsCatalog = loadMetricsCatalog;
window.metricLabel = metricLabel;
window.metricShort = metricShort;
window.APP_VERSION = APP_VERSION;
window.API = API;
