/**
 * 20.12.0 (Frontend rewrite kickoff) — jsdom render test for the pilot page.
 * No real browser tool was available to visually verify this in an actual
 * Telegram WebView — this is the strongest verification actually run:
 * real DOM render + a real simulated click, same jsdom approach already
 * used for api-client.test.ts. Telegram-specific behavior (haptics,
 * tg.initData) is out of reach of this test either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { canManage?: boolean; role?: string; effectiveness?: any } = {}) {
  document.body.innerHTML = '<div id="reportsPageBody"></div>';
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'manager', org_id: 'default', full_name: 'Test' });
  vi.stubGlobal('canManage', () => overrides.canManage ?? true);
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('exportCSV', vi.fn());
  const sendNetworkDigest = vi.fn().mockResolvedValue({ ok: true, kind: 'weekly' });
  const getAlertsEffectiveness = vi.fn().mockResolvedValue(
    overrides.effectiveness ?? {
      plan_miss_projected: { with_task: { recovered: 3 }, without_task: { still_missed: 2 } },
      anomaly_vs_forecast: { with_task: {}, without_task: { recurred: 1, recovered: 4 } }
    }
  );
  (window as any).apiClient = { sendNetworkDigest, getAlertsEffectiveness };
  return { sendNetworkDigest, getAlertsEffectiveness };
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

  // Learn (21.x) — сводка "Эффективность рекомендаций" видна только admin,
  // остальные роли (даже manager) её не должны видеть — эндпоинт сам
  // admin-only, секция здесь просто не показывает пустой/403 блок никому лишнему.
  it('admin: секция "Эффективность рекомендаций" рендерится и подгружает реальные данные', async () => {
    const { getAlertsEffectiveness } = setupGlobals({ role: 'admin', canManage: true });
    const { renderReportsPage } = await import('../src/pages/reports/index.js');
    renderReportsPage();
    await Promise.resolve();
    await Promise.resolve();

    const box = document.getElementById('reportsPageBody')!;
    expect(box.textContent).toContain('Эффективность рекомендаций');
    expect(getAlertsEffectiveness).toHaveBeenCalled();
    expect(box.textContent).toContain('С выполненной задачей');
    expect(box.textContent).toContain('исправилось 3');
    expect(box.textContent).toContain('не исправилось 2');
  });

  it('manager (не admin): секции "Эффективность рекомендаций" нет вообще', async () => {
    const { getAlertsEffectiveness } = setupGlobals({ role: 'manager', canManage: true });
    const { renderReportsPage } = await import('../src/pages/reports/index.js');
    renderReportsPage();
    await Promise.resolve();

    const box = document.getElementById('reportsPageBody')!;
    expect(box.textContent).not.toContain('Эффективность рекомендаций');
    expect(getAlertsEffectiveness).not.toHaveBeenCalled();
  });
});
