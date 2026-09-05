/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/04-schedule.js → src/pages/schedule. Focused rather than
 * exhaustive (batch migration) — covers plan day, today schedule, month
 * calendar grid, summary schedule, and the edit-day modal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="planList"></div>
    <div id="todayList"></div>
    <div id="monthLabel"></div>
    <div id="monthBoard"></div>
    <div id="summaryScheduleSection"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  // Documentation-audit XSS fix — реальная реализация esc(), не no-op стаб
  // (no-op стаб не поймал бы регрессию title="..." экранирования ниже).
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('scheduleMonth', '2026-08');
  vi.stubGlobal('stores', []);
  vi.stubGlobal('fetchOrgStores', vi.fn().mockResolvedValue([{ id: 's1', name: 'Точка А', code: 'A', hours: 11 }]));
  vi.stubGlobal('pctTone', (p: number) => (p >= 100 ? 'good' : p >= 70 ? 'mid' : 'bad'));
  vi.stubGlobal('progressHTML', (label: string, fact: unknown, plan: unknown) => `<div>${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('metricLabel', (id: string) => id.toUpperCase());
  vi.stubGlobal('storeColor', () => '#2aabee');
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('METRICS', [
    { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
    { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'count' }
  ]);

  const getStatsDaily = vi.fn().mockResolvedValue([]);
  const getSchedules = vi.fn().mockResolvedValue([]);
  const getPlansTemplate = vi.fn().mockResolvedValue([]);
  const getStoreDailyPlans = vi.fn().mockResolvedValue({ stores: [] });
  const getScheduleMonth = vi.fn().mockResolvedValue({ month: '2026-08', start: '', end: '', items: [] });
  const getEmployees = vi.fn().mockResolvedValue([]);
  const saveSchedulesBulk = vi.fn().mockResolvedValue({ ok: true, count: 1, items: [] });
  (window as any).apiClient = { getStatsDaily, getSchedules, getPlansTemplate, getStoreDailyPlans, getScheduleMonth, getEmployees, saveSchedulesBulk };
  return { getStatsDaily, getSchedules, getPlansTemplate, getStoreDailyPlans, getScheduleMonth, getEmployees, saveSchedulesBulk };
}

describe('График (миграция frontend/js/04-schedule.js → src/pages/schedule)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('monthLabel: "2026-08" -> "Август 2026"', async () => {
    setupGlobals();
    const { monthLabel } = await import('../src/pages/schedule/index.js');
    expect(monthLabel('2026-08')).toBe('Август 2026');
  });

  it('loadPlanDay: рендерит карточки точек с процентом плана', async () => {
    const { getStatsDaily, getSchedules } = setupGlobals();
    getStatsDaily.mockResolvedValue([{ store_id: 's1', name: 'A', code: 'A', sim: 5, mnp: 2 }]);
    getSchedules.mockResolvedValue([{ work_date: '2026-08-25', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А' }]);
    const { loadPlanDay } = await import('../src/pages/schedule/index.js');
    await loadPlanDay();
    const html = document.getElementById('planList')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('Иван');
  });

  it('toggleStore: переключает класс open на карточке точки', async () => {
    setupGlobals();
    document.body.innerHTML += '<div id="sc-s1"></div>';
    const { toggleStore } = await import('../src/pages/schedule/index.js');
    toggleStore('s1');
    expect(document.getElementById('sc-s1')!.classList.contains('open')).toBe(true);
  });

  it('loadTodaySchedule: пусто — "Сегодня никого в графике"', async () => {
    setupGlobals();
    const { loadTodaySchedule } = await import('../src/pages/schedule/index.js');
    await loadTodaySchedule();
    expect(document.getElementById('todayList')!.textContent).toContain('Сегодня никого в графике');
  });

  it('loadTodaySchedule: группирует сотрудников по точкам', async () => {
    const { getSchedules } = setupGlobals();
    getSchedules.mockResolvedValue([{ work_date: '2026-08-25', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А' }]);
    const { loadTodaySchedule } = await import('../src/pages/schedule/index.js');
    await loadTodaySchedule();
    const html = document.getElementById('todayList')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('openEmployeeCard(1)');
  });

  it('shiftMonth: сдвигает scheduleMonth и перезагружает месячный график', async () => {
    const { getScheduleMonth } = setupGlobals();
    const { shiftMonth } = await import('../src/pages/schedule/index.js');
    shiftMonth(1);
    expect((globalThis as any).scheduleMonth).toBe('2026-09');
    expect(getScheduleMonth).toHaveBeenCalledWith(expect.anything(), '2026-09', '');
  });

  it('loadMonthSchedule: рендерит календарную сетку по сотрудникам', async () => {
    const { getEmployees, getScheduleMonth } = setupGlobals();
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    getScheduleMonth.mockResolvedValue({
      month: '2026-08', start: '', end: '',
      items: [{ work_date: '2026-08-01', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А', store_short: 'A' }]
    });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();
    const html = document.getElementById('monthBoard')!.innerHTML;
    expect(html).toContain('Иван');
    expect(html).toContain('sch-grid');
    expect(document.getElementById('monthLabel')!.textContent).toBe('Август 2026');
  });

  // Documentation-audit XSS fix — store_name раньше подставлялся в
  // title="..." без esc(), в отличие от соседних мест того же файла.
  it('store_name с " в title="..." не разрывает атрибут — атрибут-breakout невозможен', async () => {
    const { getEmployees, getScheduleMonth } = setupGlobals();
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    const payload = `Точка А" onmouseover="window.__pwned=1`;
    getScheduleMonth.mockResolvedValue({
      month: '2026-08', start: '', end: '',
      items: [{ work_date: '2026-08-01', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: payload, store_short: 'A' }]
    });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();

    // jsdom реально парсит HTML — если бы " разорвал title="...", здесь
    // появился бы настоящий onmouseover на элементе.
    expect(document.querySelectorAll('[onmouseover]').length).toBe(0);
    expect((window as any).__pwned).toBeUndefined();
    // Значение всё ещё в атрибуте (в HTML-экранированном виде), не молча
    // отброшено — esc() экранирует, не вырезает.
    const cell = document.querySelector('.sch-cell.work') as HTMLElement | null;
    expect(cell?.getAttribute('title')).toContain(payload);
  });

  // Регрессия (hotfix 20.57.1, finding #5): store_short/store_name
  // подставлялись в текст ячейки без esc() — соседняя renderSummarySchedule()
  // в этом же файле уже экранировала ту же самую пару полей.
  it('loadMonthSchedule: вредоносный store_short не создаёт реальный <img>/не исполняет JS', async () => {
    const { getEmployees, getScheduleMonth } = setupGlobals();
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    const payload = `<img src=x onerror="window.__shortXss=1">`;
    getScheduleMonth.mockResolvedValue({
      month: '2026-08', start: '', end: '',
      items: [{ work_date: '2026-08-01', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А', store_short: payload }]
    });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();

    expect(document.querySelectorAll('img').length).toBe(0);
    expect((window as any).__shortXss).toBeUndefined();
    const cell = document.querySelector('.sch-cell.work .s') as HTMLElement | null;
    expect(cell?.innerHTML).toContain('&lt;img');
  });

  // Регрессия (hotfix 20.57.1, finding #5): emp.name (full_name) подставлялся
  // без esc() в заголовок строки сотрудника месячного графика.
  it('loadMonthSchedule: вредоносный full_name сотрудника не исполняет JS', async () => {
    const { getEmployees, getScheduleMonth } = setupGlobals();
    const payload = `<img src=x onerror="window.__nameXss=1">`;
    getEmployees.mockResolvedValue([{ id: 1, full_name: payload, short_name: null, is_active: true, role: 'employee' }]);
    getScheduleMonth.mockResolvedValue({
      month: '2026-08', start: '', end: '',
      items: [{ work_date: '2026-08-01', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: payload, store_name: 'Точка А', store_short: 'A' }]
    });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();

    expect(document.querySelectorAll('img').length).toBe(0);
    expect((window as any).__nameXss).toBeUndefined();
    const head = document.querySelector('.sch-emp-head span') as HTMLElement | null;
    expect(head?.innerHTML).toContain('&lt;img');
  });

  // Регрессия (hotfix 20.57.1, finding #5): editDay() рендерил store name/id
  // в <option> без esc() — атрибут-breakout (value="...") и тег-инъекция
  // (текст опции) оба были возможны.
  it('editDay: вредоносное имя/id точки не разрывает <option> и не исполняет JS', async () => {
    setupGlobals({ role: 'manager' });
    const payload = `s1"><script>window.__optXss=1</script>`;
    (globalThis as any).stores = [{ id: payload, name: `Точка"><img src=x onerror="window.__optXss2=1">` }];
    const { editDay } = await import('../src/pages/schedule/index.js');
    await editDay(1, '2026-08-25', payload, 8);

    expect((window as any).__optXss).toBeUndefined();
    expect((window as any).__optXss2).toBeUndefined();
    expect(document.querySelectorAll('script').length).toBe(0);
    expect(document.querySelectorAll('img').length).toBe(0);
    const select = document.getElementById('schStore') as HTMLSelectElement | null;
    expect(select?.options.length).toBe(1);
  });

  // Hotfix 20.57.1 PASS 3, finding #1 — production "Ошибка загрузки графика"
  // incident (04.09.2026) investigation: getScheduleMonth() used to have a
  // .catch(() => empty response), masking any transport/API failure as a
  // valid empty month ("Нет данных"), indistinguishable from a real empty
  // schedule. Each fetch stage now fails loudly with its own message/log tag.
  describe('loadMonthSchedule — раздельные стадии ошибок (finding #1, PASS 3)', () => {
    it('getScheduleMonth падает — показывает ошибку, НЕ "Нет данных" (раньше маскировалось .catch())', async () => {
      const { getScheduleMonth } = setupGlobals();
      getScheduleMonth.mockRejectedValue(new Error('api_error:/schedules/month:500'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
      await loadMonthSchedule();
      const html = document.getElementById('monthBoard')!.innerHTML;
      expect(html).toContain('Ошибка загрузки графика');
      expect(html).not.toContain('Нет данных');
      expect(errSpy).toHaveBeenCalledWith('[schedule] SCHEDULE_MONTH_FETCH_FAILED', expect.any(Error));
      errSpy.mockRestore();
    });

    it('fetchOrgStores падает — показывает ошибку точек', async () => {
      setupGlobals();
      (globalThis as any).stores = [];
      (globalThis as any).fetchOrgStores = vi.fn().mockRejectedValue(new Error('network'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
      await loadMonthSchedule();
      expect(document.getElementById('monthBoard')!.innerHTML).toContain('не удалось получить точки');
      expect(errSpy).toHaveBeenCalledWith('[schedule] SCHEDULE_STORES_FETCH_FAILED', expect.any(Error));
      errSpy.mockRestore();
    });

    it('getEmployees падает — показывает ошибку сотрудников (правдоподобный кандидат на реальный production-инцидент: getScheduleMonth не имеет такого catch)', async () => {
      const { getEmployees } = setupGlobals();
      getEmployees.mockRejectedValue(new Error('api_error:/employees:401'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
      await loadMonthSchedule();
      expect(document.getElementById('monthBoard')!.innerHTML).toContain('не удалось получить сотрудников');
      expect(errSpy).toHaveBeenCalledWith('[schedule] SCHEDULE_EMPLOYEES_FETCH_FAILED', expect.any(Error));
      errSpy.mockRestore();
    });

    it('успешные ответы, но рендеринг бросает исключение — показывает "Ошибка отображения графика", не роняет страницу', async () => {
      const { getEmployees, getScheduleMonth } = setupGlobals();
      getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
      getScheduleMonth.mockResolvedValue({
        month: '2026-08', start: '', end: '',
        items: [{ work_date: '2026-08-01', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А', store_short: 'A' }]
      });
      // Симулируем реальное исключение при рендере (напр. malformed data),
      // не полагаясь на конкретную внутреннюю причину.
      (globalThis as any).storeColor = () => {
        throw new Error('simulated render failure (artificial, PASS 3 test)');
      };
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
      await loadMonthSchedule();
      expect(document.getElementById('monthBoard')!.innerHTML).toContain('Ошибка отображения графика');
      expect(errSpy).toHaveBeenCalledWith('[schedule] SCHEDULE_RENDER_FAILED', expect.any(Error));
      errSpy.mockRestore();
    });

    it('пустой месяц БЕЗ ошибок — по-прежнему честно показывает "Нет данных" (не регрессия на нормальный путь)', async () => {
      const { getEmployees, getScheduleMonth } = setupGlobals();
      getEmployees.mockResolvedValue([]);
      getScheduleMonth.mockResolvedValue({ month: '2026-08', start: '', end: '', items: [] });
      const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
      await loadMonthSchedule();
      expect(document.getElementById('monthBoard')!.innerHTML).toContain('Нет данных');
    });
  });

  it('loadMonthSchedule: сотрудник — сводный график скрыт; manager — показан', async () => {
    const { getEmployees, getScheduleMonth } = setupGlobals({ role: 'employee' });
    getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    getScheduleMonth.mockResolvedValue({ month: '2026-08', start: '', end: '', items: [] });
    const { loadMonthSchedule } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule();
    expect(document.getElementById('summaryScheduleSection')!.innerHTML).toBe('');

    const mod2 = setupGlobals({ role: 'manager' });
    mod2.getEmployees.mockResolvedValue([{ id: 1, full_name: 'Иван', short_name: null, is_active: true, role: 'employee' }]);
    mod2.getScheduleMonth.mockResolvedValue({
      month: '2026-08', start: '', end: '',
      items: [{ work_date: '2026-08-01', shift_text: 'День', hours: 8, store_id: 's1', employee_id: 1, full_name: 'Иван', store_name: 'Точка А' }]
    });
    vi.resetModules();
    const { loadMonthSchedule: loadMonthSchedule2 } = await import('../src/pages/schedule/index.js');
    await loadMonthSchedule2();
    expect(document.getElementById('summaryScheduleSection')!.innerHTML).toContain('Сводный график команды');
  });

  it('editDay: не-manage — no-op', async () => {
    setupGlobals({ role: 'employee' });
    const { editDay } = await import('../src/pages/schedule/index.js');
    await editDay(1, '2026-08-25', 's1', 8);
    expect(document.getElementById('modalTitle')!.textContent).toBe('');
  });

  it('editDay: manager — рендерит форму правки смены', async () => {
    setupGlobals({ role: 'manager' });
    (globalThis as any).stores = [{ id: 's1', name: 'Точка А' }];
    const { editDay } = await import('../src/pages/schedule/index.js');
    await editDay(1, '2026-08-25', 's1', 8);
    expect(document.getElementById('modalTitle')!.textContent).toContain('2026-08-25');
    expect(document.getElementById('modalBody')!.innerHTML).toContain("saveShift(1, '2026-08-25')");
  });

  it('saveShift: успех — сохраняет, тостит, закрывает модалку', async () => {
    const { saveSchedulesBulk } = setupGlobals({ role: 'manager' });
    document.body.innerHTML += '<select id="schStore"><option value="s1" selected></option></select><input id="schHours" value="8"><input id="schText" value="10-21">';
    const { saveShift } = await import('../src/pages/schedule/index.js');
    await saveShift(1, '2026-08-25');
    expect(saveSchedulesBulk).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ items: [{ employee_id: 1, work_date: '2026-08-25', store_id: 's1', hours: 8, shift_text: '10-21' }] })
    );
    expect((globalThis as any).toast).toHaveBeenCalledWith('Смена сохранена', 'ok');
  });

  it('window.* мост — все 8 функций', async () => {
    setupGlobals();
    await import('../src/pages/schedule/index.js');
    for (const name of ['loadPlanDay', 'toggleStore', 'loadTodaySchedule', 'shiftMonth', 'monthLabel', 'loadMonthSchedule', 'editDay', 'saveShift']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
