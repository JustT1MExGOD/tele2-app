/**
 * 21.x (Frontend rewrite continuation, batch of 11) — jsdom render test for
 * frontend/js/09-cash-metrics.js → src/pages/cash-metrics. Focused rather
 * than exhaustive (batch migration) — covers the main render path, empty/
 * error states, and the state-changing actions (saveCash/saveMetric/deleteMetric).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(overrides: { role?: string; storesSeed?: any[] } = {}) {
  document.body.innerHTML = `
    <div id="cashTable"></div>
    <div id="cashEditSection"></div>
    <select id="cashStore"></select>
    <input id="cashDate">
    <input id="cashFact">
    <input id="cash1c">
    <input id="cashComment">
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  // 20.49.0 — реальная esc() (не no-op stub), чтобы тест на attribute-
  // breakout ниже проверял настоящее экранирование, не заглушку.
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('stores', overrides.storesSeed ?? []);
  vi.stubGlobal('fetchOrgStores', vi.fn().mockResolvedValue([{ id: 's1', name: 'Точка А' }]));
  vi.stubGlobal('toggleMonthExtra', vi.fn());
  vi.stubGlobal('canManage', () => overrides.role === 'manager');
  vi.stubGlobal('METRICS', [
    { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count', unit_type: 'count' },
    { id: 'esim_custom', label: 'eSIM', short_label: 'eSIM', unit: 'count', unit_type: 'count' }
  ]);
  vi.stubGlobal('loadMetricsCatalog', vi.fn().mockResolvedValue(undefined));
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  // jsdom doesn't implement scrollIntoView — fillCashForm() calls it on click.
  (Element.prototype as any).scrollIntoView = vi.fn();

  const getCashTable = vi.fn().mockResolvedValue({ from: '', to: '', stores: [], dates: [], cells: {} });
  const saveCash = vi.fn().mockResolvedValue({ ok: true });
  const createMetric = vi.fn();
  const deleteMetric = vi.fn().mockResolvedValue({ ok: true });
  (window as any).apiClient = { getCashTable, saveCash, createMetric, deleteMetric };
  return { getCashTable, saveCash, createMetric, deleteMetric };
}

describe('Касса / метрики (миграция frontend/js/09-cash-metrics.js → src/pages/cash-metrics)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadCash: пусто (нет дат) — сообщение "внеси первую строку"', async () => {
    setupGlobals();
    const { loadCash } = await import('../src/pages/cash-metrics/index.js');
    await loadCash();
    expect(document.getElementById('cashTable')!.textContent).toContain('внеси первую строку');
  });

  it('loadCash: подгружает stores, если ещё не загружены (мутирует shared глобал)', async () => {
    const { getCashTable } = setupGlobals({ storesSeed: [] });
    getCashTable.mockResolvedValue({ from: '', to: '', stores: [], dates: [], cells: {} });
    const { loadCash } = await import('../src/pages/cash-metrics/index.js');
    await loadCash();
    expect((globalThis as any).fetchOrgStores).toHaveBeenCalled();
    expect((globalThis as any).stores.length).toBe(1);
  });

  it('loadCash: рендерит последние 2 дня сразу, остальные — под "Ещё дни"', async () => {
    const { getCashTable } = setupGlobals({ storesSeed: [{ id: 's1', name: 'Точка А' }] });
    getCashTable.mockResolvedValue({
      from: '', to: '',
      stores: [{ id: 's1', name: 'Точка А', code: 'A' }],
      dates: ['2026-08-20', '2026-08-21', '2026-08-22'],
      cells: { '2026-08-22': { s1: { cash_fact: 5000, cash_1c: 4800, delta: 200, comment: null } } }
    });
    const { loadCash } = await import('../src/pages/cash-metrics/index.js');
    await loadCash();
    const html = document.getElementById('cashTable')!.innerHTML;
    expect(html).toContain('22.08.26');
    expect(html).toContain('Ещё дни');
    expect(html).toContain("fillCashForm('s1','2026-08-22',5000,4800)");
  });

  it('loadCash: ошибка API — не падает, показывает сообщение', async () => {
    const { getCashTable } = setupGlobals();
    getCashTable.mockRejectedValue(new Error('network'));
    const { loadCash } = await import('../src/pages/cash-metrics/index.js');
    await loadCash();
    expect(document.getElementById('cashTable')!.textContent).toContain('недоступна');
  });

  it('fillCashForm: заполняет форму значениями из клика по строке', async () => {
    setupGlobals();
    (document.getElementById('cashStore') as HTMLSelectElement).innerHTML = '<option value="s1">Точка А</option>';
    const { fillCashForm } = await import('../src/pages/cash-metrics/index.js');
    fillCashForm('s1', '2026-08-20', 1000, 900);
    expect((document.getElementById('cashStore') as HTMLSelectElement).value).toBe('s1');
    expect((document.getElementById('cashFact') as HTMLInputElement).value).toBe('1000');
  });

  it('saveCash: успех — сохраняет и перезагружает таблицу', async () => {
    const { saveCash: apiSaveCash, getCashTable } = setupGlobals();
    document.body.innerHTML += '<option></option>'; // no-op, keep inputs as-is
    const { saveCash } = await import('../src/pages/cash-metrics/index.js');
    (document.getElementById('cashStore') as HTMLSelectElement).innerHTML = '<option value="s1" selected>Точка А</option>';
    (document.getElementById('cashFact') as HTMLInputElement).value = '5000';

    await saveCash();

    expect(apiSaveCash).toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Касса сохранена', 'ok');
    expect(getCashTable).toHaveBeenCalled();
  });

  it('openAddMetric: не-manager — no-op', async () => {
    setupGlobals({ role: 'employee' });
    const { openAddMetric } = await import('../src/pages/cash-metrics/index.js');
    await openAddMetric();
    expect(document.getElementById('modalBody')!.innerHTML).toBe('');
  });

  it('openAddMetric: manager — показывает свои метрики (без базовых) + форму добавления', async () => {
    setupGlobals({ role: 'manager' });
    const { openAddMetric } = await import('../src/pages/cash-metrics/index.js');
    await openAddMetric();
    const modalBody = document.getElementById('modalBody')!;
    expect(modalBody.innerHTML).toContain('eSIM');
    // Ровно одна кнопка удаления — базовая метрика ('sim') её не получает.
    const deleteButtons = modalBody.querySelectorAll('button.mchip');
    expect(deleteButtons.length).toBe(1);
    // getAttribute() отдаёт значение ПОСЛЕ HTML-decode — реальный вызов,
    // который увидит браузер, независимо от деталей esc()-экранирования
    // в сыром innerHTML (20.49.0 — деталь именно этого экранирования
    // проверяется отдельным attribute-breakout тестом ниже).
    expect(deleteButtons[0].getAttribute('onclick')).toBe(`deleteMetric('esim_custom',"eSIM")`);
  });

  // 20.49.0 (Web Security & Trust Layer, часть 2) — регресс на реальную
  // находку: JSON.stringify(m.label) даёт JS-safe строку, но не
  // HTML-attribute-safe — метка кастомной метрики с " разрывала
  // onclick="..." и внедряла произвольный обработчик на элемент.
  it('custom-метрика с " в названии не разрывает onclick="..." — атрибут-breakout невозможен', async () => {
    setupGlobals({ role: 'manager' });
    const payload = `x" onmouseover="window.__pwned=1`;
    vi.stubGlobal('METRICS', [
      { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count', unit_type: 'count' },
      { id: 'esim_custom', label: payload, short_label: 'eSIM', unit: 'count', unit_type: 'count' }
    ]);
    const { openAddMetric } = await import('../src/pages/cash-metrics/index.js');
    await openAddMetric();
    const buttons = Array.from(document.getElementById('modalBody')!.querySelectorAll('button'));
    for (const b of buttons) {
      expect(b.hasAttribute('onmouseover')).toBe(false);
    }
    expect((window as any).__pwned).toBeUndefined();
  });

  it('deleteMetric: без подтверждения (confirm=false) — API не вызывается', async () => {
    const { deleteMetric: apiDelete } = setupGlobals({ role: 'manager' });
    (globalThis as any).confirm.mockReturnValue(false);
    const { deleteMetric } = await import('../src/pages/cash-metrics/index.js');
    await deleteMetric('esim_custom', 'eSIM');
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('saveMetric: пустое название — toast err, API не вызывается', async () => {
    const { createMetric } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<input id="nm_label" value=""><input id="nm_short" value=""><select id="nm_unit"><option value="count" selected></option></select>';
    const { saveMetric } = await import('../src/pages/cash-metrics/index.js');
    await saveMetric();
    expect(createMetric).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажи название', 'err');
  });

  it('saveMetric: успех — создаёт метрику, тостит, закрывает модалку', async () => {
    const { createMetric } = setupGlobals({ role: 'manager' });
    createMetric.mockResolvedValue({ ok: true, item: { label: 'eSIM' } });
    document.body.innerHTML += '<input id="nm_label" value="eSIM"><input id="nm_short" value=""><select id="nm_unit"><option value="count" selected></option></select>';
    const { saveMetric } = await import('../src/pages/cash-metrics/index.js');
    await saveMetric();
    expect(createMetric).toHaveBeenCalled();
    expect((globalThis as any).closeModal).toHaveBeenCalled();
    expect((globalThis as any).loadMetricsCatalog).toHaveBeenCalled();
  });

  it('window.* мост — все 6 функций', async () => {
    setupGlobals();
    await import('../src/pages/cash-metrics/index.js');
    for (const name of ['loadCash', 'fillCashForm', 'saveCash', 'openAddMetric', 'deleteMetric', 'saveMetric']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
