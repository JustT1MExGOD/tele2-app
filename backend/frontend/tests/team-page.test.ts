/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/06-team-bfq.js → src/pages/team. Focused rather than exhaustive
 * (batch migration) — covers list render, the Дилер→Сектор→Сеть switcher,
 * employee card, and the CRUD state-changing actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="teamList"></div>
    <div id="managerTools"></div>
    <button id="btnSupportTickets"></button>
    <button id="btnNetworks"></button>
    <button id="btnAudit"></button>
    <div id="orgSwitcher"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee', org_id: 'org1' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('canAdmin', () => overrides.role === 'admin');
  vi.stubGlobal('canViewAnalytics', () => overrides.role === 'admin' || overrides.role === 'manager');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('roleLabel', (r: string) => ({ employee: 'Продавец', manager: 'Руководитель', admin: 'Администратор' })[r] || r);
  vi.stubGlobal('assignableRoles', (myRole: string) => (myRole === 'admin' ? ['employee', 'manager'] : []));
  vi.stubGlobal('applyAvatarImg', vi.fn());
  vi.stubGlobal('metricLabel', (id: string) => id.toUpperCase());
  vi.stubGlobal('progressHTML', (label: string, fact: unknown, plan: unknown) => `<div>${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('stores', []);
  vi.stubGlobal('employees', []);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  vi.stubGlobal('closeModal', vi.fn());
  (window as any).__stores = null;

  const getEmployees = vi.fn().mockResolvedValue([]);
  const getSales = vi.fn().mockResolvedValue([]);
  const getSchedules = vi.fn().mockResolvedValue([]);
  const getOrgsAdmin = vi.fn().mockResolvedValue([]);
  const zeroSaleMetric = vi.fn().mockResolvedValue({ ok: true });
  const setEmployeeRole = vi.fn().mockResolvedValue({ ok: true });
  const deactivateEmployee = vi.fn().mockResolvedValue({ ok: true });
  const createEmployee = vi.fn().mockResolvedValue({ id: 2 });
  const createStore = vi.fn().mockResolvedValue({ id: 's2' });
  (window as any).apiClient = {
    getEmployees,
    getSales,
    getSchedules,
    getOrgsAdmin,
    zeroSaleMetric,
    setEmployeeRole,
    deactivateEmployee,
    createEmployee,
    createStore
  };
  return { getEmployees, getSales, getSchedules, getOrgsAdmin, zeroSaleMetric, setEmployeeRole, deactivateEmployee, createEmployee, createStore };
}

describe('Команда (миграция frontend/js/06-team-bfq.js → src/pages/team)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadTeam: пусто — сообщение "В команде пока никого нет"', async () => {
    setupGlobals();
    const { loadTeam } = await import('../src/pages/team/index.js');
    await loadTeam();
    expect(document.getElementById('teamList')!.textContent).toContain('В команде пока никого нет');
  });

  it('loadTeam: рендерит сотрудников с продажами; manager видит кнопки роли/удаления', async () => {
    const { getEmployees, getSales } = setupGlobals({ role: 'manager' });
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    getSales.mockResolvedValue([{ id: 1, employee_id: 1, store_id: 's1', sale_date: '2026-08-25', full_name: 'Иван', store_name: 'A', sim: 3, phones: 1, combo: 0 }]);
    const { loadTeam } = await import('../src/pages/team/index.js');
    await loadTeam();
    const html = document.getElementById('teamList')!.innerHTML;
    expect(html).toContain('Иван');
    expect(html).toContain('SIM 3');
    expect(html).toContain('removeEmployee(1)');
  });

  it('loadTeam: не-manager — блок managerTools скрыт, кнопки удаления нет', async () => {
    const { getEmployees } = setupGlobals({ role: 'employee' });
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    const { loadTeam } = await import('../src/pages/team/index.js');
    await loadTeam();
    expect((document.getElementById('managerTools') as HTMLElement).style.display).toBe('none');
    expect(document.getElementById('teamList')!.innerHTML).not.toContain('removeEmployee');
  });

  it('renderOrgSwitcher: не-admin — скрыт', async () => {
    setupGlobals({ role: 'manager' });
    const { renderOrgSwitcher } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();
    expect((document.getElementById('orgSwitcher') as HTMLElement).style.display).toBe('none');
  });

  it('renderOrgSwitcher: admin — рендерит каскад Дилер/Сектор/Сеть, группируя по дилеру', async () => {
    const { getOrgsAdmin } = setupGlobals({ role: 'admin' });
    getOrgsAdmin.mockResolvedValue([
      { id: 'org1', name: 'Сеть А', dealer_name: 'ООО Ромашка', sector_id: 'north' },
      { id: 'org2', name: 'Сеть Б', dealer_name: 'ООО Ромашка', sector_id: 'south' }
    ]);
    const { renderOrgSwitcher } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();
    expect((document.getElementById('swDealer') as HTMLSelectElement).innerHTML).toContain('ООО Ромашка');
    expect((document.getElementById('swOrg') as HTMLSelectElement).innerHTML).toContain('Сеть А');
  });

  it('switchAdminOrg: сбрасывает stores/__stores и обновляет adminViewOrgId', async () => {
    const { getEmployees } = setupGlobals({ role: 'admin' });
    getEmployees.mockResolvedValue([]);
    (window as any).__stores = [{ id: 'old' }];
    (globalThis as any).stores = [{ id: 'old' }];
    const { switchAdminOrg } = await import('../src/pages/team/index.js');
    switchAdminOrg('org2');
    expect((globalThis as any).adminViewOrgId).toBe('org2');
    expect((window as any).__stores).toBeNull();
    expect((globalThis as any).stores).toEqual([]);
  });

  it('openEmployeeCard: рендерит смену/продажи, кнопка "Профиль" только с canViewAnalytics', async () => {
    const { getEmployees, getSales, getSchedules } = setupGlobals({ role: 'manager' });
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    getSales.mockResolvedValue([{ id: 5, employee_id: 1, store_id: 's1', sale_date: '2026-08-25', full_name: 'Иван', store_name: 'A', sim: 2 }]);
    getSchedules.mockResolvedValue([{ work_date: '2026-08-25', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А' }]);
    const { openEmployeeCard } = await import('../src/pages/team/index.js');
    await openEmployeeCard(1);
    expect(document.getElementById('modalTitle')!.textContent).toBe('Иван');
    const html = document.getElementById('modalBody')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('openEmployeeProfile(1)');
    expect(html).toContain('zeroSaleMetric(5,\'sim\',1)');
  });

  it('setRole: не-manage — no-op', async () => {
    const { setEmployeeRole } = setupGlobals({ role: 'employee' });
    const { setRole } = await import('../src/pages/team/index.js');
    await setRole(1, 'manager');
    expect(setEmployeeRole).not.toHaveBeenCalled();
  });

  it('setRole: manager — вызывает API, тостит, перезагружает список', async () => {
    const { setEmployeeRole, getEmployees } = setupGlobals({ role: 'manager' });
    const { setRole } = await import('../src/pages/team/index.js');
    await setRole(1, 'manager');
    expect(setEmployeeRole).toHaveBeenCalledWith(expect.anything(), 1, 'manager');
    expect(getEmployees).toHaveBeenCalled(); // loadTeam() re-fetch
  });

  it('removeEmployee: подтверждено — деактивирует и перезагружает', async () => {
    const { deactivateEmployee } = setupGlobals({ role: 'admin' });
    const { removeEmployee } = await import('../src/pages/team/index.js');
    await removeEmployee(1);
    expect(deactivateEmployee).toHaveBeenCalledWith(expect.anything(), 1);
    expect((globalThis as any).toast).toHaveBeenCalledWith('Удалён', 'ok');
  });

  it('saveNewEmployee: пустое ФИО — toast err', async () => {
    const { createEmployee } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="ne_name" value=""><select id="ne_role"><option value="employee" selected></option></select>';
    const { saveNewEmployee } = await import('../src/pages/team/index.js');
    await saveNewEmployee();
    expect(createEmployee).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажите ФИО', 'err');
  });

  it('saveNewEmployee: успех — создаёт, тостит, закрывает модалку', async () => {
    const { createEmployee } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="ne_name" value="Пётр"><select id="ne_role"><option value="employee" selected></option></select>';
    const { saveNewEmployee } = await import('../src/pages/team/index.js');
    await saveNewEmployee();
    expect(createEmployee).toHaveBeenCalledWith(expect.anything(), { full_name: 'Пётр', role: 'employee' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Сотрудник добавлен', 'ok');
  });

  it('toggle24hStore: включает — часы работы "круглосуточно", 24ч, поля задизейблены', async () => {
    setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="ns_24h" type="checkbox" checked><input id="ns_work_time" value="10-21"><input id="ns_hours" value="11">';
    const { toggle24hStore } = await import('../src/pages/team/index.js');
    toggle24hStore();
    expect((document.getElementById('ns_work_time') as HTMLInputElement).value).toBe('круглосуточно');
    expect((document.getElementById('ns_hours') as HTMLInputElement).value).toBe('24');
    expect((document.getElementById('ns_work_time') as HTMLInputElement).disabled).toBe(true);
  });

  it('saveNewStore: без id/названия — toast err', async () => {
    const { createStore } = setupGlobals({ role: 'manager' });
    document.body.innerHTML +=
      '<input id="ns_id" value=""><input id="ns_name" value=""><input id="ns_code" value=""><input id="ns_color" value=""><input id="ns_work_time" value=""><input id="ns_hours" value="11"><input id="ns_close_time" value="">';
    const { saveNewStore } = await import('../src/pages/team/index.js');
    await saveNewStore();
    expect(createStore).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('ID и название обязательны', 'err');
  });

  it('saveNewStore: успех — создаёт точку, сбрасывает кэш точек', async () => {
    const { createStore } = setupGlobals({ role: 'manager' });
    document.body.innerHTML +=
      '<input id="ns_id" value="lenina15"><input id="ns_name" value="Ленина 15"><input id="ns_code" value="123"><input id="ns_color" value="#fff"><input id="ns_work_time" value="10-21"><input id="ns_hours" value="11"><input id="ns_close_time" value="21:00">';
    (globalThis as any).stores = [{ id: 'old' }];
    (window as any).__stores = [{ id: 'old' }];
    const { saveNewStore } = await import('../src/pages/team/index.js');
    await saveNewStore();
    expect(createStore).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'lenina15', name: 'Ленина 15' }));
    expect((globalThis as any).stores).toEqual([]);
    expect((window as any).__stores).toBeNull();
  });

  it('window.* мост — все 14 функций', async () => {
    setupGlobals();
    await import('../src/pages/team/index.js');
    for (const name of [
      'renderOrgSwitcher',
      'switchAdminDealer',
      'switchAdminSector',
      'switchAdminOrg',
      'loadTeam',
      'openEmployeeCard',
      'zeroSaleMetric',
      'setRole',
      'removeEmployee',
      'openAddEmployee',
      'saveNewEmployee',
      'openAddStore',
      'toggle24hStore',
      'saveNewStore'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
