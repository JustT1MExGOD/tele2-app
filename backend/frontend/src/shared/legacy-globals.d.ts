/**
 * 20.12.0 (Frontend rewrite kickoff) — ambient declarations for globals that
 * still live in frontend/js/*.js classic scripts. Migrated code reads these
 * directly (never reimplements their logic) — the legacy script is still
 * the single source of truth for session/auth/nav until it's migrated too;
 * duplicating the logic here would just create a second place for it to
 * drift out of sync.
 *
 * Safe because Vite's iife bundle wraps only ITS OWN declarations — reads
 * of outer bare identifiers still resolve to the classic scripts' shared
 * top-level `let`/`function` scope, same as every other legacy .js file,
 * as long as this bundle's <script> tag loads after 01-core.js/02-nav-utils.js
 * in index.html.
 */
export {};

declare global {
  /** Set by 01-core.js after GET /me, reassigned by 05-my-plan.js's
   * loadMyPlan()/bindMe() on every refresh/bind — null until bound/loaded. */
  let me: {
    employee_id: number | null;
    role: string | null;
    org_id?: string;
    full_name?: string | null;
    is_manager?: boolean;
    bound?: boolean;
    id?: number;
    telegram_id?: number | string | string[] | null;
  } | null;

  /** Set by 06-team-bfq.js's switchAdminOrg() — null unless admin switched
   * away from their own network via the org switcher. */
  let adminViewOrgId: string | null;

  function canManage(): boolean;
  function authHeaders(json?: boolean): Record<string, string>;
  function toast(msg: string, type?: string): void;
  function switchPage(name: string): void;
  /** '&org_id=...' if admin switched networks, '' otherwise — 01-core.js. */
  function orgQueryParam(): string;
  /** Shows the shared #overlay/#modalTitle/#modalBody modal — 07-add-sale.js. */
  function openModal(): void;
  /** Set by 02-nav-utils.js's switchPage() — current page name, e.g. 'alerts'. */
  const page: string;
  function esc(s: unknown): string;
  /** 03-home.js — health score (0-100) -> 'good'/'mid'/'bad' for the cc-health/tone CSS classes. */
  function commandCenterTone(health: number): string;
  /** 02-nav-utils.js — fact/plan progress bar row markup. */
  function progressHTML(label: string, fact: unknown, plan: unknown): string;
  /** 01-core.js — metric id -> display label, single source of truth. */
  function metricLabel(id: string): string;
  /** 01-core.js — role === 'admin' shorthand. */
  function canAdmin(): boolean;
  /** 01-core.js — org-scoped stores picker list, shared mutable cache. */
  let stores: any[];
  /** 01-core.js — (re)fetches `stores` from GET /org/stores. */
  function fetchOrgStores(): Promise<any[]>;
  /** 06b-plans-bfq.js — collapsible "show more" toggle for month-summary blocks. */
  function toggleMonthExtra(id: string, btn: HTMLElement | null, openLabel: string, closedLabel: string): void;
  /** 01-core.js — metric catalog cache, refreshed from GET /metrics. */
  function loadMetricsCatalog(): Promise<void>;
  /** 01-core.js — metric catalog, shared mutable cache read by METRICS-driven UI. */
  let METRICS: { id: string; label: string; short_label: string; unit: string }[];
  /** 07-add-sale.js — hides the shared #overlay/#modalTitle/#modalBody modal. */
  function closeModal(): void;
  /** 01-core.js — today's date (YYYY-MM-DD) in Europe/Moscow, the app's timezone of truth. */
  function todayMoscow(): string;
  /** 01-core.js — window.location.origin, base URL for raw fetch() calls that bypass window.apiClient. */
  const API: string;
  /** 02-nav-utils.js — Telegram WebApp initDataUnsafe.user, or null outside Telegram. */
  function tgUser(): { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } | null;
  /** 01-core.js — employees picker list for the current org, shared mutable cache. */
  let employees: any[];
  /** 01-core.js — { sim: 2, mnp: 1 } multi-select state for the add-sale/correct-sale modal. */
  let saleSelection: Record<string, number>;
  /** 01-core.js — mini physics spring for gesture animations (modal swipe-close). */
  function createSpring(opts: {
    from: number;
    velocity?: number;
    to: number;
    damping?: number;
    response?: number;
    onUpdate: (v: number) => void;
    onSettle?: () => void;
  }): { stop: () => void; getValue: () => number };
  /** 01-core.js — velocity (px/s) from a {x|y,t} point history, clamped to +-4000. */
  function gestureVelocity(history: { x?: number; y?: number; t: number }[], axis: 'x' | 'y'): number;
  /** 03-home.js — bumps/returns the daily-sale localStorage streak counter. */
  function bumpStreak(): number;
  /** 02-nav-utils.js — dispatches to the loadXxx() for the given page name, re-fetching its data. */
  function loadPage(name: string): void;
  /** 01-core.js — roles strictly below myRole assignable by the current user ('admin' -> all). */
  function assignableRoles(myRole: string): string[];
  /** 01-core.js — role id -> Russian display label. */
  function roleLabel(role: string): string;
  /** 02-nav-utils.js — paints a cached employee avatar image onto elementId, if one exists. */
  function applyAvatarImg(elementId: string, employeeId: number): void;
  /** 01-core.js — manager/admin/supervisor shorthand (Command Center + supervisor cabinet access). */
  function canViewAnalytics(): boolean;
  /** 01-core.js — metric id -> short_label (falls back to metricLabel()). */
  function metricShort(id: string): string;
  /** 02-nav-utils.js — 'YYYY-MM-DD' -> 'DD.MM.YYYY'. */
  function formatDateRu(iso: string): string;
  /** 01-core.js — time-of-day greeting text (Europe/Moscow). */
  function greetingByHour(): string;
  /** 01-core.js — hardcoded app version string shown in greeting/about. */
  const APP_VERSION: string;
  /** 02-nav-utils.js — wires up the swipeable-panels gesture on a container (idempotent, dataset-guarded). */
  function initSwipePanels(containerEl: HTMLElement | null): void;
  /** 01-core.js — Telegram WebApp haptic feedback, no-op outside Telegram. */
  function haptic(type?: string): void;
  /** 01-core.js — currently viewed month (YYYY-MM) on «График» (schedule). */
  let scheduleMonth: string;
  /** 01-core.js — currently viewed month (YYYY-MM) on «Планы» (plans/BFQ). */
  let planMonth: string;
  /** 04-schedule.js — 'YYYY-MM' -> Russian month name + year, e.g. 'Август 2026'. */
  function monthLabel(ym: string): string;
  /** 01-core.js — store's own color, or a fallback from the STORE_COLORS palette. */
  function storeColor(storeId: string, store?: { color?: string | null } | null): string;
  /** 08-access-supervisor.js — shared fact/plan bar-row markup (supervisor cabinet style). */
  function svBarRowHTML(label: string, fact: number, plan: number): string;
  /** 08-access-supervisor.js — "Ещё метрики" collapsible wrapper around a block of svBarRowHTML rows. */
  function svExtraToggleHTML(idPrefix: string, rowsHtml: string): string;
  /** 02-nav-utils.js — percent -> 'good'/'mid'/'bad' tone (progress/store-plan coloring). */
  function pctTone(p: number): string;
  /** 11-v13.js — loads shift session + insight + gamification blocks on «Мой план». */
  function loadShiftAndInsight(empId: number): Promise<void>;
  /** 01-core.js — formats a UTC ISO timestamp as HH:MM in Europe/Moscow, '' if invalid/empty. */
  function timeMoscow(iso: string | null | undefined): string;
  /** src/pages/my-plan — reloads the «Мой план» personal-cabinet page. */
  function loadMyPlan(): Promise<void>;
  /** src/pages/schedule — reloads the monthly schedule calendar. */
  function loadMonthSchedule(): Promise<void>;
  /** src/pages/shift — lightweight confetti burst, no external library. */
  function confettiBurst(): void;
  /** 01-core.js — role === 'supervisor' shorthand. */
  function isSupervisor(): boolean;
  /** src/pages/shift — opens the combo-price calculator modal. */
  function openComboCalc(): void;
  /** features/add-sale — opens the "Добавить продажу" modal, optionally preset to an employee. */
  function openAddSale(presetEmployeeId?: number | string): Promise<void>;
  /** 02-nav-utils.js — applies 'light'/'dark' theme to <body data-theme>. */
  function applyTheme(theme: string): void;
  /** 01-core.js — canManage() || isSupervisor(), approve-access shorthand. */
  function canApprove(): boolean;
  /** src/pages/home — loads the Главная page. */
  function loadHome(): Promise<void>;
  /** src/pages/network-admin — applies org branding (primary color, app title). */
  function applyBranding(): Promise<void>;
  /** features/tutorial — offers the first-run tutorial if not yet completed. */
  function maybeOfferTutorial(): void;
  /** frontend/offline-queue.js — separate standalone script, IndexedDB-backed sales retry queue. */
  const OfflineQueue:
    | {
        enqueueSale(payload: { store_id: string; employee_id: number; metrics: Record<string, number>; sale_date?: string; client_id?: string }): Promise<unknown>;
        flush(): Promise<unknown>;
        pendingCount(): Promise<number>;
        allOps(): Promise<unknown[]>;
      }
    | undefined;
}
