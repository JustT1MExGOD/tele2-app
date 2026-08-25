/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/11-v13.js → src/pages/shift. Focused rather than exhaustive
 * (batch migration) — covers calculators, shift open/close/brief/result,
 * shift+insight widget, quick sale, and live map. geoCoords() relies on
 * navigator.geolocation, stubbed to resolve instantly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals() {
  document.body.innerHTML = `
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
    <div id="lkShift"></div><div id="lkInsight"></div><div id="lkGamification"></div>
    <div id="liveList"></div><div id="liveMeta"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('timeMoscow', (iso: string) => (iso ? '10:00' : ''));
  vi.stubGlobal('metricLabel', (id: string) => id.toUpperCase());
  vi.stubGlobal('progressHTML', (label: string, fact: unknown, plan: unknown) => `<div>${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('openModal', vi.fn());
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('loadMyPlan', vi.fn());
  vi.stubGlobal('loadPage', vi.fn());
  vi.stubGlobal('page', 'my');
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });
  (globalThis as any).navigator.geolocation = {
    getCurrentPosition: (res: any) => res({ coords: { latitude: 1, longitude: 2, accuracy: 3 } })
  };

  const openShift = vi.fn().mockResolvedValue({ ok: true, session: {}, deduped: false, day_plan: { sim: 5 }, handover: null, open_tasks: [] });
  const closeShift = vi.fn().mockResolvedValue({ ok: true, session: {}, score: 80, gamification: {} });
  const getShiftCurrent = vi.fn().mockResolvedValue({ session: null });
  const getMyInsight = vi.fn().mockResolvedValue({});
  const getSelfStats = vi.fn().mockResolvedValue({});
  const parseSalePhrase = vi.fn().mockResolvedValue({ metrics: { sim: 2 }, confidence: 0.9 });
  const quickSale = vi.fn().mockResolvedValue({ ok: true, parsed: { metrics: { sim: 2 } }, sale: null });
  const getNetworkLive = vi.fn().mockResolvedValue({ date: '2026-08-25', stores: [] });
  (window as any).apiClient = { openShift, closeShift, getShiftCurrent, getMyInsight, getSelfStats, parseSalePhrase, quickSale, getNetworkLive };
  return { openShift, closeShift, getShiftCurrent, getMyInsight, getSelfStats, parseSalePhrase, quickSale, getNetworkLive };
}

describe('Смена/live/калькуляторы (миграция frontend/js/11-v13.js → src/pages/shift)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('runComboCalc: без цены — toast err', async () => {
    setupGlobals();
    document.body.innerHTML += '<input id="comboPrice" value=""><input id="comboDiscount" value="0"><div id="comboOut" style="display:none"></div>';
    const { runComboCalc } = await import('../src/pages/shift/index.js');
    runComboCalc();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажи цену', 'err');
  });

  it('runComboCalc: считает по формуле T2', async () => {
    setupGlobals();
    document.body.innerHTML += '<input id="comboPrice" value="10000"><input id="comboDiscount" value="10"><div id="comboOut" style="display:none"></div>';
    const { runComboCalc } = await import('../src/pages/shift/index.js');
    runComboCalc();
    // 10000*0.9 + 10000*0.28 + 1950 = 9000+2800+1950 = 13750
    expect(document.getElementById('comboOut')!.textContent).toContain('13 750');
  });

  it('runSchoolCalc: считает по формуле школы', async () => {
    setupGlobals();
    document.body.innerHTML += '<input id="schoolPrice" value="10000"><div id="schoolOut" style="display:none"></div>';
    const { runSchoolCalc } = await import('../src/pages/shift/index.js');
    runSchoolCalc();
    // (10000-7000) + 3000 + 3600 + 3490 = 3000+3000+3600+3490 = 13090
    expect(document.getElementById('schoolOut')!.textContent).toContain('13 090');
  });

  it('openShiftSession: успех — открывает смену и показывает бриф', async () => {
    const { openShift } = setupGlobals();
    const { openShiftSession } = await import('../src/pages/shift/index.js');
    await openShiftSession();
    expect(openShift).toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Смена открыта', 'ok');
    expect(document.getElementById('modalTitle')!.textContent).toBe('Смена открыта');
    expect((globalThis as any).loadMyPlan).toHaveBeenCalled();
  });

  it('confirmCloseShift: успех — закрывает смену и показывает результат', async () => {
    const { closeShift } = setupGlobals();
    document.body.innerHTML += '<textarea id="closeReport"></textarea><input id="closeMood" value="5"><textarea id="closeHandover"></textarea>';
    const { confirmCloseShift } = await import('../src/pages/shift/index.js');
    await confirmCloseShift();
    expect(closeShift).toHaveBeenCalled();
    expect(document.getElementById('modalBody')!.innerHTML).toContain('итоговый score');
  });

  it('loadShiftAndInsight: нет активной смены — кнопка "Открыть смену"', async () => {
    setupGlobals();
    const { loadShiftAndInsight } = await import('../src/pages/shift/index.js');
    await loadShiftAndInsight(1);
    expect(document.getElementById('lkShift')!.innerHTML).toContain('openShiftSession()');
  });

  it('loadShiftAndInsight: смена открыта — показывает прогресс и кнопку закрытия', async () => {
    const { getShiftCurrent } = setupGlobals();
    getShiftCurrent.mockResolvedValue({ session: { store_name: 'Точка А', opened_at: '2026-08-25T07:00:00Z' }, fact: { sim: 2 }, day_plan: { sim: 5 } });
    const { loadShiftAndInsight } = await import('../src/pages/shift/index.js');
    await loadShiftAndInsight(1);
    const html = document.getElementById('lkShift')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('closeShiftSession()');
  });

  it('loadShiftAndInsight: инсайт с прогнозом — рендерит блок фокуса', async () => {
    const { getMyInsight } = setupGlobals();
    getMyInsight.mockResolvedValue({ insight: { message: 'Дожми MNP', focus: ['Больше MNP'], projected_total: 12, plan_total: 15, on_track: false } });
    const { loadShiftAndInsight } = await import('../src/pages/shift/index.js');
    await loadShiftAndInsight(1);
    const html = document.getElementById('lkInsight')!.innerHTML;
    expect(html).toContain('Дожми MNP');
    expect(html).toContain('не хватит');
  });

  it('previewQuickSale: показывает разобранные метрики', async () => {
    setupGlobals();
    document.body.innerHTML += '<input id="quickSaleText" value="две симки"><div id="quickSalePreview" style="display:none"></div>';
    const { previewQuickSale } = await import('../src/pages/shift/index.js');
    await previewQuickSale();
    expect(document.getElementById('quickSalePreview')!.textContent).toContain('sim: 2');
  });

  it('submitQuickSale: пустая фраза — toast err, API не вызывается', async () => {
    const { quickSale } = setupGlobals();
    document.body.innerHTML += '<input id="quickSaleText" value="">';
    const { submitQuickSale } = await import('../src/pages/shift/index.js');
    await submitQuickSale();
    expect(quickSale).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Введи фразу', 'err');
  });

  it('submitQuickSale: успех — записывает и перезагружает страницу', async () => {
    const { quickSale } = setupGlobals();
    document.body.innerHTML += '<input id="quickSaleText" value="две симки">';
    const { submitQuickSale } = await import('../src/pages/shift/index.js');
    await submitQuickSale();
    expect(quickSale).toHaveBeenCalledWith(expect.anything(), { text: 'две симки', client_id: '' });
    expect((globalThis as any).loadPage).toHaveBeenCalledWith('my');
  });

  it('loadLiveMap: пусто — "Нет точек"', async () => {
    setupGlobals();
    const { loadLiveMap } = await import('../src/pages/shift/index.js');
    await loadLiveMap();
    expect(document.getElementById('liveList')!.textContent).toContain('Нет точек');
  });

  it('loadLiveMap: рендерит карточки точек с процентом и составом смены', async () => {
    const { getNetworkLive } = setupGlobals();
    getNetworkLive.mockResolvedValue({
      date: '2026-08-25',
      stores: [{ store_id: 's1', name: 'Точка А', status: 'ok', plan_pct: 70, staff: [{ short_name: 'Иван' }], fact: { sim: 3 }, plan: { sim: 5 } }]
    });
    const { loadLiveMap } = await import('../src/pages/shift/index.js');
    await loadLiveMap();
    const html = document.getElementById('liveList')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('Иван');
    expect(html).toContain("openStoreProfile('s1')");
  });

  it('window.* мост — все 13 функций', async () => {
    setupGlobals();
    await import('../src/pages/shift/index.js');
    for (const name of [
      'openComboCalc',
      'runComboCalc',
      'openSchoolCalc',
      'runSchoolCalc',
      'openShiftSession',
      'closeShiftSession',
      'confirmCloseShift',
      'loadShiftAndInsight',
      'openQuickSale',
      'previewQuickSale',
      'submitQuickSale',
      'loadLiveMap',
      'confettiBurst'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
