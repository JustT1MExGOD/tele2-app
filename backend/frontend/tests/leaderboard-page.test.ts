/**
 * «Топы сотрудников» (20.75.0) — jsdom render test for
 * src/pages/leaderboard (прогресс-бары по каждой метрике каталога).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals() {
  document.body.innerHTML = `
    <input type="date" id="lbFrom">
    <input type="date" id="lbTo">
    <div id="leaderboardMetricTabs"></div>
    <div id="leaderboardBody"></div>
  `;
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('todayMoscow', () => '2026-06-15');
  vi.stubGlobal('toast', vi.fn());
  (window as any).METRICS = [
    { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'шт' },
    { id: 'accessories', label: 'Аксессуары', short_label: 'Аксы', unit: '₽' }
  ];

  const getLeaderboard = vi.fn().mockResolvedValue({
    metric: { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
    from: '2026-06-01',
    to: '2026-06-15',
    items: []
  });
  (window as any).apiClient = { getLeaderboard };
  return { getLeaderboard };
}

describe('Топы сотрудников (src/pages/leaderboard)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadLeaderboard: заполняет период по умолчанию (1-е число месяца → сегодня) и грузит первую метрику каталога', async () => {
    const { getLeaderboard } = setupGlobals();
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    expect((document.getElementById('lbFrom') as HTMLInputElement).value).toBe('2026-06-01');
    expect((document.getElementById('lbTo') as HTMLInputElement).value).toBe('2026-06-15');
    expect(getLeaderboard).toHaveBeenCalledWith(expect.anything(), '', 'sim', '2026-06-01', '2026-06-15');
    const tabsHtml = document.getElementById('leaderboardMetricTabs')!.innerHTML;
    expect(tabsHtml).toContain('SIM');
    expect(tabsHtml).toContain('Аксессуары');
  });

  it('loadLeaderboard: рендерит прогресс-бары — топ-1 100% ширины, остальные относительно него', async () => {
    const { getLeaderboard } = setupGlobals();
    getLeaderboard.mockResolvedValue({
      metric: { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
      from: '2026-06-01',
      to: '2026-06-15',
      items: [
        { rank: 1, employee_id: 1, full_name: 'Лидер', value: 10 },
        { rank: 2, employee_id: 2, full_name: 'Второй', value: 5 }
      ]
    });
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    const body = document.getElementById('leaderboardBody')!;
    expect(body.textContent).toContain('Лидер');
    expect(body.textContent).toContain('Второй');
    const bars = body.querySelectorAll('.bar > i');
    expect(bars[0].getAttribute('style')).toContain('width:100%');
    expect(bars[1].getAttribute('style')).toContain('width:50%');
  });

  it('loadLeaderboard: метрика с unit=money показывает суффикс ₽', async () => {
    const { getLeaderboard } = setupGlobals();
    getLeaderboard.mockResolvedValue({
      metric: { id: 'accessories', label: 'Аксессуары', short_label: 'Аксы', unit: 'money' },
      from: '2026-06-01',
      to: '2026-06-15',
      items: [{ rank: 1, employee_id: 1, full_name: 'Лидер', value: 1000 }]
    });
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    expect(document.getElementById('leaderboardBody')!.textContent).toContain('1000 ₽');
  });

  it('loadLeaderboard: пустой топ — сообщение "Пока нет продаж"', async () => {
    setupGlobals();
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    expect(document.getElementById('leaderboardBody')!.textContent).toContain('Пока нет продаж');
  });

  it('смена метрики (клик по вкладке) перезапрашивает данные с новым metric', async () => {
    const { getLeaderboard } = setupGlobals();
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    getLeaderboard.mockClear();

    const accessoriesTab = Array.from(document.querySelectorAll('#leaderboardMetricTabs button')).find((b) => b.textContent === 'Аксессуары') as HTMLElement;
    accessoriesTab.click();
    // click handler сам await'ит loadLeaderboard() асинхронно — даём микротаскам прокрутиться
    await Promise.resolve();
    await Promise.resolve();

    expect(getLeaderboard).toHaveBeenCalledWith(expect.anything(), '', 'accessories', '2026-06-01', '2026-06-15');
    // tabsBox.innerHTML был перерисован внутри loadLeaderboard() —
    // исходный узел accessoriesTab больше не в DOM, перезапрашиваем.
    const refreshedTab = Array.from(document.querySelectorAll('#leaderboardMetricTabs button')).find((b) => b.textContent === 'Аксессуары') as HTMLElement;
    expect(refreshedTab.className).toContain('active');
  });

  it('смена периода (изменение даты) перезапрашивает данные с новым диапазоном', async () => {
    const { getLeaderboard } = setupGlobals();
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    getLeaderboard.mockClear();

    const fromInput = document.getElementById('lbFrom') as HTMLInputElement;
    fromInput.value = '2026-06-10';
    fromInput.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(getLeaderboard).toHaveBeenCalledWith(expect.anything(), '', 'sim', '2026-06-10', '2026-06-15');
  });

  // 20.49.0-дисциплина (Web Security & Trust Layer) — имя сотрудника с
  // onmouseover-инъекцией не должно разорвать атрибут/вставить обработчик.
  it('имя сотрудника с " onmouseover=... не разрывает рендер — XSS-регресс', async () => {
    const { getLeaderboard } = setupGlobals();
    const payload = `x" onmouseover="window.__pwned=1`;
    getLeaderboard.mockResolvedValue({
      metric: { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'count' },
      from: '2026-06-01',
      to: '2026-06-15',
      items: [{ rank: 1, employee_id: 1, full_name: payload, value: 10 }]
    });
    const { loadLeaderboard } = await import('../src/pages/leaderboard/index.js');
    await loadLeaderboard();
    const body = document.getElementById('leaderboardBody')!;
    const elements = Array.from(body.querySelectorAll('*'));
    for (const el of elements) {
      expect(el.hasAttribute('onmouseover')).toBe(false);
    }
    expect((window as any).__pwned).toBeUndefined();
    expect(body.textContent).toContain(payload);
  });

  it('window.* мост — loadLeaderboard', async () => {
    setupGlobals();
    await import('../src/pages/leaderboard/index.js');
    expect(typeof (window as any).loadLeaderboard).toBe('function');
  });
});
