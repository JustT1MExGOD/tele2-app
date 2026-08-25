/**
 * 21.x (Frontend rewrite continuation, batch of 11) — jsdom render test for
 * frontend/js/14-command-center.js → src/pages/command-center. Focused
 * coverage, matching the batch's calibrated depth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { role?: string; page?: string } = {}) {
  document.body.innerHTML = `
    <div id="ccPageBody"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'manager' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('page', overrides.page ?? 'command-center');
  vi.stubGlobal('canAdmin', () => overrides.role === 'admin');
  vi.stubGlobal('commandCenterTone', (h: number) => (h >= 75 ? 'good' : h >= 45 ? 'mid' : 'bad'));
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });

  const getCommandCenter = vi.fn();
  const changeAlertStatus = vi.fn().mockResolvedValue({ ok: true });
  const getEmployees = vi.fn().mockResolvedValue([{ id: 1, full_name: 'Иван' }]);
  const createTask = vi.fn().mockResolvedValue({ id: 1 });
  (window as any).apiClient = { getCommandCenter, changeAlertStatus, getEmployees, createTask };
  return { getCommandCenter, changeAlertStatus, getEmployees, createTask };
}

const RESPONSE = {
  date: '2026-08-25',
  network: { health: 80, overall_pct: 70, staff_on_shift: 12, stores_count: 3, pace_delta: 5 },
  stores: [{ name: 'Точка А', color: '#123', today: { overall: 90, sim: 5, plan_sim: 10 }, staff_count: 2 }],
  problems: [
    {
      severity: 'critical', message: 'Просадка по MNP', store_name: 'Точка Б', ai_comment: 'Обычно растёт после 16',
      alert_id: 9, actions: [{ type: 'create_task', store_id: 's1', message: 'Проверить MNP' }]
    }
  ],
  underperforming_count: 0, alerts_count: 1, generated_at: '2026-08-25T10:00:00Z'
};

describe('Command Center (миграция frontend/js/14-command-center.js → src/pages/command-center)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadCommandCenterPage: рендерит health/точки/проблемы, actions и "Взять в работу" по alert_id', async () => {
    const { getCommandCenter } = setupGlobals({ role: 'manager' });
    getCommandCenter.mockResolvedValue(RESPONSE);
    const { loadCommandCenterPage } = await import('../src/pages/command-center/index.js');
    await loadCommandCenterPage();

    const html = document.getElementById('ccPageBody')!.innerHTML;
    expect(html).toContain('cc-health good">80');
    expect(html).toContain('Точка А');
    expect(html).toContain('Просадка по MNP');
    expect(html).toContain('Обычно растёт после 16');
    expect(html).toContain('ccAckAlert(9)');
    expect(html).toContain('openCreateTaskModal(');
  });

  it('loadCommandCenterPage: без проблем — "сеть в ритме"', async () => {
    const { getCommandCenter } = setupGlobals();
    getCommandCenter.mockResolvedValue({ ...RESPONSE, problems: [] });
    const { loadCommandCenterPage } = await import('../src/pages/command-center/index.js');
    await loadCommandCenterPage();
    expect(document.getElementById('ccPageBody')!.textContent).toContain('сеть в ритме');
  });

  it('loadCommandCenterPage: manager без прав — блок "Полная аналитика сектора" не показан; admin — показан', async () => {
    const { getCommandCenter } = setupGlobals({ role: 'manager' });
    getCommandCenter.mockResolvedValue(RESPONSE);
    const { loadCommandCenterPage } = await import('../src/pages/command-center/index.js');
    await loadCommandCenterPage();
    expect(document.getElementById('ccPageBody')!.innerHTML).not.toContain('enterSupervisorShell');

    const { getCommandCenter: g2 } = setupGlobals({ role: 'admin' });
    g2.mockResolvedValue(RESPONSE);
    const mod2 = await import('../src/pages/command-center/index.js');
    await mod2.loadCommandCenterPage();
    expect(document.getElementById('ccPageBody')!.innerHTML).toContain('enterSupervisorShell');
  });

  it('loadCommandCenterPage: ошибка API — не падает', async () => {
    const { getCommandCenter } = setupGlobals();
    getCommandCenter.mockRejectedValue(new Error('network'));
    const { loadCommandCenterPage } = await import('../src/pages/command-center/index.js');
    await loadCommandCenterPage();
    expect(document.getElementById('ccPageBody')!.textContent).toContain('недоступен');
  });

  it('ccAckAlert: успех — тостит и перезагружает страницу', async () => {
    const { changeAlertStatus, getCommandCenter } = setupGlobals();
    getCommandCenter.mockResolvedValue(RESPONSE);
    const { ccAckAlert } = await import('../src/pages/command-center/index.js');
    await ccAckAlert(9);
    expect(changeAlertStatus).toHaveBeenCalledWith(expect.anything(), 9, { status: 'in_progress' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Взято в работу', 'ok');
    expect(getCommandCenter).toHaveBeenCalled();
  });

  it('ccActionButton: три типа действия рендерятся корректно, неизвестный тип — пустая строка', async () => {
    setupGlobals();
    const { ccActionButton } = await import('../src/pages/command-center/index.js');
    expect(ccActionButton({ type: 'open_employee', id: 5 } as any)).toContain('openEmployeeProfile(5)');
    expect(ccActionButton({ type: 'open_store', id: 's1' } as any)).toContain("openStoreProfile('s1')");
    expect(ccActionButton({ type: 'create_task', message: 'X' } as any)).toContain('openCreateTaskModal(');
    expect(ccActionButton({ type: 'unknown' } as any)).toBe('');
  });

  it('openCreateTaskModal: открывает форму с предзаполненным title и списком сотрудников', async () => {
    const { getEmployees } = setupGlobals();
    const { openCreateTaskModal } = await import('../src/pages/command-center/index.js');
    await openCreateTaskModal({ title: 'Проверить остатки', employee_id: 1 });
    expect(getEmployees).toHaveBeenCalled();
    const html = document.getElementById('modalBody')!.innerHTML;
    expect(html).toContain('Проверить остатки');
    expect(html).toContain('Иван');
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
  });

  it('submitCreateTask: без title/assignee — toast err, API не вызывается', async () => {
    const { createTask } = setupGlobals();
    document.body.innerHTML += '<input id="taskTitle" value=""><select id="taskAssignee"></select>';
    const { submitCreateTask } = await import('../src/pages/command-center/index.js');
    await submitCreateTask({});
    expect(createTask).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажи, что сделать и кому', 'err');
  });

  it('submitCreateTask: успех — создаёт задачу, закрывает модалку, тостит', async () => {
    const { createTask } = setupGlobals({ page: 'command-center' });
    document.body.innerHTML +=
      '<input id="taskTitle" value="Проверить"><select id="taskAssignee"><option value="1" selected></option></select><select id="taskPriority"><option value="normal" selected></option></select><input id="taskDueAt" value="">';
    const { submitCreateTask } = await import('../src/pages/command-center/index.js');
    await submitCreateTask({ store_id: 's1' });
    expect(createTask).toHaveBeenCalled();
    expect((globalThis as any).closeModal).toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Задача создана', 'ok');
  });

  it('window.* мост — loadCommandCenterPage/ccAckAlert/openCreateTaskModal/submitCreateTask', async () => {
    setupGlobals();
    await import('../src/pages/command-center/index.js');
    for (const name of ['loadCommandCenterPage', 'ccAckAlert', 'openCreateTaskModal', 'submitCreateTask']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
