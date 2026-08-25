/**
 * 21.x (Frontend rewrite continuation) — jsdom render test for the fourth
 * migrated legacy page (frontend/js/18-employee-profile.js →
 * src/pages/employee-profile), same approach as the earlier migrations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals() {
  document.body.innerHTML = '<div id="employeeProfileBody"></div>';
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('commandCenterTone', (score: number) => (score >= 75 ? 'good' : score >= 45 ? 'mid' : 'bad'));

  const getEmployeeProfile = vi.fn();
  (window as any).apiClient = { getEmployeeProfile };
  return { getEmployeeProfile };
}

const FULL_PROFILE = {
  employee: { id: 5, full_name: 'Иван Петров', short_name: 'Иван', role: 'employee' },
  health: {
    score: 82,
    components: { plan: { value: 90 }, attendance: { value: 100 } }
  },
  gamification: {
    title: 'Профи', level: 4, xp: 320, next_level_xp: 500,
    streak_days: 6, best_shift_score: 95,
    badges: [{ title: 'Первая идеальная смена', badge_code: 'ideal_1' }]
  },
  bfq: { fact: { total: 12 }, forecast: { total: 15 }, shifts: { worked: 8, remaining: 2 } },
  shifts: {
    recent: [
      { date: '2026-08-24', store_name: 'Точка А', score: 80, mood: 4, ideal_shift: true },
      { date: '2026-08-23', store_name: 'Точка Б', score: 40, mood: 2, ideal_shift: false }
    ]
  }
};

describe('Профиль сотрудника (миграция frontend/js/18-employee-profile.js → src/pages/employee-profile)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('openEmployeeProfile: переключает страницу, НЕ рендерит напрямую (нет рекурсии через switchPage)', async () => {
    const { getEmployeeProfile } = setupGlobals();
    const { openEmployeeProfile } = await import('../src/pages/employee-profile/index.js');

    openEmployeeProfile(5);

    expect((globalThis as any).switchPage).toHaveBeenCalledWith('employee-profile');
    expect(getEmployeeProfile).not.toHaveBeenCalled();
  });

  it('renderEmployeeProfilePage: без выбранного сотрудника — ничего не делает, API не зовётся', async () => {
    const { getEmployeeProfile } = setupGlobals();
    const { renderEmployeeProfilePage } = await import('../src/pages/employee-profile/index.js');

    await renderEmployeeProfilePage();

    expect(getEmployeeProfile).not.toHaveBeenCalled();
    expect(document.getElementById('employeeProfileBody')!.innerHTML).toBe('');
  });

  it('полный рендер: имя, health score/тон, компоненты, BFQ, геймификация, бейджи, смены', async () => {
    const { getEmployeeProfile } = setupGlobals();
    getEmployeeProfile.mockResolvedValue(FULL_PROFILE);
    const { openEmployeeProfile, renderEmployeeProfilePage } = await import('../src/pages/employee-profile/index.js');

    openEmployeeProfile(5);
    await renderEmployeeProfilePage();

    expect(getEmployeeProfile).toHaveBeenCalledWith(expect.anything(), 5, '');
    const html = document.getElementById('employeeProfileBody')!.innerHTML;
    expect(html).toContain('Иван Петров');
    expect(html).toContain('cc-health good">82'); // 82 >= 75 -> good
    expect(html).toContain('План: 90%');
    expect(html).toContain('Явка: 100%');
    expect(html).toContain('Факт: 12');
    expect(html).toContain('Прогноз: 15');
    expect(html).toContain('Смены: 8/10');
    expect(html).toContain('XP: 320 / 500');
    expect(html).toContain('6 дн.');
    expect(html).toContain('Лучшая смена: 95');
    expect(html).toContain('Первая идеальная смена');
    expect(html).toContain('Точка А');
    expect(html).toContain('score 80');
    expect(html).toContain('настроение 4/5');
  });

  it('нет закрытых смен — показывает пустое состояние вместо графика/списка', async () => {
    const { getEmployeeProfile } = setupGlobals();
    getEmployeeProfile.mockResolvedValue({ ...FULL_PROFILE, shifts: { recent: [] } });
    const { openEmployeeProfile, renderEmployeeProfilePage } = await import('../src/pages/employee-profile/index.js');

    openEmployeeProfile(5);
    await renderEmployeeProfilePage();

    expect(document.getElementById('employeeProfileBody')!.textContent).toContain('Нет закрытых смен за период');
  });

  it('ошибка API — не падает, показывает сообщение', async () => {
    const { getEmployeeProfile } = setupGlobals();
    getEmployeeProfile.mockRejectedValue(new Error('network'));
    const { openEmployeeProfile, renderEmployeeProfilePage } = await import('../src/pages/employee-profile/index.js');

    openEmployeeProfile(5);
    await renderEmployeeProfilePage();

    expect(document.getElementById('employeeProfileBody')!.textContent).toContain('Не удалось загрузить профиль сотрудника');
  });

  it('window.openEmployeeProfile / window.renderEmployeeProfile — мост для 06-team-bfq.js/14-command-center.js/02-nav-utils.js', async () => {
    const { getEmployeeProfile } = setupGlobals();
    getEmployeeProfile.mockResolvedValue(FULL_PROFILE);
    await import('../src/pages/employee-profile/index.js');

    expect(typeof window.openEmployeeProfile).toBe('function');
    expect(typeof window.renderEmployeeProfile).toBe('function');

    (window as any).openEmployeeProfile(5);
    (window as any).renderEmployeeProfile();
    await Promise.resolve();
    await Promise.resolve();

    expect(getEmployeeProfile).toHaveBeenCalledWith(expect.anything(), 5, '');
  });
});
