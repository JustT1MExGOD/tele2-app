/**
 * 21.x (Frontend rewrite continuation, batch of 13, final file) — jsdom test
 * for frontend/js/08-access-supervisor.js → src/pages/access-supervisor.
 * Focused rather than exhaustive (batch migration) — covers the access gate
 * screens, the boot sequence branches (no-Telegram / 404-fallback / gated /
 * active), access-requests approve/reject, and the supervisor dashboard
 * render. bootApp() runs automatically on import (module-level side effect,
 * matching the classic script's own trailing call) — every test must stub
 * its dependencies BEFORE importing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { tgId?: number | null; role?: string } = {}) {
  document.body.innerHTML = `
    <div id="appSplash"></div>
    <div id="accessGate"></div><div id="gateBody"></div><div id="gateSubtitle"></div>
    <div class="sheet"></div><div class="app-header"></div><div class="bottom-nav"></div><div class="fab"></div>
    <div id="headerDate"></div>
    <button id="btnAccessRequests" style="display:none"></button>
    <button id="btnSupervisor" style="display:none"></button>
    <button id="btnMgrTutorial" style="display:none"></button>
    <div id="accessList"></div>
    <div id="supportSlaBox"></div>
    <div id="bottomNavMain"></div><div id="bottomNavSupervisor"></div><div id="svExitBtn"></div>
    <select id="svTrendDays"><option value="14" selected></option></select>
    <div id="svOverviewBody"></div><div id="svStoresBody"></div><div id="svPeopleBody"></div><div id="svTrendBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', null);
  vi.stubGlobal('tgUser', () => (overrides.tgId === null ? null : { id: overrides.tgId ?? 555, first_name: 'Иван', last_name: 'Петров', username: 'ivan' }));
  vi.stubGlobal('canAdmin', () => overrides.role === 'admin');
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('canApprove', () => overrides.role === 'manager' || overrides.role === 'admin' || overrides.role === 'supervisor');
  vi.stubGlobal('isSupervisor', () => overrides.role === 'supervisor');
  vi.stubGlobal('assignableRoles', (r: string) => (r === 'admin' ? ['employee', 'manager'] : []));
  vi.stubGlobal('roleLabel', (r: string) => r);
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('formatDateRu', (iso: string) => iso.split('-').reverse().join('.'));
  vi.stubGlobal('applyTheme', vi.fn());
  vi.stubGlobal('applyBranding', vi.fn().mockResolvedValue(undefined));
  vi.stubGlobal('maybeOfferTutorial', vi.fn());
  vi.stubGlobal('loadHome', vi.fn());
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('toggleMonthExtra', vi.fn());
  vi.stubGlobal('metricLabel', (id: string) => id.toUpperCase());
  vi.stubGlobal('METRICS', [
    { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
    { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'count' }
  ]);
  vi.stubGlobal('API', 'https://example.test');
  vi.stubGlobal('APP_VERSION', '21.4.0');

  const getMe = vi.fn().mockResolvedValue({ bound: true, employee_id: 1, full_name: 'Иван', role: overrides.role ?? 'employee' });
  const getAccessOrgs = vi.fn().mockResolvedValue([]);
  const getAccessDirectory = vi.fn().mockResolvedValue([]);
  const submitAccessRequest = vi.fn().mockResolvedValue({ ok: true, status: 'pending' });
  const getAccessRequests = vi.fn().mockResolvedValue([]);
  const approveAccessRequest = vi.fn().mockResolvedValue({ ok: true, employee_id: 5, role: 'employee' });
  const rejectAccessRequest = vi.fn().mockResolvedValue({ ok: true });
  const getSupportAdminTickets = vi.fn().mockResolvedValue({ items: [] });
  const getSupervisorDashboard = vi.fn().mockResolvedValue({ date: '2026-08-25', network: {}, stores: [], drops: [], trend: [], top_employees: [] });
  (window as any).apiClient = {
    getMe,
    getAccessOrgs,
    getAccessDirectory,
    submitAccessRequest,
    getAccessRequests,
    approveAccessRequest,
    rejectAccessRequest,
    getSupportAdminTickets,
    getSupervisorDashboard
  };
  return { getMe, getAccessOrgs, getAccessDirectory, submitAccessRequest, getAccessRequests, approveAccessRequest, rejectAccessRequest, getSupportAdminTickets, getSupervisorDashboard };
}

describe('Access gate/Supervisor (миграция frontend/js/08-access-supervisor.js → src/pages/access-supervisor)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('bootApp (вне Telegram): скрывает гейт, применяет брендинг, грузит главную', async () => {
    setupGlobals({ tgId: null });
    await import('../src/pages/access-supervisor/index.js');
    await new Promise((r) => setTimeout(r, 0));
    expect((document.getElementById('accessGate') as HTMLElement).style.display).toBe('none');
    expect((globalThis as any).applyBranding).toHaveBeenCalled();
    expect((globalThis as any).loadHome).toHaveBeenCalled();
  });

  it('bootApp (в Telegram, active) — открывает главную, показывает кнопки по правам admin', async () => {
    setupGlobals({ tgId: 555, role: 'admin' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ status: 'active', user: { employee_id: 1, role: 'admin', access_status: 'active' } })
      })
    );
    await import('../src/pages/access-supervisor/index.js');
    await new Promise((r) => setTimeout(r, 0));
    expect((document.getElementById('accessGate') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('btnSupervisor') as HTMLElement).style.display).toBe('');
    expect((globalThis as any).loadHome).toHaveBeenCalled();
    expect((globalThis as any).maybeOfferTutorial).toHaveBeenCalled();
  });

  it('bootApp (в Telegram, pending) — показывает access gate с "Ожидайте подтверждения"', async () => {
    setupGlobals({ tgId: 555 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ status: 'pending' }) }));
    await import('../src/pages/access-supervisor/index.js');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('gateBody')!.innerHTML).toContain('Ожидайте подтверждения');
    expect(document.getElementById('gateSubtitle')!.textContent).toBe('Заявка на проверке');
  });

  it('bootApp (в Telegram, rejected) — показывает "В доступе отказано"', async () => {
    setupGlobals({ tgId: 555 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ status: 'rejected' }) }));
    await import('../src/pages/access-supervisor/index.js');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('gateBody')!.innerHTML).toContain('В доступе отказано');
  });

  it('bootApp (404 на /access/status) — не блокирует, пускает через /me', async () => {
    const { getMe } = setupGlobals({ tgId: 555 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }));
    await import('../src/pages/access-supervisor/index.js');
    await new Promise((r) => setTimeout(r, 0));
    expect(getMe).toHaveBeenCalled();
    expect((document.getElementById('accessGate') as HTMLElement).style.display).toBe('none');
    expect((globalThis as any).loadHome).toHaveBeenCalled();
  });

  it('showAccessGate (none) — рендерит форму регистрации и грузит сети', async () => {
    const { getAccessOrgs } = setupGlobals({ tgId: null });
    const mod = await import('../src/pages/access-supervisor/index.js');
    mod.showAccessGate({ status: 'none' });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById('gateBody')!.innerHTML).toContain('Добро пожаловать');
    expect(getAccessOrgs).toHaveBeenCalled();
  });

  it('submitAccessRequest: короткое ФИО — toast err, API не вызывается', async () => {
    const { submitAccessRequest: apiSubmit } = setupGlobals({ tgId: null });
    document.body.innerHTML += '<input id="gateName" value="Ив"><select id="gateClaim"></select><select id="gateOrg"><option value="o1" selected></option></select><input id="gateMsg">';
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.submitAccessRequest();
    expect(apiSubmit).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажите ФИО', 'err');
  });

  it('submitAccessRequest: успех — отправляет заявку, показывает pending-гейт', async () => {
    const { submitAccessRequest: apiSubmit } = setupGlobals({ tgId: null });
    document.body.innerHTML += '<input id="gateName" value="Иванов Иван"><select id="gateClaim"><option value=""></option></select><select id="gateOrg"><option value="o1" selected></option></select><input id="gateMsg" value="точка">';
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.submitAccessRequest();
    expect(apiSubmit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ full_name: 'Иванов Иван', org_id: 'o1' }));
    expect(document.getElementById('gateBody')!.innerHTML).toContain('Ожидайте подтверждения');
  });

  it('loadAccessRequests: не manager/admin/supervisor — сообщение об отсутствии прав', async () => {
    setupGlobals({ tgId: null, role: 'employee' });
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.loadAccessRequests();
    expect(document.getElementById('accessList')!.textContent).toContain('Только manager / супервайзер');
  });

  it('loadAccessRequests → approveAccess: рендерит заявки, подтверждает выбранную роль', async () => {
    const { getAccessRequests, approveAccessRequest } = setupGlobals({ tgId: null, role: 'admin' });
    vi.stubGlobal('me', { employee_id: 1, role: 'admin' });
    getAccessRequests.mockResolvedValue([{ id: 9, telegram_id: 555, full_name: 'Пётр', message: 'точка А', status: 'pending', created_at: '' }]);
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.loadAccessRequests();
    expect(document.getElementById('accessList')!.innerHTML).toContain('Пётр');
    (document.getElementById('role_req_9') as HTMLSelectElement).value = 'manager';
    await mod.approveAccess(9);
    expect(approveAccessRequest).toHaveBeenCalledWith(expect.anything(), 9, { role: 'manager' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Доступ открыт', 'ok');
  });

  it('rejectAccess: отклоняет заявку и перезагружает список', async () => {
    const { rejectAccessRequest, getAccessRequests } = setupGlobals({ tgId: null, role: 'admin' });
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.rejectAccess(9);
    expect(rejectAccessRequest).toHaveBeenCalledWith(expect.anything(), 9);
    expect(getAccessRequests).toHaveBeenCalled();
  });

  it('enterSupervisorShell: переключает нижнюю навигацию, скрывает "Назад" для реального supervisor', async () => {
    const { getSupervisorDashboard } = setupGlobals({ tgId: null, role: 'supervisor' });
    const mod = await import('../src/pages/access-supervisor/index.js');
    mod.enterSupervisorShell();
    await new Promise((r) => setTimeout(r, 0));
    expect((document.getElementById('bottomNavMain') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('bottomNavSupervisor') as HTMLElement).style.display).toBe('flex');
    expect((document.getElementById('svExitBtn') as HTMLElement).style.display).toBe('none');
    expect(getSupervisorDashboard).toHaveBeenCalled();
  });

  it('exitSupervisorShell: возвращает основную навигацию и уходит на home', async () => {
    setupGlobals({ tgId: null });
    const mod = await import('../src/pages/access-supervisor/index.js');
    mod.exitSupervisorShell();
    expect((document.getElementById('bottomNavMain') as HTMLElement).style.display).toBe('flex');
    expect((globalThis as any).switchPage).toHaveBeenCalledWith('home');
  });

  it('loadSupervisorData: рендерит overview/stores/people/trend из одного ответа', async () => {
    const { getSupervisorDashboard } = setupGlobals({ tgId: null });
    getSupervisorDashboard.mockResolvedValue({
      date: '2026-08-25',
      network: { health: 80, overall_pct: 70, pace_delta: 5, stores_count: 2, staff_on_shift: 3, month: { metrics: {}, forecast: {} } },
      stores: [{ name: 'Точка А', today: { overall: 60, sim: 3, plan_sim: 5 }, staff: [{ name: 'Иван' }] }],
      drops: [{ severity: 'warn', store_name: 'Точка Б', message: 'Просадка' }],
      trend: [{ units: 5 }, { units: 8 }],
      top_employees: [{ full_name: 'Ольга', sim: 5, mnp: 1, pa: 0, score: 6 }]
    });
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.loadSupervisorData(true);
    expect(document.getElementById('svOverviewBody')!.innerHTML).toContain('80');
    expect(document.getElementById('svStoresBody')!.innerHTML).toContain('Точка А');
    expect(document.getElementById('svPeopleBody')!.innerHTML).toContain('Ольга');
    expect(document.getElementById('svTrendBody')!.innerHTML).toContain('svg');
  });

  it('loadSupervisorData: кэширует и не перезапрашивает без forceRefresh', async () => {
    const { getSupervisorDashboard } = setupGlobals({ tgId: null });
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.loadSupervisorData(true);
    getSupervisorDashboard.mockClear();
    await mod.loadSupervisorData(false);
    expect(getSupervisorDashboard).not.toHaveBeenCalled();
  });

  it('loadSupportSla: не-admin — no-op', async () => {
    const { getSupportAdminTickets } = setupGlobals({ tgId: null, role: 'manager' });
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.loadSupportSla();
    expect(getSupportAdminTickets).not.toHaveBeenCalled();
  });

  it('loadSupportSla: admin — рендерит SLA-строки с цветом по статусу', async () => {
    const { getSupportAdminTickets } = setupGlobals({ tgId: null, role: 'admin' });
    getSupportAdminTickets.mockResolvedValue({ items: [{ id: 1, full_name: 'Иван', sla_status: 'breached', sla_due_at: '2026-08-25T10:00' }] });
    const mod = await import('../src/pages/access-supervisor/index.js');
    await mod.loadSupportSla();
    expect(document.getElementById('supportSlaBox')!.innerHTML).toContain('Иван');
    expect(document.getElementById('supportSlaBox')!.innerHTML).toContain('#ff3b30');
  });

  it('window.* мост — все 13 функций', async () => {
    setupGlobals({ tgId: null });
    const mod = await import('../src/pages/access-supervisor/index.js');
    for (const name of [
      'bootApp',
      'showAccessGate',
      'onGateClaimChange',
      'submitAccessRequest',
      'loadSupportSla',
      'loadAccessRequests',
      'approveAccess',
      'rejectAccess',
      'enterSupervisorShell',
      'exitSupervisorShell',
      'loadSupervisorData',
      'svBarRowHTML',
      'svExtraToggleHTML'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
      expect((window as any)[name]).toBe((mod as any)[name]);
    }
  });
});
