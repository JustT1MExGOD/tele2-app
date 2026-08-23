/**
 * 20.12.0 (Frontend rewrite kickoff) — jsdom render test for the pilot page.
 * No real browser tool was available to visually verify this in an actual
 * Telegram WebView — this is the strongest verification actually run:
 * real DOM render + a real simulated click, same jsdom approach already
 * used for api-client.test.ts. Telegram-specific behavior (haptics,
 * tg.initData) is out of reach of this test either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { canManage?: boolean } = {}) {
  document.body.innerHTML = '<div id="reportsPageBody"></div>';
  vi.stubGlobal('me', { employee_id: 1, role: 'manager', org_id: 'default', full_name: 'Test' });
  vi.stubGlobal('canManage', () => overrides.canManage ?? true);
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('exportCSV', vi.fn());
  const sendNetworkDigest = vi.fn().mockResolvedValue({ ok: true, kind: 'weekly' });
  (window as any).apiClient = { sendNetworkDigest };
  return { sendNetworkDigest };
}

describe('reports page (pilot: app/router.ts + app/state.ts + features/send-network-digest)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('renders digest/report-image/export sections for a manager', async () => {
    setupGlobals({ canManage: true });
    const { renderReportsPage } = await import('../src/pages/reports/index.js');
    renderReportsPage();

    const box = document.getElementById('reportsPageBody')!;
    expect(box.textContent).toContain('Сводка по сети');
    expect(box.textContent).toContain('Отчёт-картинка');
    expect(box.textContent).toContain('Экспорт CSV');
    expect(box.querySelectorAll('[data-digest-kind]').length).toBe(2);
  });

  it('hides digest buttons + export section for a non-manager, same as the legacy page', async () => {
    setupGlobals({ canManage: false });
    const { renderReportsPage } = await import('../src/pages/reports/index.js');
    renderReportsPage();

    const box = document.getElementById('reportsPageBody')!;
    // Заголовок/описание сводки видны всем (как в легаси) — скрыты только кнопки отправки.
    expect(box.textContent).toContain('Сводка по сети');
    expect(box.querySelectorAll('[data-digest-kind]').length).toBe(0);
    expect(box.textContent).not.toContain('Экспорт CSV');
    // Отчёт-картинка остаётся видна всем — как в легаси-версии
    expect(box.textContent).toContain('Отчёт-картинка');
  });

  it('clicking "Отправить недельную" calls apiClient.sendNetworkDigest and toasts on success', async () => {
    const { sendNetworkDigest } = setupGlobals({ canManage: true });
    const { renderReportsPage } = await import('../src/pages/reports/index.js');
    renderReportsPage();

    const btn = document.querySelector<HTMLButtonElement>('[data-digest-kind="weekly"]')!;
    btn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendNetworkDigest).toHaveBeenCalledWith(expect.anything(), { kind: 'weekly' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Недельная сводка отправлена', 'ok');
  });

  it('window.loadReportsPage bridges to the router — legacy switchPage()/loadPage() dispatch keeps working unchanged', async () => {
    setupGlobals({ canManage: true });
    await import('../src/pages/reports/index.js');

    expect(typeof window.loadReportsPage).toBe('function');
    document.getElementById('reportsPageBody')!.innerHTML = '';
    window.loadReportsPage();
    expect(document.getElementById('reportsPageBody')!.textContent).toContain('Сводка по сети');
  });
});
