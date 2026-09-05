/**
 * 20.12.0 (Frontend rewrite kickoff) — ambient declarations bridging the two
 * "worlds": typed ES modules (this directory's siblings and everything in
 * frontend/src/{pages,features}/) read/write these bare identifiers exactly
 * as classic <script> files used to.
 *
 * Since 21.x (frontend rewrite, final two files) EVERY frontend/js/*.js file
 * is gone — app/core.ts and app/nav.ts are the real owners of everything
 * declared here now, same as every other entry already pointed at a typed
 * module. The bridge mechanism doesn't care who owns the runtime binding,
 * only that each bare identifier below actually resolves to something at
 * runtime: per ECMA-262 Global Environment Record semantics, an unqualified
 * identifier lookup checks BOTH the Declarative Record (what a classic
 * script's top-level `let` used to create) AND the Object Record (real
 * `window.*` properties) as one combined lookup — so app/core.ts assigning
 * `window.me = …` is exactly as visible to a bare `me` reference in any
 * other bundle as the old classic-script `let me` was. Every already-shipped
 * bundle's bare `me = …`/`stores = …` writes keep working unchanged for the
 * same reason: strict-mode code may freely assign to an identifier that
 * already resolves to an existing global property — it only forbids
 * *creating* a new implicit global via bare assignment, and app/core.ts
 * establishes all of these before any other bundle's script tag runs.
 *
 * Vite's iife bundle wraps only ITS OWN top-level declarations — none of
 * this leaks in the other direction, which is what makes per-page
 * independent builds safe in the first place.
 */
export {};

declare global {
  interface Window {
    /** Reassigned by app/nav.ts's switchPage() — current page name, e.g. 'alerts'. Bare `page` reads this same property. */
    page: string;
    /** app/core.ts — org-scoped stores picker list, shared mutable cache. Bare `stores` reads/writes this same property. */
    stores: any[];
    /** app/core.ts — employees picker list for the current org, shared mutable cache. Bare `employees` reads/writes this same property. */
    employees: any[];
    /** app/core.ts — { sim: 2, mnp: 1 } multi-select state for the add-sale/correct-sale modal. Bare `saleSelection` reads/writes this same property. */
    saleSelection: Record<string, number>;
    /** app/core.ts — currently viewed month (YYYY-MM) on «График» (schedule). Bare `scheduleMonth` reads/writes this same property. */
    scheduleMonth: string;
    /** app/core.ts — currently viewed month (YYYY-MM) on «Планы» (plans/BFQ). Bare `planMonth` reads/writes this same property. */
    planMonth: string;
    /** app/core.ts — metric catalog, shared mutable cache read by METRICS-driven UI. Bare `METRICS` reads/writes this same property. */
    METRICS: { id: string; label: string; short_label: string; unit: string }[];
    /** Set by app/core.ts after GET /me, reassigned by src/pages/my-plan's loadMyPlan()/bindMe() on every refresh/bind — null until bound/loaded. Bare `me` reads/writes this same property. */
    me: {
      employee_id: number | null;
      role: string | null;
      org_id?: string;
      full_name?: string | null;
      is_manager?: boolean;
      bound?: boolean;
      id?: number;
      telegram_id?: number | string | string[] | null;
    } | null;
    /** Set by src/pages/team's switchAdminOrg() — null unless admin switched away from their own network via the org switcher. Bare `adminViewOrgId` reads/writes this same property. */
    adminViewOrgId: string | null;
    /** app/core.ts — window.Telegram?.WebApp, or undefined outside Telegram. Loosely typed (the SDK isn't modeled here) — read via `window.tg?.X` casts elsewhere, same as before migration. */
    tg: any;
    /** app/core.ts's initTelegramWebApp() — resolves once window.tg has been assigned (either the real WebApp object, or left undefined) and any ready()/expand()/theme bootstrap has run. access-supervisor/index.ts's initial bootApp() call awaits this before reading Telegram identity, so a non-blocking (possibly still-in-flight) SDK load can't race a premature "not in Telegram" decision. */
    telegramReadyPromise: Promise<void>;
    /** index.html's inline bootstrap script — resolves true if the Telegram SDK script itself finished loading, false if skipped (desktop), failed, or timed out (bounded, 5s). Consumed only by app/core.ts's initTelegramWebApp(); nothing else should read this directly. */
    __t2TelegramScriptSettled?: Promise<boolean>;
    /** desktop/src/preload/index.ts's contextBridge — present ONLY inside the real packaged/dev Electron app (set before any page script runs); undefined in every browser/Telegram-webview context. Used purely by index.html's inline bootstrap script to skip an unreachable/unnecessary telegram.org fetch — never a security or auth boundary, and not modeled further here (the frontend never calls into it). */
    t2Desktop?: unknown;
  }

  /** Set by app/core.ts after GET /me, reassigned by src/pages/my-plan's
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
    /** Не-Telegram вход (20.36) — второй способ входа уже привязан. */
    phone?: string | null;
    /** 20.52.1 (Auth Assurance Hardening) — роль требует MFA, а
     * подтверждённого фактора нет вообще. */
    mfa_enrollment_required?: boolean;
    /** 20.53.0 — фактор есть, но этот channel-контекст (browser-сессия
     * или Telegram AAL2-грант) его ещё не подтверждал. */
    mfa_reverification_required?: boolean;
  } | null;

  /** Set by src/pages/team's switchAdminOrg() — null unless admin switched
   * away from their own network via the org switcher. */
  let adminViewOrgId: string | null;

  function canManage(): boolean;
  function authHeaders(json?: boolean): Record<string, string>;
  function toast(msg: string, type?: string): void;
  function switchPage(name: string): void;
  /** '&org_id=...' if admin switched networks, '' otherwise — app/core.ts. */
  function orgQueryParam(): string;
  /** Shows the shared #overlay/#modalTitle/#modalBody modal — features/add-sale. */
  function openModal(): void;
  /** Set by app/nav.ts's switchPage() — current page name, e.g. 'alerts'. */
  const page: string;
  function esc(s: unknown): string;
  /** src/pages/home — health score (0-100) -> 'good'/'mid'/'bad' for the cc-health/tone CSS classes. */
  function commandCenterTone(health: number): string;
  /** app/nav.ts — fact/plan progress bar row markup. */
  function progressHTML(label: string, fact: unknown, plan: unknown): string;
  /** app/core.ts — metric id -> display label, single source of truth. */
  function metricLabel(id: string): string;
  /** app/core.ts — role === 'admin' shorthand. */
  function canAdmin(): boolean;
  /** app/core.ts — org-scoped stores picker list, shared mutable cache. */
  let stores: any[];
  /** app/core.ts — (re)fetches `stores` from GET /org/stores. */
  function fetchOrgStores(): Promise<any[]>;
  /** src/pages/plans-bfq — collapsible "show more" toggle for month-summary blocks. */
  function toggleMonthExtra(id: string, btn: HTMLElement | null, openLabel: string, closedLabel: string): void;
  /** app/core.ts — metric catalog cache, refreshed from GET /metrics. */
  function loadMetricsCatalog(): Promise<void>;
  /** app/core.ts — metric catalog, shared mutable cache read by METRICS-driven UI. */
  let METRICS: { id: string; label: string; short_label: string; unit: string }[];
  /** features/add-sale — hides the shared #overlay/#modalTitle/#modalBody modal. */
  function closeModal(): void;
  /** app/core.ts — today's date (YYYY-MM-DD) in Europe/Moscow, the app's timezone of truth. */
  function todayMoscow(): string;
  /** app/core.ts — window.location.origin, base URL for raw fetch() calls that bypass window.apiClient. */
  const API: string;
  /** app/nav.ts — Telegram identity: the SDK's initDataUnsafe.user if
   * loaded, else parsed directly from the URL's raw initData (see
   * app/core.ts's extractRawTelegramInitData) — null outside Telegram. */
  function tgUser(): { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } | null;
  /** app/core.ts — the real initData Telegram appended to the URL when
   * opening this Mini App (hash fragment, query-string fallback), or
   * null if absent — present from the very first document load,
   * independent of whether telegram-web-app.js ever loads. Ready to
   * send to the backend as-is (same shape `Telegram.WebApp.initData`
   * exposes). */
  function extractRawTelegramInitData(): string | null;
  /** app/core.ts — true the instant the page loads if Telegram's own
   * client opened it (extractRawTelegramInitData() !== null) —
   * independent of SDK/network state. A UX signal only, never a
   * security boundary. */
  function isLikelyTelegramContext(): boolean;
  /** app/core.ts — parses the `user` field out of a raw initData string
   * (same shape tgUser() returns), without needing the SDK loaded. */
  function parseTelegramUserFromInitData(raw: string): { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } | null;
  /** app/core.ts — resolves Telegram identity without ever treating "SDK
   * hasn't loaded yet" as "not Telegram": instant if already resolvable,
   * waits only when Telegram context is independently confirmed via the
   * URL but the SDK hasn't caught up, null immediately for a genuine
   * non-Telegram web visitor. access-supervisor/index.ts's bootApp()
   * awaits this before deciding Telegram-vs-phone/password. */
  function resolveTelegramIdentity(): Promise<{ id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } | null>;
  /** app/core.ts — employees picker list for the current org, shared mutable cache. */
  let employees: any[];
  /** app/core.ts — { sim: 2, mnp: 1 } multi-select state for the add-sale/correct-sale modal. */
  let saleSelection: Record<string, number>;
  /** app/core.ts — mini physics spring for gesture animations (modal swipe-close). */
  function createSpring(opts: {
    from: number;
    velocity?: number;
    to: number;
    damping?: number;
    response?: number;
    onUpdate: (v: number) => void;
    onSettle?: () => void;
  }): { stop: () => void; getValue: () => number };
  /** app/core.ts — velocity (px/s) from a {x|y,t} point history, clamped to +-4000. */
  function gestureVelocity(history: { x?: number; y?: number; t: number }[], axis: 'x' | 'y'): number;
  /** src/pages/home — bumps/returns the daily-sale localStorage streak counter. */
  function bumpStreak(): number;
  /** app/nav.ts — dispatches to the loadXxx() for the given page name, re-fetching its data. */
  function loadPage(name: string): void;
  /** app/core.ts — roles strictly below myRole assignable by the current user ('admin' -> all). */
  function assignableRoles(myRole: string): string[];
  /** app/core.ts — role id -> Russian display label. */
  function roleLabel(role: string): string;
  /** app/nav.ts — paints a cached employee avatar image onto elementId, if one exists. */
  function applyAvatarImg(elementId: string, employeeId: number): void;
  /** app/core.ts — manager/admin/supervisor shorthand (Command Center + supervisor cabinet access). */
  function canViewAnalytics(): boolean;
  /** app/core.ts — metric id -> short_label (falls back to metricLabel()). */
  function metricShort(id: string): string;
  /** app/nav.ts — 'YYYY-MM-DD' -> 'DD.MM.YYYY'. */
  function formatDateRu(iso: string): string;
  /** app/core.ts — time-of-day greeting text (Europe/Moscow). */
  function greetingByHour(): string;
  /** app/core.ts — hardcoded app version string shown in greeting/about. */
  const APP_VERSION: string;
  /** app/nav.ts — wires up the swipeable-panels gesture on a container (idempotent, dataset-guarded). */
  function initSwipePanels(containerEl: HTMLElement | null): void;
  /** app/core.ts — Telegram WebApp haptic feedback, no-op outside Telegram. */
  function haptic(type?: string): void;
  /** app/core.ts — currently viewed month (YYYY-MM) on «График» (schedule). */
  let scheduleMonth: string;
  /** app/core.ts — currently viewed month (YYYY-MM) on «Планы» (plans/BFQ). */
  let planMonth: string;
  /** src/pages/schedule — 'YYYY-MM' -> Russian month name + year, e.g. 'Август 2026'. */
  function monthLabel(ym: string): string;
  /** app/core.ts — store's own color, or a fallback from the STORE_COLORS palette. */
  function storeColor(storeId: string, store?: { color?: string | null } | null): string;
  /** src/pages/access-supervisor — shared fact/plan bar-row markup (supervisor cabinet style). */
  function svBarRowHTML(label: string, fact: number, plan: number): string;
  /** src/pages/access-supervisor — "Ещё метрики" collapsible wrapper around a block of svBarRowHTML rows. */
  function svExtraToggleHTML(idPrefix: string, rowsHtml: string): string;
  /** app/nav.ts — percent -> 'good'/'mid'/'bad' tone (progress/store-plan coloring). */
  function pctTone(p: number): string;
  /** src/pages/shift — loads shift session + insight + gamification blocks on «Мой план». */
  function loadShiftAndInsight(empId: number): Promise<void>;
  /** app/core.ts — formats a UTC ISO timestamp as HH:MM in Europe/Moscow, '' if invalid/empty. */
  function timeMoscow(iso: string | null | undefined): string;
  /** src/pages/my-plan — reloads the «Мой план» personal-cabinet page. */
  function loadMyPlan(): Promise<void>;
  /** src/pages/schedule — reloads the monthly schedule calendar. */
  function loadMonthSchedule(): Promise<void>;
  /** src/pages/shift — lightweight confetti burst, no external library. */
  function confettiBurst(): void;
  /** app/core.ts — role === 'supervisor' shorthand. */
  function isSupervisor(): boolean;
  /** src/pages/shift — opens the combo-price calculator modal. */
  function openComboCalc(): void;
  /** features/add-sale — opens the "Добавить продажу" modal, optionally preset to an employee. */
  function openAddSale(presetEmployeeId?: number | string): Promise<void>;
  /** app/nav.ts — applies 'light'/'dark' theme to <body data-theme> AND persists it as the user's explicit choice. */
  function applyTheme(theme: string): void;
  /** app/nav.ts — applies saved/default theme immediately, then (only if the user has no explicit saved choice) follows Telegram's colorScheme. Call once from bootApp(). */
  function initTheme(): Promise<void>;
  /** app/core.ts — canManage() || isSupervisor(), approve-access shorthand. */
  function canApprove(): boolean;
  /** src/pages/home — loads the Главная page. */
  function loadHome(): Promise<void>;
  /** src/pages/network-admin — applies org branding (primary color, app title). */
  function applyBranding(): Promise<void>;
  /** features/tutorial — offers the first-run tutorial if not yet completed. */
  function maybeOfferTutorial(): void;
  /** src/pages/schedule — loads the "План дня" (all-stores today) page. */
  function loadPlanDay(): Promise<void>;
  /** src/pages/schedule — loads the "Сегодня" (today's schedule) page. */
  function loadTodaySchedule(): Promise<void>;
  /** src/pages/plans-bfq — loads the BFQ ranking list. */
  function loadBFQ(): Promise<void>;
  /** src/pages/team — loads the «Команда» roster. */
  function loadTeam(): Promise<void>;
  /** src/pages/support — loads the employee's own sales history (also reused by Профиль → «История продаж»). */
  function loadHistory(): Promise<void>;
  /** src/pages/plans-bfq — loads «Планы и факт за месяц» (per-employee grid). */
  function loadMonthPlans(): Promise<void>;
  /** src/pages/plans-bfq — loads «Сеть за месяц» (network-wide bar view). */
  function loadNetMonth(): Promise<void>;
  /** src/pages/network-admin — loads the store-hour heatmap for the selected store. */
  function loadHeatmap(): Promise<void>;
  /** src/pages/network-admin — loads the 7-day forecast for the selected store. */
  function loadForecast(): Promise<void>;
  /** src/pages/network-admin — loads staffing hints ("кого куда поставить"). */
  function loadStaffingHints(): Promise<void>;
  /** src/pages/network-admin — loads the announcements list. */
  function loadAnnouncements(): Promise<void>;
  /** src/pages/access-supervisor — loads admin support-ticket SLA summary. */
  function loadSupportSla(): Promise<void>;
  /** src/pages/support — loads FAQ + own/admin ticket lists. */
  function loadSupport(): Promise<void>;
  /** src/pages/cash-metrics — loads the cash (kassa) table. */
  function loadCash(): Promise<void>;
  /** src/pages/access-supervisor — loads pending access requests for approval. */
  function loadAccessRequests(): Promise<void>;
  /** src/pages/access-supervisor — loads/renders the supervisor dashboard (overview/stores/people/trend), cached unless forceRefresh. */
  function loadSupervisorData(forceRefresh?: boolean): Promise<void>;
  /** src/pages/shift — loads the live network map. */
  function loadLiveMap(): Promise<void>;
  /** src/pages/command-center — loads the Command Center page. */
  function loadCommandCenterPage(): Promise<void>;
  /** src/pages/tasks — bridges to router.ts's renderPage('tasks'). */
  function loadTasksPage(): void;
  /** src/pages/store-profile — bridges to router.ts's renderPage('store-profile'). */
  function renderStoreProfile(): void;
  /** src/pages/alerts — bridges to router.ts's renderPage('alerts'). */
  function loadAlertsPage(): void;
  /** src/pages/employee-profile — bridges to router.ts's renderPage('employee-profile'). */
  function renderEmployeeProfile(): void;
  /** src/pages/reports — bridges to router.ts's renderPage('reports'). */
  function loadReportsPage(): void;
  /** src/pages/network-admin — loads the org-admin (Сети) list. */
  function loadOrgsAdmin(): Promise<void>;
  /** src/pages/network-admin — loads the audit log. */
  function loadAuditLog(): Promise<void>;
  /** src/pages/dealers — loads the Дилеры/Секторы admin tree. */
  function loadDealersAdmin(): Promise<void>;
  /** src/pages/chat — bridges to router.ts's renderPage('chat'). */
  function loadChatPage(): void;
  /** src/pages/network-admin — (re)fetches the org-scoped store picker options into the various *Store selects, falling back to a hardcoded 3-store list if the network cache is empty. */
  function fillStoreSelects(): Promise<void>;
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
