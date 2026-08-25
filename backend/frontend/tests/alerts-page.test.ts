/**
 * 21.x (Frontend rewrite continuation) — jsdom render test for the third
 * migrated legacy page (frontend/js/17-alerts.js → src/pages/alerts),
 * same approach as reports-page.test.ts/promos.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { page?: string } = {}) {
  document.body.innerHTML = `
    <div id="alertsPageBody"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('page', overrides.page ?? 'alerts');
  vi.stubGlobal('openTaskDetail', vi.fn());

  const getAlerts = vi.fn().mockResolvedValue([]);
  const changeAlertStatus = vi.fn().mockResolvedValue({ ok: true });
  (window as any).apiClient = { getAlerts, changeAlertStatus };
  return { getAlerts, changeAlertStatus };
}

const ALERT_A = {
  id: 42,
  store_id: 's1',
  store_name: 'Точка А',
  alert_type: 'anomaly_vs_forecast',
  severity: 'warn',
  title: 'Точка А: необычно тихий день',
  body: 'Вчера факт заметно ниже типичного',
  status: 'open',
  created_at: '2026-08-20T10:00:00Z',
  task_id: null,
  task_status: null
};

describe('Алерты (миграция frontend/js/17-alerts.js → src/pages/alerts)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadAlertsPage: пустой список — "Нет алертов", таб "Новый" активен по умолчанию', async () => {
    setupGlobals();
    const { loadAlertsPage } = await import('../src/pages/alerts/index.js');
    await loadAlertsPage();

    const box = document.getElementById('alertsPageBody')!;
    expect(box.textContent).toContain('Нет алертов');
    expect(box.innerHTML).toContain('class="active" onclick="setAlertsFilter(\'open\')"');
  });

  it('loadAlertsPage: рендерит title/store/status, "есть задача" только если task_id', async () => {
    const { getAlerts } = setupGlobals();
    getAlerts.mockResolvedValue([ALERT_A, { ...ALERT_A, id: 43, task_id: 7, title: 'С задачей' }]);
    const { loadAlertsPage } = await import('../src/pages/alerts/index.js');
    await loadAlertsPage();

    const html = document.getElementById('alertsPageBody')!.innerHTML;
    expect(html).toContain('Точка А: необычно тихий день');
    expect(html).toContain('Точка А');
    expect(html).toContain('openAlertDetail(42)');
    expect(html).toContain('С задачей');
    expect(html).toContain('есть задача');
  });

  it('loadAlertsPage: severity critical vs warn — разные иконки (M7 18v-6 vs m21.73)', async () => {
    const { getAlerts } = setupGlobals();
    getAlerts.mockResolvedValue([{ ...ALERT_A, severity: 'critical' }]);
    const { loadAlertsPage } = await import('../src/pages/alerts/index.js');
    await loadAlertsPage();

    expect(document.getElementById('alertsPageBody')!.innerHTML).toContain('M7 18v-6a5 5 0 1 1 10 0v6');
  });

  it('loadAlertsPage: ошибка API — не падает, показывает сообщение', async () => {
    const { getAlerts } = setupGlobals();
    getAlerts.mockRejectedValue(new Error('network'));
    const { loadAlertsPage } = await import('../src/pages/alerts/index.js');
    await loadAlertsPage();

    expect(document.getElementById('alertsPageBody')!.textContent).toContain('Не удалось загрузить алерты');
  });

  it('setAlertsFilter: меняет фильтр и перезагружает список тем же вызовом', async () => {
    const { getAlerts } = setupGlobals();
    const { setAlertsFilter } = await import('../src/pages/alerts/index.js');

    (setAlertsFilter as any)('resolved');
    await Promise.resolve();
    await Promise.resolve();

    expect(getAlerts).toHaveBeenLastCalledWith(expect.anything(), 'resolved', '');
  });

  it('openAlertDetail: открывает модалку и рендерит детали алерта', async () => {
    const { getAlerts } = setupGlobals();
    getAlerts.mockResolvedValue([ALERT_A]);
    const { openAlertDetail } = await import('../src/pages/alerts/index.js');

    await (openAlertDetail as any)(42);

    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
    expect(document.getElementById('modalTitle')!.textContent).toBe('Алерт');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('необычно тихий день');
  });

  it('renderAlertDetail: алерт не найден в текущем фильтре — синтезирует заглушку, не падает', async () => {
    const { getAlerts } = setupGlobals();
    getAlerts.mockResolvedValue([]); // 99 не в списке
    const { openAlertDetail } = await import('../src/pages/alerts/index.js');

    await (openAlertDetail as any)(99);

    expect(document.getElementById('modalBody')!.innerHTML).toContain('Алерт');
  });

  it('renderAlertDetail: показывает кнопку задачи только если task_id, и кнопки статусов кроме текущего', async () => {
    const { getAlerts } = setupGlobals();
    getAlerts.mockResolvedValue([{ ...ALERT_A, task_id: 7, task_status: 'open', status: 'in_progress' }]);
    const { openAlertDetail } = await import('../src/pages/alerts/index.js');

    await (openAlertDetail as any)(42);

    const html = document.getElementById('modalBody')!.innerHTML;
    expect(html).toContain('openTaskDetail(7)');
    expect(html).toContain('В работе'); // task_status !== 'done'
    // status уже in_progress — кнопки "Взять в работу" быть не должно
    expect(html).not.toContain("changeAlertStatus(42, 'in_progress'");
    expect(html).toContain("changeAlertStatus(42, 'resolved'");
    expect(html).toContain("changeAlertStatus(42, 'dismissed'");
  });

  it('changeAlertStatus: успех — тостит, перерисовывает деталь, и список ЕСЛИ текущая страница alerts', async () => {
    const { getAlerts, changeAlertStatus } = setupGlobals({ page: 'alerts' });
    getAlerts.mockResolvedValue([ALERT_A]);
    const { changeAlertStatus: changeStatus } = await import('../src/pages/alerts/index.js');
    const btn = document.createElement('button');

    await (changeStatus as any)(42, 'resolved', btn);

    expect(changeAlertStatus).toHaveBeenCalledWith(expect.anything(), 42, { status: 'resolved' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Статус обновлён', 'ok');
    expect(getAlerts).toHaveBeenCalled(); // и renderAlertDetail, и loadAlertsPage дергают getAlerts
    expect(btn.disabled).toBe(false);
  });

  it('changeAlertStatus: НЕ перезагружает список, если текущая страница не alerts', async () => {
    const { getAlerts, changeAlertStatus } = setupGlobals({ page: 'home' });
    getAlerts.mockResolvedValue([ALERT_A]);
    const { changeAlertStatus: changeStatus } = await import('../src/pages/alerts/index.js');

    await (changeStatus as any)(42, 'resolved', null);

    // ровно 1 вызов — только renderAlertDetail, loadAlertsPage НЕ вызван
    expect(getAlerts).toHaveBeenCalledTimes(1);
  });

  it('changeAlertStatus: повторный клик по уже disabled кнопке — no-op', async () => {
    const { changeAlertStatus } = setupGlobals();
    const { changeAlertStatus: changeStatus } = await import('../src/pages/alerts/index.js');
    const btn = document.createElement('button');
    btn.disabled = true;

    await (changeStatus as any)(42, 'resolved', btn);

    expect(changeAlertStatus).not.toHaveBeenCalled();
  });

  it('window.loadAlertsPage bridges to the router — legacy switchPage()/loadPage() dispatch keeps working', async () => {
    setupGlobals();
    await import('../src/pages/alerts/index.js');

    expect(typeof window.loadAlertsPage).toBe('function');
    (window as any).loadAlertsPage();
    await Promise.resolve();
    // просто не падает и реально дошло до рендера — skeleton/ошибка/список
    expect(document.getElementById('alertsPageBody')!.innerHTML).not.toBe('');
  });

  it('все onclick-функции реально висят на window.*', async () => {
    setupGlobals();
    await import('../src/pages/alerts/index.js');

    for (const name of ['loadAlertsPage', 'setAlertsFilter', 'openAlertDetail', 'changeAlertStatus']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
