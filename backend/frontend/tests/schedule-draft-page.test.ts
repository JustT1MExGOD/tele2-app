/**
 * Автоматический генератор месячного графика (DRAFT -> APPLY) — jsdom-тест
 * для draft-секции src/pages/schedule/index.ts. См. план
 * synthetic-roaming-mountain, раздел Frontend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="monthLabel"></div>
    <div id="monthBoard"></div>
    <div id="summaryScheduleSection"></div>
    <div class="section" id="scheduleDraftSection" style="display:none">
      <select id="scheduleDraftMonthSelect"></select>
      <button id="scheduleDraftGenerateBtn"></button>
      <button id="scheduleDraftApplyBtn" style="display:none"></button>
      <div id="scheduleDraftErrors"></div>
      <div id="scheduleDraftSummary"></div>
    </div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'manager' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => overrides.role !== 'employee');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('scheduleMonth', '2026-08');
  vi.stubGlobal('stores', [{ id: 's1', name: 'Точка А', code: 'A' }]);
  vi.stubGlobal('employees', [{ id: 1, full_name: 'Иван' }]);
  vi.stubGlobal('fetchOrgStores', vi.fn().mockResolvedValue([{ id: 's1', name: 'Точка А', code: 'A' }]));
  vi.stubGlobal('storeColor', () => '#2aabee');
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('openModal', vi.fn());
  vi.stubGlobal('METRICS', []);

  const getStatsDaily = vi.fn().mockResolvedValue([]);
  const getSchedules = vi.fn().mockResolvedValue([]);
  const getPlansTemplate = vi.fn().mockResolvedValue([]);
  const getStoreDailyPlans = vi.fn().mockResolvedValue({ stores: [] });
  const getScheduleMonth = vi.fn().mockResolvedValue({ month: '2026-08', start: '', end: '', items: [] });
  const getEmployees = vi.fn().mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
  const saveSchedulesBulk = vi.fn().mockResolvedValue({ ok: true, count: 1, items: [] });
  const generateScheduleDraft = vi.fn().mockResolvedValue({
    draft_id: 42, month: '2026-08-01', status: 'draft', solver_status: 'feasible', blocking_errors: [], items: []
  });
  const getScheduleDraftById = vi.fn().mockResolvedValue({
    draft: { id: 42, org_id: 'o1', month: '2026-08-01', status: 'draft', input_fingerprint: 'x', blocking_errors: [], solver_status: 'feasible', editable_from_date: '2026-08-01', score: 1, generated_at: '', generated_by: null, applied_at: null, applied_by: null, replace_mode: null },
    items: [
      { id: 1, draft_id: 42, employee_id: '1', work_date: '2026-08-05', store_id: 's1', shift_text: '09:00-21:00', hours: 12, predicted_score: 1, explanation: { tier: 'store', historical_hours: 10, dayPreference: 0, fallback_used: true } }
    ]
  });
  const applyScheduleDraft = vi.fn().mockResolvedValue({
    draft: { id: 42, org_id: 'o1', month: '2026-08-01', status: 'applied', input_fingerprint: 'x', blocking_errors: [], solver_status: 'feasible', editable_from_date: '2026-08-01', score: 1, generated_at: '', generated_by: null, applied_at: '', applied_by: null, replace_mode: null },
    applied: true
  });
  const getStaffingRequirements = vi.fn().mockResolvedValue({ rows: [] });
  const saveStaffingRequirements = vi.fn().mockResolvedValue({ rows: [] });
  const getScheduleAvailability = vi.fn().mockResolvedValue({ rows: [] });
  const addScheduleAvailability = vi.fn().mockResolvedValue({ id: 1, org_id: 'o1', employee_id: 1, kind: 'vacation', specific_date: '2026-08-10', weekday: null, store_id: null, source: 'manual', created_at: '', created_by: null });
  const deleteScheduleAvailability = vi.fn().mockResolvedValue({ ok: true });

  (window as any).apiClient = {
    getStatsDaily, getSchedules, getPlansTemplate, getStoreDailyPlans, getScheduleMonth, getEmployees, saveSchedulesBulk,
    generateScheduleDraft, getScheduleDraftById, applyScheduleDraft,
    getStaffingRequirements, saveStaffingRequirements,
    getScheduleAvailability, addScheduleAvailability, deleteScheduleAvailability
  };
  return {
    getScheduleMonth, getEmployees, generateScheduleDraft, getScheduleDraftById, applyScheduleDraft,
    getStaffingRequirements, saveStaffingRequirements, getScheduleAvailability, addScheduleAvailability, deleteScheduleAvailability
  };
}

describe('Автоматический черновик графика (schedule-drafts)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('не-manager: секция черновика остаётся скрытой', async () => {
    setupGlobals({ role: 'employee' });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();
    expect((document.getElementById('scheduleDraftSection') as HTMLElement).style.display).toBe('none');
  });

  it('manager: секция черновика показывается, месяц предзаполнен', async () => {
    setupGlobals({ role: 'manager' });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();
    expect((document.getElementById('scheduleDraftSection') as HTMLElement).style.display).toBe('');
    const select = document.getElementById('scheduleDraftMonthSelect') as HTMLSelectElement;
    expect(select.options.length).toBe(2);
  });

  it('generateScheduleDraft: рассчитывает черновик и дозапрашивает GET :id (не сырые items из generate)', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    const { generateScheduleDraft } = await import('../src/pages/schedule/index.js');
    await generateScheduleDraft();
    expect(mocks.generateScheduleDraft).toHaveBeenCalled();
    expect(mocks.getScheduleDraftById).toHaveBeenCalledWith(expect.anything(), 42, '');
    const summary = document.getElementById('scheduleDraftSummary')!.innerHTML;
    expect(summary).toContain('Иван');
    expect(summary).toContain('Точка А');
  });

  it('generateScheduleDraft: блокирующие ошибки показываются в отдельной панели, кнопка "Применить" скрыта', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    mocks.getScheduleDraftById.mockResolvedValue({
      draft: { id: 42, org_id: 'o1', month: '2026-08-01', status: 'draft', input_fingerprint: 'x', blocking_errors: [{ message: 'На точке «Точка А» 2026-08-05 требуется 2 сотрудника, но доступен только 1' }], solver_status: 'infeasible', editable_from_date: '2026-08-01', score: null, generated_at: '', generated_by: null, applied_at: null, applied_by: null, replace_mode: null },
      items: []
    });
    const { generateScheduleDraft } = await import('../src/pages/schedule/index.js');
    await generateScheduleDraft();
    const errBox = document.getElementById('scheduleDraftErrors')!.innerHTML;
    expect(errBox).toContain('требуется 2 сотрудника');
    const applyBtn = document.getElementById('scheduleDraftApplyBtn') as HTMLElement;
    expect(applyBtn.style.display).toBe('none');
  });

  it('applyScheduleDraftAction: применяет черновик и предлагает рассчитать планы', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    const { generateScheduleDraft, applyScheduleDraftAction } = await import('../src/pages/schedule/index.js');
    await generateScheduleDraft();
    await applyScheduleDraftAction();
    expect(mocks.applyScheduleDraft).toHaveBeenCalledWith(expect.anything(), 42, {});
    expect((globalThis as any).toast).toHaveBeenCalledWith('График сохранён', 'ok');
  });

  it('applyScheduleDraftAction: требует второе подтверждение на замену существующих смен', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    mocks.applyScheduleDraft
      .mockResolvedValueOnce({
        draft: { id: 42, org_id: 'o1', month: '2026-08-01', status: 'draft', input_fingerprint: 'x', blocking_errors: [], solver_status: 'feasible', editable_from_date: '2026-08-01', score: 1, generated_at: '', generated_by: null, applied_at: null, applied_by: null, replace_mode: null },
        applied: false, requires_replace_confirmation: true, existing_editable_shifts: 7
      })
      .mockResolvedValueOnce({
        draft: { id: 42, org_id: 'o1', month: '2026-08-01', status: 'applied', input_fingerprint: 'x', blocking_errors: [], solver_status: 'feasible', editable_from_date: '2026-08-01', score: 1, generated_at: '', generated_by: null, applied_at: '', applied_by: null, replace_mode: 'replace' },
        applied: true
      });
    const { generateScheduleDraft, applyScheduleDraftAction } = await import('../src/pages/schedule/index.js');
    await generateScheduleDraft();
    await applyScheduleDraftAction();
    expect((globalThis as any).confirm).toHaveBeenCalledWith(expect.stringContaining('7 смен'));
    expect(mocks.applyScheduleDraft).toHaveBeenLastCalledWith(expect.anything(), 42, { replace: true });
  });

  it('applyScheduleDraftAction: устаревший черновик — код stale_draft показывает ошибку, не бросает исключение', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    mocks.applyScheduleDraft.mockRejectedValue(Object.assign(new Error('stale'), { code: 'stale_draft' }));
    const { generateScheduleDraft, applyScheduleDraftAction } = await import('../src/pages/schedule/index.js');
    await generateScheduleDraft();
    await applyScheduleDraftAction();
    expect((globalThis as any).toast).toHaveBeenCalledWith(expect.stringContaining('устарел'), 'err');
  });

  it('openStaffingEditor: рендерит редактор требований к покрытию по дням недели', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    mocks.getStaffingRequirements.mockResolvedValue({
      rows: [{ id: 1, org_id: 'o1', store_id: 's1', weekday: 0, specific_date: null, required_employees: 2, max_trainees: 1, created_at: '', updated_at: '' }]
    });
    const { openStaffingEditor } = await import('../src/pages/schedule/index.js');
    await openStaffingEditor();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
    const input = document.getElementById('staffReq_0') as HTMLInputElement;
    expect(input.value).toBe('2');
  });

  it('openAvailabilityEditor + addAvailabilityRow: добавляет отметку недоступности сотрудника', async () => {
    const mocks = setupGlobals({ role: 'manager' });
    const { openAvailabilityEditor, addAvailabilityRow } = await import('../src/pages/schedule/index.js');
    await openAvailabilityEditor();
    document.body.innerHTML += '';
    (document.getElementById('availDate') as HTMLInputElement).value = '2026-08-10';
    await addAvailabilityRow();
    expect(mocks.addScheduleAvailability).toHaveBeenCalledWith(
      expect.anything(), 1, expect.objectContaining({ kind: 'vacation', specific_date: '2026-08-10' })
    );
  });

  it('window.* мост — новые функции черновика графика', async () => {
    setupGlobals({ role: 'manager' });
    await import('../src/pages/schedule/index.js');
    for (const name of [
      'generateScheduleDraft', 'applyScheduleDraftAction',
      'openStaffingEditor', 'loadStaffingEditorRows', 'saveStaffingEditor',
      'openAvailabilityEditor', 'loadAvailabilityEditorRows', 'addAvailabilityRow', 'deleteAvailabilityRow'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
