/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/03-home.js → src/pages/home. Focused rather than exhaustive
 * (batch migration) — covers "Мой день", Command Center widget, weekly
 * dashboard/top-7, greeting, streak, and "О приложении".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="headerDate"></div>
    <div id="greetingCard"></div>
    <div id="myDayBody"></div>
    <div id="myDayStoreHead"></div>
    <div id="headerStorePill" style="display:none"><span id="headerStoreCode"></span><span id="headerStoreAddr"></span></div>
    <div id="commandCenterSection"></div>
    <div id="commandCenterBody"></div>
    <div id="homeTodaySwipe"></div>
    <span id="hSim"></span><span id="hMnp"></span><span id="hPa"></span><span id="hCombo"></span><span id="hPhones"></span><span id="hAcc"></span>
    <div id="networkPulse"></div>
    <div id="homeTop"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
    <!-- Desktop dashboard (20.40, docs/DESKTOP-DESIGN.md) — те же данные,
         два render-таргета (setBothHTML() в home/index.ts). -->
    <div id="homeDesktopDashboard">
      <div id="myDayBodyDesktop"></div>
      <div id="myDayStoreHeadDesktop"></div>
      <div id="homeDesktopInsights"></div>
      <div id="commandCenterBodyDesktop"></div>
      <span id="hSimDesktop"></span><span id="hMnpDesktop"></span><span id="hPaDesktop"></span><span id="hComboDesktop"></span><span id="hPhonesDesktop"></span><span id="hAccDesktop"></span>
      <div id="networkPulseDesktop"></div>
      <div id="homeTopDesktop"></div>
      <div id="homeDesktopTools"></div>
    </div>
    <div id="homeToolsSection">
      <button class="row" onclick="switchPage('bfq')">BFQ</button>
      <button class="row" id="btnMgrTutorial" style="display:none">Обучение manager</button>
    </div>
  `;
  // §P1-E (20.54.0) — real esc(), not a no-op passthrough: a stub that
  // doesn't escape can't catch an escaping regression (see the
  // shift_text/firstName XSS fixes covered below).
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee', full_name: 'Иван Петров' });
  vi.stubGlobal('tgUser', () => ({ id: 555, first_name: 'Иван' }));
  vi.stubGlobal('canViewAnalytics', () => overrides.role === 'manager' || overrides.role === 'admin');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('formatDateRu', (iso: string) => iso.split('-').reverse().join('.'));
  vi.stubGlobal('greetingByHour', () => 'Добрый день');
  vi.stubGlobal('APP_VERSION', '21.4.0');
  vi.stubGlobal('roleLabel', (r: string) => ({ employee: 'Продавец', manager: 'Руководитель' })[r] || r);
  vi.stubGlobal('metricShort', (id: string) => id.toUpperCase());
  vi.stubGlobal('progressHTML', (label: string, fact: unknown, plan: unknown) => `<div>${label}:${fact}/${plan}</div>`);
  vi.stubGlobal('initSwipePanels', vi.fn());
  vi.stubGlobal('haptic', vi.fn());
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('openModal', vi.fn());
  vi.stubGlobal('closeModal', vi.fn());
  localStorage.clear();

  const getMyDay = vi.fn().mockResolvedValue({ bound: false });
  const changeTaskStatus = vi.fn().mockResolvedValue({ ok: true });
  const getSupervisorHealth = vi.fn().mockResolvedValue({ health: 80, overall_pct: 70, pace_delta: 5, drops: [], date: '2026-08-25' });
  const getShiftCurrent = vi.fn().mockResolvedValue({ session: null });
  const getScheduleMonth = vi.fn().mockResolvedValue([]);
  const getStatsDaily = vi.fn().mockResolvedValue([]);
  const getDashboard = vi.fn().mockResolvedValue(null);
  (window as any).apiClient = { getMyDay, changeTaskStatus, getSupervisorHealth, getShiftCurrent, getScheduleMonth, getStatsDaily, getDashboard };
  return { getMyDay, changeTaskStatus, getSupervisorHealth, getShiftCurrent, getScheduleMonth, getStatsDaily, getDashboard };
}

describe('Главная (миграция frontend/js/03-home.js → src/pages/home)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('commandCenterTone: пороги good/mid/bad', async () => {
    setupGlobals();
    const { commandCenterTone } = await import('../src/pages/home/index.js');
    expect(commandCenterTone(80)).toBe('good');
    expect(commandCenterTone(50)).toBe('mid');
    expect(commandCenterTone(10)).toBe('bad');
  });

  it('loadMyDay: не привязан — подсказка привязки (мобильный и desktop-таргет)', async () => {
    const { getMyDay } = setupGlobals();
    getMyDay.mockResolvedValue({ bound: false });
    const { loadMyDay } = await import('../src/pages/home/index.js');
    await loadMyDay();
    expect(document.getElementById('myDayBody')!.innerHTML).toContain('Аккаунт не привязан');
    expect(document.getElementById('myDayBodyDesktop')!.innerHTML).toContain('Аккаунт не привязан');
  });

  it('loadMyDay: смена есть — прогресс дня + задачи, пишет в оба render-таргета (20.40 setBothHTML)', async () => {
    const { getMyDay } = setupGlobals();
    getMyDay.mockResolvedValue({
      bound: true,
      shift: { store_id: 's1', store_name: 'Точка А', store_code: 'A1', store_address: 'Ленина 1', color: null, shift_text: 'День', hours: 8 },
      total: { fact: 5, plan: 10, pct: 50 },
      progress: { sim: { fact: 3, plan: 5, pct: 60 } },
      tasks: [{ id: 9, org_id: 'o1', title: 'Проверить кассу', description: null, created_by: 1, assigned_to: 1, store_id: 's1', alert_id: null, priority: 'normal', status: 'open', due_at: null, completed_at: null, created_at: '', updated_at: '' }]
    });
    const { loadMyDay } = await import('../src/pages/home/index.js');
    await loadMyDay();
    for (const id of ['myDayBody', 'myDayBodyDesktop']) {
      const html = document.getElementById(id)!.innerHTML;
      expect(html).toContain('Точка А');
      expect(html).toContain('SIM:3/5');
      expect(html).toContain('Проверить кассу');
      expect(html).toContain('completeMyTask(9)');
    }
    expect(document.getElementById('myDayStoreHeadDesktop')!.innerHTML).toContain('A1');
  });

  // §P1-E (20.54.0) — shift_text is admin-entered free text (schedule
  // shift label), rendered raw into innerHTML before this fix.
  it('loadMyDay: shift_text экранируется — не исполняемый HTML в DOM', async () => {
    const { getMyDay } = setupGlobals();
    getMyDay.mockResolvedValue({
      bound: true,
      shift: { store_id: 's1', store_name: 'Точка А', store_code: 'A1', store_address: null, color: null, shift_text: '<img src=x onerror=alert(1)>', hours: 8 },
      total: { fact: 0, plan: 0, pct: 0 },
      progress: {},
      tasks: []
    });
    const { loadMyDay } = await import('../src/pages/home/index.js');
    await loadMyDay();
    const el = document.getElementById('myDayBody')!;
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).toContain('&lt;img');
  });

  it('completeMyTask: успех — тостит и перезагружает "Мой день"', async () => {
    const { changeTaskStatus, getMyDay } = setupGlobals();
    const { completeMyTask } = await import('../src/pages/home/index.js');
    await completeMyTask(9);
    expect(changeTaskStatus).toHaveBeenCalledWith(expect.anything(), 9, { status: 'done' });
    expect(getMyDay).toHaveBeenCalled();
  });

  it('loadCommandCenter: без прав аналитики — секция скрыта на мобильном и десктопе, без .insights-panel', async () => {
    setupGlobals({ role: 'employee' });
    const { loadCommandCenter } = await import('../src/pages/home/index.js');
    await loadCommandCenter();
    expect((document.getElementById('commandCenterSection') as HTMLElement).style.display).toBe('none');
    const desktop = document.getElementById('homeDesktopInsights') as HTMLElement;
    expect(desktop.style.display).toBe('none');
    expect(desktop.classList.contains('insights-panel')).toBe(false);
  });

  it('loadCommandCenter: manager, без просадок — "сеть в ритме" на обоих таргетах, .insights-panel добавлен (20.40 — ключ для :has() на 1600px)', async () => {
    setupGlobals({ role: 'manager' });
    const { loadCommandCenter } = await import('../src/pages/home/index.js');
    await loadCommandCenter();
    expect(document.getElementById('commandCenterBody')!.textContent).toContain('сеть в ритме');
    expect(document.getElementById('commandCenterBodyDesktop')!.textContent).toContain('сеть в ритме');
    const desktop = document.getElementById('homeDesktopInsights') as HTMLElement;
    expect(desktop.style.display).toBe('');
    expect(desktop.classList.contains('insights-panel')).toBe(true);
  });

  it('loadCommandCenter: с просадками — рендерит карточки + кнопку переноса на обоих таргетах', async () => {
    const { getSupervisorHealth } = setupGlobals({ role: 'manager' });
    getSupervisorHealth.mockResolvedValue({
      health: 40, overall_pct: 30, pace_delta: -5, date: '2026-08-25',
      drops: [{ severity: 'critical', store_id: 's1', store_name: 'Точка Б', message: 'Просадка MNP', ai_comment: null }]
    });
    const { loadCommandCenter } = await import('../src/pages/home/index.js');
    await loadCommandCenter();
    for (const id of ['commandCenterBody', 'commandCenterBodyDesktop']) {
      const html = document.getElementById(id)!.innerHTML;
      expect(html).toContain('Точка Б');
      expect(html).toContain("proposeMoveForStore('s1')");
    }
  });

  it('loadCommandCenter: ошибка сети — скрывает обе секции и снимает .insights-panel', async () => {
    const { getSupervisorHealth } = setupGlobals({ role: 'manager' });
    getSupervisorHealth.mockRejectedValue(new Error('network'));
    const { loadCommandCenter } = await import('../src/pages/home/index.js');
    await loadCommandCenter();
    const desktop = document.getElementById('homeDesktopInsights') as HTMLElement;
    expect(desktop.style.display).toBe('none');
    expect(desktop.classList.contains('insights-panel')).toBe(false);
  });

  it('loadHome: рендерит приветствие с версией и стрик-бейджем', async () => {
    setupGlobals();
    const { loadHome } = await import('../src/pages/home/index.js');
    await loadHome();
    const html = document.getElementById('greetingCard')!.innerHTML;
    expect(html).toContain('v21.4.0');
    expect(html).toContain('Петров'); // me.full_name.split(' ')[1] — "Фамилия Имя" order
    expect(document.getElementById('headerDate')!.textContent).toBe('25.08.2026');
  });

  // §P1-E (20.54.0) — full_name is admin-entered, rendered raw as the
  // greeting's first name before this fix.
  it('loadHome: приветствие экранирует full_name — не исполняемый HTML в DOM', async () => {
    setupGlobals();
    // No spaces — firstName picks split(' ')[1] || split(' ')[0], so a
    // single space-free payload survives intact into whichever branch wins.
    vi.stubGlobal('me', { employee_id: 1, role: 'employee', full_name: '<img/src=x/onerror=alert(1)>' });
    const { loadHome } = await import('../src/pages/home/index.js');
    await loadHome();
    const el = document.getElementById('greetingCard')!;
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).toContain('&lt;img');
  });

  it('loadHome: топ-7 недоступен без dash — сообщение', async () => {
    const { getDashboard } = setupGlobals();
    getDashboard.mockResolvedValue(null);
    const { loadHome } = await import('../src/pages/home/index.js');
    await loadHome();
    expect(document.getElementById('homeTop')!.textContent).toContain('Топ за 7 дней недоступен');
  });

  it('loadHome: топ-7 из dash.top — рендерит лидеров с медалями на обоих таргетах', async () => {
    const { getDashboard } = setupGlobals();
    getDashboard.mockResolvedValue({ top: [{ employee_id: 3, full_name: 'Ольга', sim: 5, mnp: 2, pa: 1, combo: 0, phones: 0, accessories: 0, score: 8 }], top7: [], period: { from: null, to: '' } });
    const { loadHome } = await import('../src/pages/home/index.js');
    await loadHome();
    for (const id of ['homeTop', 'homeTopDesktop']) {
      const html = document.getElementById(id)!.innerHTML;
      expect(html).toContain('Ольга');
      expect(html).toContain('openEmployeeCard(3)');
    }
  });

  it('loadHome: сетевая статистика зеркалится в desktop-чипы (20.40)', async () => {
    const { getStatsDaily } = setupGlobals();
    getStatsDaily.mockResolvedValue([{ sim: 4, mnp: 1, pa: 2, combo: 0, phones: 3000, accessories: 500 }]);
    const { loadHome } = await import('../src/pages/home/index.js');
    await loadHome();
    expect(document.getElementById('hSim')!.textContent).toBe('4');
    expect(document.getElementById('hSimDesktop')!.textContent).toBe('4');
    expect(document.getElementById('hAccDesktop')!.textContent).toBe('500');
    expect(document.getElementById('networkPulseDesktop')!.innerHTML).toContain('pulse-row');
  });

  it('loadHome: клонирует .row-кнопки из #homeToolsSection в #homeDesktopTools ровно один раз, снимает id у клонов', async () => {
    setupGlobals();
    const { loadHome } = await import('../src/pages/home/index.js');
    await loadHome();
    const target = document.getElementById('homeDesktopTools')!;
    expect(target.children.length).toBe(2);
    expect(target.querySelector('#btnMgrTutorial')).toBeNull(); // id снят — иначе дубль id в DOM
    // Повторный вызов (напр. второй switchPage('home')) не плодит дубликаты.
    await loadHome();
    expect(target.children.length).toBe(2);
  });

  it('bumpStreak: первая продажа за сегодня — стрик 1, повторный вызов в тот же день не увеличивает', async () => {
    setupGlobals();
    const { bumpStreak } = await import('../src/pages/home/index.js');
    expect(bumpStreak()).toBe(1);
    expect(bumpStreak()).toBe(1);
  });

  it('openAbout: рендерит модалку "О приложении" с версией', async () => {
    setupGlobals();
    const { openAbout } = await import('../src/pages/home/index.js');
    openAbout();
    expect(document.getElementById('modalTitle')!.textContent).toBe('О приложении');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('версия 21.4.0');
    expect((globalThis as any).openModal).toHaveBeenCalled();
  });

  it('window.* мост — все 7 функций', async () => {
    setupGlobals();
    await import('../src/pages/home/index.js');
    for (const name of ['loadMyDay', 'completeMyTask', 'commandCenterTone', 'loadCommandCenter', 'loadHome', 'bumpStreak', 'openAbout']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
