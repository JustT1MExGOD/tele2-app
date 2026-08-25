/**
 * 21.x (Frontend rewrite continuation) — jsdom render test for the fifth
 * migrated legacy page (frontend/js/16-store-profile.js →
 * src/pages/store-profile), same approach as the earlier migrations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { canManage?: boolean } = {}) {
  document.body.innerHTML = '<div id="storeProfileBody"></div>';
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('canManage', () => overrides.canManage ?? true);
  vi.stubGlobal('commandCenterTone', (score: number) => (score >= 75 ? 'good' : score >= 45 ? 'mid' : 'bad'));
  vi.stubGlobal('metricLabel', (id: string) => ({ sim: 'SIM', mnp: 'MNP', pa: 'ПА', combo: 'Комбо' })[id] || id);
  vi.stubGlobal(
    'progressHTML',
    (label: string, fact: unknown, plan: unknown) => `<div class="progress-item">${label}: ${fact ?? 0}/${plan ?? 0}</div>`
  );
  vi.stubGlobal('openTaskDetail', vi.fn());
  vi.stubGlobal('prompt', vi.fn());

  const getStoreProfile = vi.fn();
  const updateStoreDisplayName = vi.fn().mockResolvedValue({ ok: true });
  (window as any).apiClient = { getStoreProfile, updateStoreDisplayName };
  return { getStoreProfile, updateStoreDisplayName };
}

const FULL_PROFILE = {
  store: {
    store_id: 's1', name: 'Точка А', display_name: 'Моя точка', code: 'A1', color: null,
    staff_count: 3, staff: [{ full_name: 'Иван' }, { name: 'Мария' }]
  },
  today: { metrics: { sim: { fact: 5, plan: 10 }, mnp: { fact: 2, plan: 4 }, pa: { fact: 1, plan: 2 }, combo: { fact: 0, plan: 1 } } },
  trend: [{ date: '2026-08-24', units: 5 }, { date: '2026-08-23', units: 3 }],
  tasks: [{ id: 9, title: 'Проверить остатки', assignee_name: 'Пётр', status: 'open' }],
  alerts: ['Просадка по MNP'],
  health: { score: 80, components: { plan: { value: 70 }, staffing: { value: 100 } } }
};

describe('Профиль точки (миграция frontend/js/16-store-profile.js → src/pages/store-profile)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('openStoreProfile: переключает страницу, НЕ рендерит напрямую', async () => {
    const { getStoreProfile } = setupGlobals();
    const { openStoreProfile } = await import('../src/pages/store-profile/index.js');

    openStoreProfile('s1');

    expect((globalThis as any).switchPage).toHaveBeenCalledWith('store-profile');
    expect(getStoreProfile).not.toHaveBeenCalled();
  });

  it('renderStoreProfilePage: без выбранной точки — no-op, API не зовётся', async () => {
    const { getStoreProfile } = setupGlobals();
    const { renderStoreProfilePage } = await import('../src/pages/store-profile/index.js');

    await renderStoreProfilePage();

    expect(getStoreProfile).not.toHaveBeenCalled();
    expect(document.getElementById('storeProfileBody')!.innerHTML).toBe('');
  });

  it('полный рендер: имя, health-тон, штат, компоненты, метрики дня, тренд, задачи, алерты', async () => {
    const { getStoreProfile } = setupGlobals();
    getStoreProfile.mockResolvedValue(FULL_PROFILE);
    const { openStoreProfile, renderStoreProfilePage } = await import('../src/pages/store-profile/index.js');

    openStoreProfile('s1');
    await renderStoreProfilePage();

    expect(getStoreProfile).toHaveBeenCalledWith(expect.anything(), 's1', '');
    const html = document.getElementById('storeProfileBody')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('cc-health good">80');
    expect(html).toContain('3 на смене сегодня: Иван, Мария');
    expect(html).toContain('План: 70%');
    expect(html).toContain('Штат: 100%');
    expect(html).toContain('SIM: 5/10');
    expect(html).toContain('2026-08-24: 5');
    expect(html).toContain('Проверить остатки');
    expect(html).toContain('openTaskDetail(9)');
    expect(html).toContain('Просадка по MNP');
  });

  it('canManage() — кнопка "Название" видна', async () => {
    const { getStoreProfile } = setupGlobals({ canManage: true });
    getStoreProfile.mockResolvedValue(FULL_PROFILE);
    const { openStoreProfile, renderStoreProfilePage } = await import('../src/pages/store-profile/index.js');
    openStoreProfile('s1');
    await renderStoreProfilePage();
    expect(document.getElementById('storeProfileBody')!.innerHTML).toContain("editStoreDisplayName('s1')");
  });

  it('без canManage() — кнопки "Название" нет', async () => {
    const { getStoreProfile } = setupGlobals({ canManage: false });
    getStoreProfile.mockResolvedValue(FULL_PROFILE);
    const { openStoreProfile, renderStoreProfilePage } = await import('../src/pages/store-profile/index.js');
    openStoreProfile('s1');
    await renderStoreProfilePage();
    expect(document.getElementById('storeProfileBody')!.innerHTML).not.toContain('editStoreDisplayName');
  });

  it('нет тренда с продажами — "Нет продаж за период"; нет задач/алертов — секции не рендерятся', async () => {
    const { getStoreProfile } = setupGlobals();
    getStoreProfile.mockResolvedValue({
      ...FULL_PROFILE,
      trend: [{ date: '2026-08-24', units: 0 }],
      tasks: [],
      alerts: []
    });
    const { openStoreProfile, renderStoreProfilePage } = await import('../src/pages/store-profile/index.js');
    openStoreProfile('s1');
    await renderStoreProfilePage();

    const html = document.getElementById('storeProfileBody')!.innerHTML;
    expect(html).toContain('Нет продаж за период');
    expect(html).not.toContain('Задачи по точке');
    expect(html).not.toContain('Алерты');
  });

  it('ошибка API — не падает, показывает сообщение', async () => {
    const { getStoreProfile } = setupGlobals();
    getStoreProfile.mockRejectedValue(new Error('network'));
    const { openStoreProfile, renderStoreProfilePage } = await import('../src/pages/store-profile/index.js');
    openStoreProfile('s1');
    await renderStoreProfilePage();

    expect(document.getElementById('storeProfileBody')!.textContent).toContain('Не удалось загрузить профиль точки');
  });

  it('editStoreDisplayName: prompt отменён (null) — API не вызывается', async () => {
    const { updateStoreDisplayName } = setupGlobals();
    (globalThis as any).prompt.mockReturnValue(null);
    const { editStoreDisplayName } = await import('../src/pages/store-profile/index.js');

    await editStoreDisplayName('s1');

    expect(updateStoreDisplayName).not.toHaveBeenCalled();
  });

  it('editStoreDisplayName: пустой ввод после trim — отправляет null (сброс кастомного имени)', async () => {
    const { updateStoreDisplayName, getStoreProfile } = setupGlobals();
    getStoreProfile.mockResolvedValue(FULL_PROFILE);
    (globalThis as any).prompt.mockReturnValue('   ');
    const { editStoreDisplayName } = await import('../src/pages/store-profile/index.js');

    await editStoreDisplayName('s1');

    expect(updateStoreDisplayName).toHaveBeenCalledWith(expect.anything(), 's1', null);
    expect((globalThis as any).toast).toHaveBeenCalledWith('Название обновлено', 'ok');
  });

  it('editStoreDisplayName: реальное имя — отправляет trimmed-строку и перерисовывает профиль', async () => {
    const { updateStoreDisplayName, getStoreProfile } = setupGlobals();
    getStoreProfile.mockResolvedValue(FULL_PROFILE);
    (globalThis as any).prompt.mockReturnValue('  Новое имя  ');
    const { openStoreProfile, editStoreDisplayName } = await import('../src/pages/store-profile/index.js');
    openStoreProfile('s1'); // выставляет currentStoreProfileId, чтобы renderStoreProfilePage() внутри не был no-op

    await editStoreDisplayName('s1');

    expect(updateStoreDisplayName).toHaveBeenCalledWith(expect.anything(), 's1', 'Новое имя');
    expect(getStoreProfile).toHaveBeenCalled(); // renderStoreProfilePage() после успеха
  });

  it('editStoreDisplayName: ошибка API — toast err, не бросает исключение', async () => {
    const { updateStoreDisplayName } = setupGlobals();
    updateStoreDisplayName.mockRejectedValue(new Error('boom'));
    (globalThis as any).prompt.mockReturnValue('Имя');
    const { editStoreDisplayName } = await import('../src/pages/store-profile/index.js');

    await editStoreDisplayName('s1');

    expect((globalThis as any).toast).toHaveBeenCalledWith('Ошибка сохранения', 'err');
  });

  it('window.* мост — openStoreProfile/renderStoreProfile/editStoreDisplayName', async () => {
    setupGlobals();
    await import('../src/pages/store-profile/index.js');

    for (const name of ['openStoreProfile', 'renderStoreProfile', 'editStoreDisplayName']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
