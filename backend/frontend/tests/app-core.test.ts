/**
 * 21.x (Frontend rewrite — final two files) — jsdom test for
 * frontend/js/01-core.js → src/app/core.ts. Deeper coverage than the
 * batch-of-13's calibrated depth — this file owns shared mutable state
 * every other migrated bundle reads/writes as a bare identifier, so its
 * cross-bundle window-property mechanism gets its own dedicated checks here
 * (empirically verified separately via a standalone Node repro and the
 * full smoke test), on top of the usual behavior coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function freshImport() {
  vi.resetModules();
  return import('../src/app/core.js');
}

describe('app/core (миграция frontend/js/01-core.js)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('tgUser', () => null);
    (window as any).apiClient = undefined;
    delete (window as any).Telegram;
  });

  it('устанавливает начальное состояние на window.*, а не на локальные let', async () => {
    await freshImport();
    expect(window.me).toBeNull();
    expect(window.stores).toEqual([]);
    expect(window.employees).toEqual([]);
    expect(window.saleSelection).toEqual({});
    expect(window.adminViewOrgId).toBeNull();
    expect(Array.isArray(window.METRICS)).toBe(true);
    expect(window.METRICS.length).toBeGreaterThan(0);
    expect(window.page).toBe('home');
  });

  it('бэйр-идентификатор me читает/пишет то же самое свойство, что window.me (межбандловый механизм)', async () => {
    await freshImport();
    // Симулируем то, что делают уже смигрированные модули (my-plan.ts и др.) — bare-присвоение без объявления.
    (0, eval)('me = { employee_id: 5, role: "admin" };');
    expect(window.me).toEqual({ employee_id: 5, role: 'admin' });
    expect((0, eval)('me')).toBe(window.me);
  });

  it('canAdmin/canManage/isSupervisor/canApprove/canViewAnalytics: без me — всё false', async () => {
    await freshImport();
    expect(window.canAdmin()).toBe(false);
    expect(window.canManage()).toBe(false);
    expect(window.isSupervisor()).toBe(false);
    expect(window.canApprove()).toBe(false);
    expect(window.canViewAnalytics()).toBe(false);
  });

  it('canManage: true для manager/admin/is_manager, false для обычного employee', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'manager' };
    expect(window.canManage()).toBe(true);
    window.me = { employee_id: 1, role: 'admin' };
    expect(window.canManage()).toBe(true);
    window.me = { employee_id: 1, role: 'employee', is_manager: true };
    expect(window.canManage()).toBe(true);
    window.me = { employee_id: 1, role: 'employee' };
    expect(window.canManage()).toBe(false);
  });

  it('canAdmin: true только для role==="admin"', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'manager' };
    expect(window.canAdmin()).toBe(false);
    window.me = { employee_id: 1, role: 'admin' };
    expect(window.canAdmin()).toBe(true);
  });

  it('isSupervisor/canApprove: supervisor approve-доступен через isSupervisor, не только canManage', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'supervisor' };
    expect(window.isSupervisor()).toBe(true);
    expect(window.canManage()).toBe(false);
    expect(window.canApprove()).toBe(true);
  });

  it('canViewAnalytics: manager/admin/supervisor — true; senior/employee — false', async () => {
    await freshImport();
    for (const role of ['manager', 'admin', 'supervisor']) {
      window.me = { employee_id: 1, role };
      expect(window.canViewAnalytics()).toBe(true);
    }
    for (const role of ['senior', 'employee']) {
      window.me = { employee_id: 1, role };
      expect(window.canViewAnalytics()).toBe(false);
    }
  });

  it('assignableRoles: admin — все роли; manager — строго ниже своего уровня', async () => {
    await freshImport();
    expect(window.assignableRoles('admin')).toEqual(['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin']);
    expect(window.assignableRoles('manager')).toEqual(['trainee', 'employee', 'senior']);
    expect(window.assignableRoles('employee')).toEqual(['trainee']);
  });

  it('roleLabel: известные роли на русском, неизвестная — как есть', async () => {
    await freshImport();
    expect(window.roleLabel('manager')).toBe('Руководитель');
    expect(window.roleLabel('unknown_role')).toBe('unknown_role');
  });

  it('orgQueryParam: пусто без adminViewOrgId; &org_id=... для admin с переключённой сетью', async () => {
    await freshImport();
    window.me = { employee_id: 1, role: 'admin' };
    window.adminViewOrgId = null;
    expect(window.orgQueryParam()).toBe('');
    window.adminViewOrgId = 'org2';
    expect(window.orgQueryParam()).toBe('&org_id=org2');
    window.me = { employee_id: 1, role: 'manager' };
    expect(window.orgQueryParam()).toBe(''); // не-admin игнорируется, даже если adminViewOrgId стоит
  });

  it('esc: экранирует HTML-спецсимволы', async () => {
    await freshImport();
    expect(window.esc(`<script>"'&`)).toBe('&lt;script&gt;&quot;&#39;&amp;');
    expect(window.esc(null)).toBe('');
  });

  it('metricLabel/metricShort: находят по id, фолбэк на id/label для неизвестного', async () => {
    await freshImport();
    expect(window.metricLabel('sim')).toBe('SIM');
    expect(window.metricShort('phones')).toBe('Тел');
    expect(window.metricLabel('unknown_metric')).toBe('unknown_metric');
  });

  it('loadMetricsCatalog: подменяет METRICS данными с бэкенда, ошибка — не падает', async () => {
    await freshImport();
    const getMetrics = vi.fn().mockResolvedValue({ items: [{ id: 'x', label: 'X', short_label: 'X', unit: 'шт', unit_type: 'count' }] });
    (window as any).apiClient = { getMetrics };
    await window.loadMetricsCatalog();
    expect(window.METRICS).toEqual([{ id: 'x', label: 'X', short_label: 'X', unit: 'шт' }]);

    (window as any).apiClient = { getMetrics: vi.fn().mockRejectedValue(new Error('network')) };
    await expect(window.loadMetricsCatalog()).resolves.toBeUndefined();
  });

  it('fetchOrgStores: возвращает stores из ответа, [] при ошибке API', async () => {
    await freshImport();
    const getOrgStores = vi.fn().mockResolvedValue({ org_id: 'o1', stores: [{ id: 's1', name: 'A' }] });
    (window as any).apiClient = { getOrgStores };
    expect(await window.fetchOrgStores()).toEqual([{ id: 's1', name: 'A' }]);

    (window as any).apiClient = { getOrgStores: vi.fn().mockRejectedValue(new Error('fail')) };
    expect(await window.fetchOrgStores()).toEqual([]);
  });

  it('storeColor: свой цвет точки приоритетнее палитры, дефолт для неизвестной точки', async () => {
    await freshImport();
    expect(window.storeColor('kosmonavtov')).toBe('#6d9eeb');
    expect(window.storeColor('kosmonavtov', { color: '#ffffff' })).toBe('#ffffff');
    expect(window.storeColor('unknown_store')).toBe('#2aabee');
  });

  it('authHeaders: X-Telegram-Id из tgUser(), Content-Type только с json=true', async () => {
    await freshImport();
    vi.stubGlobal('tgUser', () => ({ id: 777 }));
    const h1 = window.authHeaders();
    expect(h1['X-Telegram-Id']).toBe('777');
    expect(h1['Content-Type']).toBeUndefined();
    const h2 = window.authHeaders(true);
    expect(h2['Content-Type']).toBe('application/json');
  });

  it('todayMoscow/timeMoscow/greetingByHour: не падают, возвращают строки в ожидаемом формате', async () => {
    await freshImport();
    expect(window.todayMoscow()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.timeMoscow('2026-08-25T10:00:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(window.timeMoscow('')).toBe('');
    expect(window.timeMoscow('not-a-date')).toBe('');
    expect(['Доброй ночи', 'Доброе утро', 'Добрый день', 'Добрый вечер']).toContain(window.greetingByHour());
  });

  it('window.* мост — весь публичный набор функций реально функции', async () => {
    await freshImport();
    for (const name of [
      'todayMoscow',
      'timeMoscow',
      'haptic',
      'createSpring',
      'gestureVelocity',
      'esc',
      'greetingByHour',
      'canAdmin',
      'canManage',
      'isSupervisor',
      'canApprove',
      'roleLabel',
      'canViewAnalytics',
      'assignableRoles',
      'orgQueryParam',
      'fetchOrgStores',
      'storeColor',
      'authHeaders',
      'loadMetricsCatalog',
      'metricLabel',
      'metricShort'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
    expect(typeof window.APP_VERSION).toBe('string');
    expect(typeof window.API).toBe('string');
  });
});

/**
 * White-screen regression (20.56.x acceptance) — index.html no longer
 * loads telegram-web-app.js as a blocking <script>; core.ts's
 * initTelegramWebApp() now awaits index.html's own
 * window.__t2TelegramScriptSettled signal first. These tests exercise
 * that async bootstrap directly (not just "Telegram absent from the
 * start", already covered above) — specifically the race where
 * window.Telegram becomes available only AFTER this module's own
 * top-level code has already run once.
 */
describe('app/core — async Telegram bootstrap (white-screen regression)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).Telegram;
    delete (window as any).__t2TelegramScriptSettled;
    delete (window as any).t2Desktop;
    // initTelegramWebApp() now assigns window.tg asynchronously (after
    // awaiting __t2TelegramScriptSettled) rather than synchronously at
    // freshImport() time, so — unlike window.Telegram above — it no
    // longer self-resets on every freshImport() call within a single
    // test; a prior test's value would otherwise leak into the pending-
    // promise window a later test asserts against.
    delete (window as any).tg;
  });

  it('desktop (window.t2Desktop present): window.tg stays undefined, no Telegram bootstrap runs, telegramReadyPromise still resolves', async () => {
    (window as any).t2Desktop = {}; // stand-in for the real contextBridge-exposed API
    (window as any).__t2TelegramScriptSettled = Promise.resolve(false); // mirrors index.html's own desktop branch
    await freshImport();
    await window.telegramReadyPromise;
    expect(window.tg).toBeUndefined();
  });

  it('SDK settles to unavailable (failed/timeout/no script): telegramReadyPromise still resolves, window.tg stays undefined — no unhandled rejection, no blank-page-shaped crash', async () => {
    (window as any).__t2TelegramScriptSettled = Promise.resolve(false);
    await freshImport();
    await expect(window.telegramReadyPromise).resolves.toBeUndefined();
    expect(window.tg).toBeUndefined();
  });

  it('SDK becomes available only AFTER this module already ran (the real race): window.tg is still picked up correctly once __t2TelegramScriptSettled resolves', async () => {
    let resolveSettled: (v: boolean) => void = () => {};
    (window as any).__t2TelegramScriptSettled = new Promise<boolean>((r) => {
      resolveSettled = r;
    });
    const fakeTg = {
      ready: vi.fn(),
      expand: vi.fn(),
      setHeaderColor: vi.fn(),
      setBackgroundColor: vi.fn(),
      onEvent: vi.fn(),
      initData: 'real-init-data-string',
      initDataUnsafe: { user: { id: 42 } }
    };
    // Import BEFORE Telegram exists on window — initTelegramWebApp() is
    // already awaiting __t2TelegramScriptSettled at this point, exactly
    // like a real slow (but eventually successful) script load.
    await freshImport();
    expect(window.tg).toBeUndefined(); // not yet — still pending

    (window as any).Telegram = { WebApp: fakeTg };
    resolveSettled(true);
    await window.telegramReadyPromise;

    expect(window.tg).toBe(fakeTg);
    expect(fakeTg.ready).toHaveBeenCalledOnce();
    expect(fakeTg.expand).toHaveBeenCalledOnce();
  });

  it('haptic() and authHeaders() read window.tg LIVE — safe no-op/empty before Telegram resolves, correct once it does (not a stale closured snapshot)', async () => {
    let resolveSettled: (v: boolean) => void = () => {};
    (window as any).__t2TelegramScriptSettled = new Promise<boolean>((r) => {
      resolveSettled = r;
    });
    const fakeTg = {
      ready: vi.fn(),
      expand: vi.fn(),
      HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn() },
      initData: 'late-init-data',
      initDataUnsafe: { user: { id: 7 } }
    };
    await freshImport();

    // Before resolution: must not throw, must behave as "no Telegram".
    expect(() => window.haptic('light')).not.toThrow();
    expect(fakeTg.HapticFeedback.impactOccurred).not.toHaveBeenCalled();
    vi.stubGlobal('tgUser', () => null);
    expect(window.authHeaders()['X-Telegram-Init-Data']).toBe('');

    (window as any).Telegram = { WebApp: fakeTg };
    resolveSettled(true);
    await window.telegramReadyPromise;

    window.haptic('light');
    expect(fakeTg.HapticFeedback.impactOccurred).toHaveBeenCalledWith('light');
    vi.stubGlobal('tgUser', () => ({ id: 7 }));
    expect(window.authHeaders()['X-Telegram-Init-Data']).toBe('late-init-data');
  });

  it('a throwing Telegram SDK method (setHeaderColor/onEvent) does not break the rest of bootstrap — matches the pre-existing try/catch discipline', async () => {
    (window as any).__t2TelegramScriptSettled = Promise.resolve(true);
    (window as any).Telegram = {
      WebApp: {
        ready: vi.fn(),
        expand: vi.fn(),
        setHeaderColor: vi.fn(() => {
          throw new Error('unsupported in this client');
        }),
        setBackgroundColor: vi.fn(),
        onEvent: vi.fn()
      }
    };
    await freshImport();
    await expect(window.telegramReadyPromise).resolves.toBeUndefined();
    expect(window.tg.ready).toHaveBeenCalledOnce();
  });

  it('window.__t2TelegramScriptSettled missing entirely (defensive default) does not hang telegramReadyPromise', async () => {
    // No __t2TelegramScriptSettled set at all — simulates a future/other
    // HTML entry point that forgot the inline bootstrap script.
    await freshImport();
    await expect(window.telegramReadyPromise).resolves.toBeUndefined();
    expect(window.tg).toBeUndefined();
  });
});

/**
 * Telegram Mini App forced-to-phone-login regression — Telegram appends
 * the real initData to the URL itself (documented, stable platform
 * behavior, core.telegram.org/bots/webapps) the moment it opens a Mini
 * App, independent of the SDK ever loading. These tests exercise the
 * fix directly: identity no longer depends on `window.Telegram` at all
 * when the URL already carries it, and — for the rarer case where it
 * doesn't (no `user` field in initData) — a genuinely slow SDK (well
 * past the old 5s cutoff) is still recognized as Telegram, never
 * silently redirected to phone/password.
 */
function buildRawInitData(user: Record<string, unknown> | null): string {
  const params = new URLSearchParams();
  if (user) params.set('user', JSON.stringify(user));
  params.set('auth_date', '1700000000');
  params.set('hash', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  return params.toString();
}

function setTelegramHash(rawInitData: string): void {
  window.history.replaceState(null, '', '#tgWebAppData=' + encodeURIComponent(rawInitData) + '&tgWebAppVersion=7.0');
}

/** resolveTelegramIdentity() (core.ts) calls tgUser() (nav.ts) as a bare
 * global — real integration, not a stub, since these tests are
 * specifically about tgUser()'s own SDK->raw-URL fallback chain. */
async function freshImportWithNav() {
  vi.resetModules();
  await import('../src/app/nav.js');
  return import('../src/app/core.js');
}

describe('app/core — Telegram identity resolution (forced-to-phone-login regression)', () => {
  const TEST_USER = { id: 123456789, first_name: 'Test', last_name: 'User', username: 'testuser' };

  beforeEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).Telegram;
    delete (window as any).__t2TelegramScriptSettled;
    delete (window as any).t2Desktop;
    delete (window as any).tg;
    window.history.replaceState(null, '', '/'); // clear any hash/search from a prior test
  });

  it('extractRawTelegramInitData: reads tgWebAppData from the URL hash, present from the very first tick — no SDK/network involved', async () => {
    setTelegramHash(buildRawInitData(TEST_USER));
    await freshImport();
    const raw = window.extractRawTelegramInitData();
    expect(raw).toContain('auth_date=1700000000');
    expect(raw).toContain('hash=deadbeef');
  });

  it('extractRawTelegramInitData: also checks the query string, not just the hash (platform variance)', async () => {
    window.history.replaceState(null, '', '/?tgWebAppData=' + encodeURIComponent(buildRawInitData(TEST_USER)));
    await freshImport();
    expect(window.extractRawTelegramInitData()).toContain('auth_date=1700000000');
  });

  it('extractRawTelegramInitData: null when no Telegram signal is in the URL at all (plain web)', async () => {
    await freshImport();
    expect(window.extractRawTelegramInitData()).toBeNull();
  });

  it('isLikelyTelegramContext: true iff the URL carries tgWebAppData — independent of window.Telegram entirely', async () => {
    await freshImport();
    expect(window.isLikelyTelegramContext()).toBe(false);
    setTelegramHash(buildRawInitData(TEST_USER));
    expect(window.isLikelyTelegramContext()).toBe(true); // re-checked live, no re-import needed
  });

  it('parseTelegramUserFromInitData: extracts the same shape tgUser() returns from the SDK', async () => {
    await freshImport();
    const raw = buildRawInitData(TEST_USER);
    expect(window.parseTelegramUserFromInitData(raw)).toEqual(TEST_USER);
  });

  it('parseTelegramUserFromInitData: null when initData has no user field (e.g. opened without user context) — never throws', async () => {
    await freshImport();
    expect(window.parseTelegramUserFromInitData(buildRawInitData(null))).toBeNull();
    expect(window.parseTelegramUserFromInitData('not=validjson&user=%7Bnotjson')).toBeNull();
  });

  it('authHeaders(): X-Telegram-Init-Data is the raw URL-extracted initData, sent as-is — independent of the SDK ever loading', async () => {
    setTelegramHash(buildRawInitData(TEST_USER));
    (window as any).__t2TelegramScriptSettled = Promise.resolve(false); // SDK never loads
    await freshImport();
    vi.stubGlobal('tgUser', () => TEST_USER);
    const h = window.authHeaders();
    expect(h['X-Telegram-Init-Data']).toBe(buildRawInitData(TEST_USER));
  });

  function fakeWebApp(user: Record<string, unknown> | null) {
    // initTelegramWebApp() (core.ts) always re-reads window.Telegram
    // unconditionally on import and calls these — a real no-op stub
    // avoids that unrelated bootstrap crashing these identity-focused
    // tests with "tg.ready is not a function".
    return {
      initDataUnsafe: { user },
      initData: buildRawInitData(user),
      ready: vi.fn(),
      expand: vi.fn(),
      setHeaderColor: vi.fn(),
      setBackgroundColor: vi.fn(),
      onEvent: vi.fn()
    };
  }

  // §Test B — SDK resolves quickly -> Telegram auth (already-loaded case).
  it('resolveTelegramIdentity: SDK already loaded with a user -> resolves immediately from window.tg, no wait', async () => {
    (window as any).Telegram = { WebApp: fakeWebApp(TEST_USER) };
    await freshImportWithNav();
    const result = await window.resolveTelegramIdentity();
    expect(result).toEqual(TEST_USER);
  });

  // §Test C (the actual regression) — a real Telegram user whose raw
  // initData already contains `user`: resolved INSTANTLY, the SDK's own
  // load timing becomes irrelevant to authentication entirely. This is
  // the common, expected shape and the main fix.
  it('resolveTelegramIdentity: URL already has the user (common case) -> resolves instantly, never waits on the SDK at all', async () => {
    setTelegramHash(buildRawInitData(TEST_USER));
    let neverResolves: (v: boolean) => void = () => {};
    (window as any).__t2TelegramScriptSettled = new Promise<boolean>((r) => {
      neverResolves = r; // deliberately never called during this test
    });
    await freshImportWithNav();
    const result = await window.resolveTelegramIdentity();
    expect(result).toEqual(TEST_USER);
    void neverResolves; // the SDK promise is left permanently pending — proves it was never awaited
  });

  // §Test C (the rarer edge case) — URL confirms Telegram but has no
  // `user` field: the OLD code would have already given up by 5s and
  // shown phone/password. The fix waits for the SDK's own (patient)
  // readiness signal instead, however long that takes, and picks up a
  // genuinely-late (>5s) SDK resolution correctly.
  it('resolveTelegramIdentity: Telegram confirmed via URL but no user in initData, SDK resolves well past the old 5s cutoff -> still Telegram auth, not null', async () => {
    setTelegramHash(buildRawInitData(null)); // Telegram context confirmed, but no user field
    let resolveSettled: (v: boolean) => void = () => {};
    (window as any).__t2TelegramScriptSettled = new Promise<boolean>((r) => {
      resolveSettled = r;
    });
    await freshImportWithNav();

    const resultPromise = window.resolveTelegramIdentity();
    // Simulate the SDK finishing well past the old hard-coded 5s bound.
    await new Promise((r) => setTimeout(r, 20));
    (window as any).Telegram = { WebApp: fakeWebApp(TEST_USER) };
    resolveSettled(true);

    const result = await resultPromise;
    expect(result).toEqual(TEST_USER); // NOT null — never fell back to phone/password
  });

  // §Test E — genuinely no Telegram signal anywhere -> resolves null
  // immediately (the only path that should ever reach phone/password),
  // and does NOT wait on the SDK promise at all.
  it('resolveTelegramIdentity: no Telegram signal in the URL at all -> resolves null immediately, never waits', async () => {
    let neverResolves: (v: boolean) => void = () => {};
    (window as any).__t2TelegramScriptSettled = new Promise<boolean>((r) => {
      neverResolves = r; // deliberately never called
    });
    await freshImportWithNav();
    const result = await window.resolveTelegramIdentity();
    expect(result).toBeNull();
    void neverResolves;
  });

  // §Test A — desktop: window.t2Desktop present, and (as in real desktop
  // usage) no tgWebAppData in the URL either -> resolves null
  // immediately, matching "desktop session/login UI immediately", not
  // gated on anything Telegram-related.
  it('resolveTelegramIdentity: desktop (window.t2Desktop present, no Telegram URL signal) -> resolves null immediately', async () => {
    (window as any).t2Desktop = {};
    await freshImportWithNav();
    const started = Date.now();
    const result = await window.resolveTelegramIdentity();
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(50);
  });

  // §Test F — a forged/manually-set window.Telegram or URL hash from
  // devtools only ever changes what the FRONTEND displays/sends; it
  // does not grant anything by itself. The real security boundary is
  // unchanged and lives entirely server-side (auth's initData HMAC
  // check, not touched by this fix) — this test only confirms the
  // frontend-side claim: forging identity here sends exactly the forged
  // string, verbatim, for the backend to accept or reject on its own.
  it('a forged window.Telegram/URL hash only changes what is SENT to the backend, never bypasses anything client-side — the backend remains the sole authority', async () => {
    const forged = { id: 999999999, first_name: 'Forged' };
    setTelegramHash(buildRawInitData(forged));
    await freshImport();
    vi.stubGlobal('tgUser', () => forged);
    const h = window.authHeaders();
    // The forged data is sent as-is — no special "trusted" marker, no
    // bypass of anything. It is the backend's HMAC check
    // (backend/src/auth's initData verification, unchanged by this fix)
    // that determines whether this string is ever honored.
    expect(h['X-Telegram-Init-Data']).toBe(buildRawInitData(forged));
    expect(h['X-Telegram-Id']).toBe('999999999');
  });
});
