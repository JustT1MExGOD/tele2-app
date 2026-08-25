/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/06b-plans-bfq.js → src/pages/plans-bfq. Focused rather than
 * exhaustive (batch migration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="bfqList"></div>
    <div id="monthPlanList"></div>
    <div id="monthPlanMeta"></div>
    <div id="planMonthLabel"></div>
    <div id="netMonthBody"></div>
    <div id="netMonthLabel"></div>
    <div id="storeDailyPlans"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('scheduleMonth', '2026-08');
  vi.stubGlobal('planMonth', '2026-08');
  vi.stubGlobal('monthLabel', (ym: string) => 'Август 2026');
  vi.stubGlobal('storeColor', () => '#2aabee');
  vi.stubGlobal('svBarRowHTML', (label: string, fact: number, plan: number) => `<div class="bar">${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('svExtraToggleHTML', (idPrefix: string, rows: string) => `<div class="extra" id="${idPrefix}">${rows}</div>`);
  vi.stubGlobal('roleLabel', (r: string) => r);
  vi.stubGlobal('progressHTML', (label: string, fact: unknown, plan: unknown) => `<div>${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('loadMetricsCatalog', vi.fn().mockResolvedValue(undefined));
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('METRICS', [
    { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
    { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'count' }
  ]);

  const getBfqList = vi.fn().mockResolvedValue({ month: '2026-08', items: [] });
  const getBfqEmployee = vi.fn().mockResolvedValue({ fact: {}, forecast: {}, shifts: { worked: 0, remaining: 0 } });
  const saveBfqManual = vi.fn().mockResolvedValue({ ok: true });
  const getPlansEmployeesMonth = vi.fn().mockResolvedValue({ rows: [], remaining_days: 5 });
  const getEmployeeMonthPlan = vi.fn().mockResolvedValue({});
  const saveEmployeeMonthPlan = vi.fn().mockResolvedValue({});
  const getStoreDailyPlans = vi.fn().mockResolvedValue({ stores: [] });
  const getStoreMonthPlan = vi.fn().mockResolvedValue({});
  const saveStoreMonthPlan = vi.fn().mockResolvedValue({});
  (window as any).apiClient = {
    getBfqList,
    getBfqEmployee,
    saveBfqManual,
    getPlansEmployeesMonth,
    getEmployeeMonthPlan,
    saveEmployeeMonthPlan,
    getStoreDailyPlans,
    getStoreMonthPlan,
    saveStoreMonthPlan
  };
  return { getBfqList, getBfqEmployee, saveBfqManual, getPlansEmployeesMonth, getEmployeeMonthPlan, saveEmployeeMonthPlan, getStoreDailyPlans, getStoreMonthPlan, saveStoreMonthPlan };
}

describe('Планы/BFQ (миграция frontend/js/06b-plans-bfq.js → src/pages/plans-bfq)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadBFQ: пусто — "Нет данных BFQ"', async () => {
    setupGlobals();
    const { loadBFQ } = await import('../src/pages/plans-bfq/index.js');
    await loadBFQ();
    expect(document.getElementById('bfqList')!.textContent).toContain('Нет данных BFQ');
  });

  it('loadBFQ: список — рендерит строки с рейтингом', async () => {
    const { getBfqList } = setupGlobals();
    getBfqList.mockResolvedValue({ month: '2026-08', items: [{ employee_id: 1, full_name: 'Иван', total: 80, quality: 90, profit: 70, vmr: 12 }] });
    const { loadBFQ } = await import('../src/pages/plans-bfq/index.js');
    await loadBFQ();
    const html = document.getElementById('bfqList')!.innerHTML;
    expect(html).toContain('Иван');
    expect(html).toContain('openBFQCard(1)');
  });

  it('openBFQCard: manager видит форму ручного ввода VMR/штрафа', async () => {
    setupGlobals({ role: 'manager' });
    const { openBFQCard } = await import('../src/pages/plans-bfq/index.js');
    await openBFQCard(1);
    expect(document.getElementById('modalTitle')!.textContent).toBe('BFQ');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('saveBFQManual(1)');
  });

  it('openBFQCard: не-manager — форма ввода скрыта', async () => {
    setupGlobals({ role: 'employee' });
    const { openBFQCard } = await import('../src/pages/plans-bfq/index.js');
    await openBFQCard(1);
    expect(document.getElementById('modalBody')!.innerHTML).not.toContain('saveBFQManual');
  });

  it('saveBFQManual: успех — тостит и перезагружает список', async () => {
    const { saveBfqManual, getBfqList } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="bfqVmr" value="15"><input id="bfqPenalty" value="0">';
    const { saveBFQManual } = await import('../src/pages/plans-bfq/index.js');
    await saveBFQManual(1);
    expect(saveBfqManual).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ employee_id: 1, vmr_avg: 15 }));
    expect(getBfqList).toHaveBeenCalled();
  });

  it('loadMonthPlans: пусто — сообщение с месяцем', async () => {
    setupGlobals();
    const { loadMonthPlans } = await import('../src/pages/plans-bfq/index.js');
    await loadMonthPlans();
    expect(document.getElementById('monthPlanList')!.textContent).toContain('Нет данных за 2026-08');
  });

  it('loadMonthPlans: строки — рендерит карточки сотрудников и "Итого сеть"', async () => {
    const { getPlansEmployeesMonth } = setupGlobals({ role: 'manager' });
    getPlansEmployeesMonth.mockResolvedValue({
      rows: [{ employee_id: 1, full_name: 'Иван', role: 'employee', shifts: 10, remaining_shifts: 2, plan: { sim: 10 }, fact: { sim: 5 }, pct: { sim: 50 } }],
      remaining_days: 5,
      totals: { fact: { sim: 5 }, plan: { sim: 10 }, pct: { sim: 50 } }
    });
    const { loadMonthPlans } = await import('../src/pages/plans-bfq/index.js');
    await loadMonthPlans();
    const html = document.getElementById('monthPlanList')!.innerHTML;
    expect(html).toContain('Иван');
    expect(html).toContain('editEmployeeMonthPlan(1');
    expect(html).toContain('Итого сеть');
  });

  it('shiftPlanMonth: сдвигает planMonth и перезагружает', async () => {
    const { getPlansEmployeesMonth } = setupGlobals();
    const { shiftPlanMonth } = await import('../src/pages/plans-bfq/index.js');
    shiftPlanMonth(1);
    expect((globalThis as any).planMonth).toBe('2026-09');
    expect(getPlansEmployeesMonth).toHaveBeenCalledWith(expect.anything(), '2026-09', '');
  });

  it('loadNetMonth: рендерит барные строки сети и по сотрудникам', async () => {
    const { getPlansEmployeesMonth } = setupGlobals();
    getPlansEmployeesMonth.mockResolvedValue({
      rows: [{ employee_id: 1, full_name: 'Иван', role: 'employee', shifts: 10, remaining_shifts: 2, plan: { sim: 10 }, fact: { sim: 5 }, pct: { sim: 50 } }],
      remaining_days: 5,
      totals: { fact: { sim: 5 }, plan: { sim: 10 } }
    });
    const { loadNetMonth } = await import('../src/pages/plans-bfq/index.js');
    await loadNetMonth();
    const html = document.getElementById('netMonthBody')!.innerHTML;
    expect(html).toContain('По сотрудникам');
    expect(html).toContain('Иван');
  });

  it('toggleMonthExtra: переключает класс open и текст кнопки', async () => {
    setupGlobals();
    document.body.innerHTML += '<div id="mpx-0"></div><button id="btn1"></button>';
    const { toggleMonthExtra } = await import('../src/pages/plans-bfq/index.js');
    const btn = document.getElementById('btn1') as HTMLElement;
    toggleMonthExtra('mpx-0', btn, 'Свернуть ▴', 'Ещё метрики ▾');
    expect(document.getElementById('mpx-0')!.classList.contains('open')).toBe(true);
    expect(btn.textContent).toBe('Свернуть ▴');
  });

  it('editEmployeeMonthPlan: не-manage — no-op', async () => {
    const { getEmployeeMonthPlan } = setupGlobals({ role: 'employee' });
    const { editEmployeeMonthPlan } = await import('../src/pages/plans-bfq/index.js');
    await editEmployeeMonthPlan(1, 'Иван');
    expect(getEmployeeMonthPlan).not.toHaveBeenCalled();
  });

  it('editEmployeeMonthPlan: manager — рендерит поля метрик', async () => {
    setupGlobals({ role: 'manager' });
    const { editEmployeeMonthPlan } = await import('../src/pages/plans-bfq/index.js');
    await editEmployeeMonthPlan(1, 'Иван');
    expect(document.getElementById('modalTitle')!.textContent).toContain('Иван');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('mp_sim');
  });

  it('saveEmployeeMonthPlan: успех — сохраняет и закрывает модалку', async () => {
    const { saveEmployeeMonthPlan } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="mp_sim" value="7"><input id="mp_mnp" value="2">';
    const { saveEmployeeMonthPlan: save } = await import('../src/pages/plans-bfq/index.js');
    await save(1);
    expect(saveEmployeeMonthPlan).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ sim: 7, mnp: 2 }));
    expect((globalThis as any).closeModal).toHaveBeenCalled();
  });

  it('loadStoreDailyPlans: пусто — "Нет данных"', async () => {
    setupGlobals();
    const { loadStoreDailyPlans } = await import('../src/pages/plans-bfq/index.js');
    await loadStoreDailyPlans();
    expect(document.getElementById('storeDailyPlans')!.textContent).toContain('Нет данных');
  });

  it('loadStoreDailyPlans: manager — карточки кликабельны через editStoreMonthPlan', async () => {
    const { getStoreDailyPlans } = setupGlobals({ role: 'manager' });
    getStoreDailyPlans.mockResolvedValue({ stores: [{ store_id: 's1', name: 'Точка А', code: '1', has_plan: true, plan: { sim: 5 } }] });
    const { loadStoreDailyPlans } = await import('../src/pages/plans-bfq/index.js');
    await loadStoreDailyPlans();
    expect(document.getElementById('storeDailyPlans')!.innerHTML).toContain("editStoreMonthPlan('s1')");
  });

  it('saveStoreMonthPlan: успех — сохраняет и перезагружает дневные планы', async () => {
    const { saveStoreMonthPlan, getStoreDailyPlans } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="smp_sim" value="9">';
    const { saveStoreMonthPlan: save } = await import('../src/pages/plans-bfq/index.js');
    await save('s1');
    expect(saveStoreMonthPlan).toHaveBeenCalledWith(expect.anything(), 's1', expect.objectContaining({ sim: 9 }));
    expect(getStoreDailyPlans).toHaveBeenCalled();
  });

  it('window.* мост — все 13 функций', async () => {
    setupGlobals();
    await import('../src/pages/plans-bfq/index.js');
    for (const name of [
      'loadBFQ',
      'openBFQCard',
      'saveBFQManual',
      'loadMonthPlans',
      'shiftPlanMonth',
      'shiftNetMonth',
      'loadNetMonth',
      'toggleMonthExtra',
      'editEmployeeMonthPlan',
      'saveEmployeeMonthPlan',
      'loadStoreDailyPlans',
      'editStoreMonthPlan',
      'saveStoreMonthPlan'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
