/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom test for
 * frontend/js/07-add-sale.js → src/features/add-sale. Focused rather than
 * exhaustive (batch migration) — the touch-gesture swipe-close code
 * (initModalSwipeClose) is exercised only via its no-op-when-no-sheet path;
 * jsdom doesn't dispatch real touch events, and that logic (spring physics)
 * carries no product risk worth a synthetic touch-event harness here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(overrides: { role?: string; empId?: number } = {}) {
  document.body.innerHTML = `
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: overrides.empId ?? 1, role: overrides.role ?? 'employee', full_name: 'Иван' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('fetchOrgStores', vi.fn().mockResolvedValue([{ id: 's1', name: 'Точка А' }]));
  vi.stubGlobal('loadMetricsCatalog', vi.fn().mockResolvedValue(undefined));
  vi.stubGlobal('METRICS', [
    { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
    { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'count' }
  ]);
  vi.stubGlobal('saleSelection', {} as Record<string, number>);
  vi.stubGlobal('employees', []);
  vi.stubGlobal('stores', []);
  vi.stubGlobal('page', 'home');
  vi.stubGlobal('loadPage', vi.fn());
  vi.stubGlobal('bumpStreak', vi.fn().mockReturnValue(1));
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });

  const getEmployees = vi.fn().mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
  const getSchedules = vi.fn().mockResolvedValue([]);
  const getShiftOpenMap = vi.fn().mockResolvedValue({ open: {}, stores: [] });
  const createSale = vi.fn().mockResolvedValue({ ok: true, sale: null, parsed: {} });
  (window as any).apiClient = { getEmployees, getSchedules, getShiftOpenMap, createSale };
  return { getEmployees, getSchedules, getShiftOpenMap, createSale };
}

describe('Добавить продажу (миграция frontend/js/07-add-sale.js → src/features/add-sale)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('openModal/closeModal: показывают и прячут #overlay', async () => {
    setupGlobals();
    const { openModal, closeModal } = await import('../src/features/add-sale/index.js');
    openModal();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
    closeModal();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(false);
  });

  it('openAddSale: рендерит форму с сотрудниками и точками, дизейблит select не-manager', async () => {
    const { getEmployees, getSchedules } = setupGlobals({ role: 'employee' });
    getSchedules.mockResolvedValue([{ work_date: '2026-08-25', shift_text: '', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А' }]);
    const { openAddSale } = await import('../src/features/add-sale/index.js');
    await openAddSale();
    expect(getEmployees).toHaveBeenCalled();
    const html = document.getElementById('modalBody')!.innerHTML;
    expect(html).toContain('disabled');
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
  });

  it('openAddSale: сотрудник на замене на ЧУЖОЙ точке (не в своей сети) — точка добавляется в список и предзаполняется по факту смены, а не из графика', async () => {
    const { getSchedules, getShiftOpenMap } = setupGlobals({ role: 'employee' });
    // fetchOrgStores() deliberately never returns a foreign-network store —
    // s2 (the replacement store) must come ONLY from getShiftOpenMap's own
    // `stores` list, exactly like production (see fetchOrgStores' own doc
    // comment: "сюда никогда не попадают чужие точки").
    (globalThis as any).fetchOrgStores = vi.fn().mockResolvedValue([{ id: 's1', name: 'Мегалит' }]);
    getSchedules.mockResolvedValue([{ work_date: '2026-08-25', shift_text: '', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Мегалит' }]);
    getShiftOpenMap.mockResolvedValue({ open: { '1': 's2' }, stores: [{ id: 's2', name: 'Точка Б (чужая сеть)' }] });
    const { openAddSale } = await import('../src/features/add-sale/index.js');
    await openAddSale();
    const select = document.getElementById('modalStore') as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 's2')).toBe(true);
    expect(select.value).toBe('s2');
  });

  it('openAddSale: без открытой смены — точка по-прежнему предзаполняется из графика', async () => {
    const { getSchedules, getShiftOpenMap } = setupGlobals({ role: 'employee' });
    (globalThis as any).fetchOrgStores = vi.fn().mockResolvedValue([
      { id: 's1', name: 'Мегалит' },
      { id: 's2', name: 'Точка Б' }
    ]);
    getSchedules.mockResolvedValue([{ work_date: '2026-08-25', shift_text: '', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Мегалит' }]);
    getShiftOpenMap.mockResolvedValue({ open: {}, stores: [] });
    const { openAddSale } = await import('../src/features/add-sale/index.js');
    await openAddSale();
    const select = document.getElementById('modalStore') as HTMLSelectElement;
    expect(select.value).toBe('s1');
  });

  it('toggleSaleMetric: переключает выбор метрики и перерисовывает qty-list', async () => {
    setupGlobals();
    document.body.innerHTML += '<div id="metricGrid"></div><div id="saleQtyList"></div>';
    const { toggleSaleMetric } = await import('../src/features/add-sale/index.js');
    toggleSaleMetric('sim');
    expect((globalThis as any).saleSelection.sim).toBe(1);
    expect(document.getElementById('saleQtyList')!.innerHTML).toContain('SIM');
    toggleSaleMetric('sim');
    expect((globalThis as any).saleSelection.sim).toBeUndefined();
  });

  it('setAllQty: задаёт одинаковое количество для всех выбранных метрик', async () => {
    setupGlobals();
    document.body.innerHTML += '<div id="saleQtyList"></div>';
    (globalThis as any).saleSelection = { sim: 1, mnp: 1 };
    const { setAllQty } = await import('../src/features/add-sale/index.js');
    setAllQty(5);
    expect((globalThis as any).saleSelection).toEqual({ sim: 5, mnp: 5 });
  });

  // Регрессия (hotfix 20.57.1, finding #5): m.label (кастомная метрика,
  // GET /metrics) подставлялся без esc() в grid.innerHTML/list.innerHTML.
  // Этот файл обычно стабит esc() как no-op-стрингификатор (см. setupGlobals
  // выше) — здесь подменяем на настоящую реализацию, иначе тест не поймал
  // бы регрессию.
  it('renderSaleMetrics/renderSaleQtyList: вредоносная метка метрики не создаёт реальный <img>/не исполняет JS', async () => {
    setupGlobals();
    vi.stubGlobal('esc', esc);
    document.body.innerHTML += '<div id="metricGrid"></div><div id="saleQtyList"></div>';
    const payload = `<img src=x onerror="window.__addSaleLabelXss=1">`;
    vi.stubGlobal('METRICS', [{ id: 'sim', label: payload, short_label: 'SIM', unit: 'count' }]);
    const { renderSaleMetrics, toggleSaleMetric } = await import('../src/features/add-sale/index.js');
    renderSaleMetrics();

    expect(document.querySelectorAll('img').length).toBe(0);
    expect((window as any).__addSaleLabelXss).toBeUndefined();
    expect(document.getElementById('metricGrid')!.innerHTML).toContain('&lt;img');

    toggleSaleMetric('sim'); // re-renders saleQtyList too
    expect(document.querySelectorAll('img').length).toBe(0);
    expect((window as any).__addSaleLabelXss).toBeUndefined();
    expect(document.getElementById('saleQtyList')!.innerHTML).toContain('&lt;img');
  });

  it('submitSale: без сотрудника/точки — toast err, API не вызывается', async () => {
    const { createSale } = setupGlobals();
    const { submitSale } = await import('../src/features/add-sale/index.js');
    await submitSale();
    expect(createSale).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажи сотрудника и точку', 'err');
  });

  it('submitSale: без выбранных метрик — toast err', async () => {
    const { createSale } = setupGlobals();
    document.body.innerHTML += '<select id="modalEmployee"><option value="1" selected></option></select><select id="modalStore"><option value="s1" selected></option></select>';
    const { submitSale } = await import('../src/features/add-sale/index.js');
    await submitSale();
    expect(createSale).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Выбери метрики и количество', 'err');
  });

  it('submitSale: успех — создаёт продажу, тостит, перезагружает страницу', async () => {
    const { createSale, getSchedules } = setupGlobals();
    getSchedules.mockResolvedValue([]);
    const mod = await import('../src/features/add-sale/index.js');
    await mod.openAddSale(); // generates client_id, matching real usage (form always opened first)
    document.body.innerHTML +=
      '<select id="modalEmployee"><option value="1" selected></option></select><select id="modalStore"><option value="s1" selected></option></select><button id="saleSubmitBtn"></button>';
    (globalThis as any).saleSelection = { sim: 2 };
    const { submitSale } = mod;
    await submitSale();
    expect(createSale).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ employee_id: 1, store_id: 's1', sim: 2, client_id: 'test-uuid' }));
    expect((globalThis as any).toast).toHaveBeenCalledWith(expect.stringContaining('Добавлено'), 'ok');
    expect((globalThis as any).loadPage).toHaveBeenCalledWith('home');
  });

  it('submitSale: тренировочный режим (__tutorialDryRun) — не вызывает API, зовёт callback', async () => {
    const { createSale } = setupGlobals();
    document.body.innerHTML +=
      '<select id="modalEmployee"><option value="1" selected></option></select><select id="modalStore"><option value="s1" selected></option></select><button id="saleSubmitBtn"></button>';
    (globalThis as any).saleSelection = { sim: 1 };
    const cb = vi.fn();
    (window as any).__tutorialDryRun = true;
    (window as any).__tutorialDryRunCallback = cb;
    const { submitSale } = await import('../src/features/add-sale/index.js');
    await submitSale();
    expect(createSale).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalled();
    // T2 Academy's sale-practice mission needs the actually-entered metrics
    // to validate against (e.g. sim=1/mnp=1) — the callback must receive
    // what was really selected, not just fire with no data.
    expect(cb.mock.calls[0][0]).toMatchObject({ sim: 1, employee_id: 1, store_id: 's1' });
  });

  it('openCorrectSale: чужая продажа без прав manage — toast err, форма не рендерится', async () => {
    setupGlobals({ role: 'employee', empId: 1 });
    const { openCorrectSale } = await import('../src/features/add-sale/index.js');
    await openCorrectSale({ employee_id: 2, store_id: 's1', full_name: 'Пётр' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Нельзя править чужие продажи', 'err');
  });

  it('openCorrectSale: manager — рендерит форму дельты', async () => {
    setupGlobals({ role: 'manager' });
    const { openCorrectSale } = await import('../src/features/add-sale/index.js');
    await openCorrectSale({ employee_id: 2, store_id: 's1', full_name: 'Пётр' });
    expect(document.getElementById('modalTitle')!.textContent).toContain('Исправить продажу');
  });

  it('window.* мост — все 8 функций', async () => {
    setupGlobals();
    await import('../src/features/add-sale/index.js');
    for (const name of ['openAddSale', 'onEmpChange', 'toggleSaleMetric', 'setAllQty', 'openModal', 'closeModal', 'openCorrectSale', 'submitSale']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
