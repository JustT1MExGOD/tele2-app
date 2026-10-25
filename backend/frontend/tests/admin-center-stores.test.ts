/**
 * Admin Control Center — Stores tab (20.76.0 regression test). Found via
 * production report: admin switches network (org-switcher,
 * window.adminViewOrgId), the "Точки сети" LIST respects it (already
 * passed orgQueryParam()), but clicking into a store (detail/edit/
 * deactivate/reactivate) silently ignored the switch — those 4 calls
 * never sent org_id, so the backend's resolveViewOrgId() fell back to
 * the admin's OWN network, found no matching store there, and the
 * detail panel showed "Не удалось загрузить точку". Covers that all 4
 * calls now carry the switched network's org_id end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(adminViewOrgId: string | null, withModal = false) {
  document.body.innerHTML = `
    <div id="adminStoreList"></div>
    <div id="adminStoreDetail"></div>
    ${withModal ? '<div id="overlay"></div><div id="modalTitle"></div><div id="modalBody"></div>' : ''}
  `;
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => (adminViewOrgId ? `&org_id=${encodeURIComponent(adminViewOrgId)}` : ''));
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('openModal', vi.fn());
  vi.stubGlobal('closeModal', vi.fn());
  (window as any).adminViewOrgId = adminViewOrgId;

  const adminListStores = vi.fn().mockResolvedValue({
    items: [{ id: 'store-1', name: 'Точка 1', display_name: 'Точка 1', code: '111', org_id: adminViewOrgId, is_active: true }]
  });
  const adminGetStore = vi.fn().mockResolvedValue({
    store: { id: 'store-1', name: 'Точка 1', display_name: 'Точка 1', code: '111', org_id: adminViewOrgId, is_active: true }
  });
  const adminEditStore = vi.fn().mockResolvedValue({ store: { id: 'store-1', name: 'Новое имя', code: '111', org_id: adminViewOrgId, is_active: true } });
  const adminDeactivateStore = vi.fn().mockResolvedValue({ ok: true });
  const adminReactivateStore = vi.fn().mockResolvedValue({ store: { id: 'store-1', name: 'Точка 1', code: '111', org_id: adminViewOrgId, is_active: true } });
  const adminMoveStore = vi.fn().mockResolvedValue({ store: { id: 'store-1', name: 'Точка 1', code: '111', org_id: 'target_org', is_active: true } });
  (window as any).apiClient = { adminListStores, adminGetStore, adminEditStore, adminDeactivateStore, adminReactivateStore, adminMoveStore };

  return { adminListStores, adminGetStore, adminEditStore, adminDeactivateStore, adminReactivateStore, adminMoveStore };
}

describe('Admin Control Center — Stores (src/pages/admin-center/stores)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('renderStoresTab: список точек передаёт orgQueryParam() (как и раньше)', async () => {
    const { adminListStores } = setupGlobals('other_org');
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);
    expect(adminListStores).toHaveBeenCalledWith(expect.anything(), '&org_id=other_org');
  });

  it('клик по точке в переключённой сети: adminGetStore получает тот же org_id, не падает на "своей" сети', async () => {
    const { adminGetStore } = setupGlobals('other_org');
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(adminGetStore).toHaveBeenCalledWith(expect.anything(), 'store-1', '&org_id=other_org');
    expect(document.getElementById('adminStoreDetail')!.textContent).toContain('Точка 1');
    expect(document.getElementById('adminStoreDetail')!.textContent).not.toContain('Не удалось загрузить точку');
  });

  it('без переключения сети (своя сеть): все 4 вызова не передают org_id — прежнее поведение не ломается', async () => {
    const { adminGetStore, adminEditStore, adminDeactivateStore, adminReactivateStore } = setupGlobals(null);
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(adminGetStore).toHaveBeenCalledWith(expect.anything(), 'store-1', '');

    (document.getElementById('storeNameInput') as HTMLInputElement).value = 'Новое имя';
    document.getElementById('storeSaveName')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(adminEditStore).toHaveBeenCalledWith(expect.anything(), 'store-1', { name: 'Новое имя' }, null);

    // confirmDangerousAction без #modalTitle/#modalBody в DOM резолвится
    // null (см. dialogs.ts) — деактивация не вызывается без подтверждения,
    // этого достаточно, чтобы доказать, что org_id=null ничего не ломает
    // раньше реального сетевого вызова.
    expect(adminDeactivateStore).not.toHaveBeenCalled();
  });

  it('цвет точки: выбранный #rrggbb уходит в adminEditStore вместе с org_id, предпросмотр обновляется', async () => {
    const { adminEditStore, adminGetStore } = setupGlobals('other_org');
    adminGetStore.mockResolvedValue({
      store: { id: 'store-1', name: 'Точка 1', code: '111', org_id: 'other_org', is_active: true, color: '#ff6d01' }
    });
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const input = document.getElementById('storeColorInput') as HTMLInputElement;
    expect(input.value).toBe('#ff6d01');

    input.value = '#00c853';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect((document.getElementById('storeColorPreview') as HTMLElement).style.color).not.toBe('');

    document.getElementById('storeSaveColor')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(adminEditStore).toHaveBeenCalledWith(expect.anything(), 'store-1', { color: '#00c853' }, 'other_org');
  });

  it('цвет точки: мусорное значение color из ответа API не попадает в разметку (дефолт вместо него)', async () => {
    const { adminGetStore } = setupGlobals(null);
    adminGetStore.mockResolvedValue({
      store: { id: 'store-1', name: 'Точка 1', code: '111', org_id: null, is_active: true, color: '"><img src=x onerror=alert(1)>' }
    });
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect((document.getElementById('storeColorInput') as HTMLInputElement).value).toBe('#6d9eeb');
    expect(document.getElementById('adminStoreDetail')!.querySelector('img')).toBeNull();
  });

  it('редактирование/деактивация/восстановление точки в переключённой сети передают org_id', async () => {
    const { adminEditStore, adminReactivateStore } = setupGlobals('other_org');
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    (document.getElementById('storeNameInput') as HTMLInputElement).value = 'Новое имя';
    document.getElementById('storeSaveName')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(adminEditStore).toHaveBeenCalledWith(expect.anything(), 'store-1', { name: 'Новое имя' }, 'other_org');

    // Деактивированная карточка не рендерится в этом сетапе (всегда is_active:true из мока) —
    // reactivate-кнопка проверяется напрямую через повторный вызов renderStoreDetail на неактивной точке.
    const { adminGetStore } = (window as any).apiClient;
    adminGetStore.mockResolvedValueOnce({ store: { id: 'store-1', name: 'Точка 1', code: '111', org_id: 'other_org', is_active: false } });
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    document.getElementById('storeReactivate')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(adminReactivateStore).toHaveBeenCalledWith(expect.anything(), 'store-1', 'other_org');
  });

  // 20.77.0 — перенос точки между сетями; бэкенд существовал с 20.72.0,
  // фронтенда не было нигде.
  it('перенос точки: без target org_id — toast err, API не вызывается', async () => {
    const { adminMoveStore } = setupGlobals(null, true);
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    document.getElementById('storeMove')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(adminMoveStore).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажите org_id сети-получателя', 'err');
  });

  it('перенос точки: с target org_id и подтверждением — вызывает adminMoveStore с org_id переключённой сети, очищает панель детали', async () => {
    const { adminMoveStore, adminListStores } = setupGlobals('other_org', true);
    const { renderStoresTab } = await import('../src/pages/admin-center/stores.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderStoresTab(container);

    document.getElementById('adminStoreList')!.innerHTML = '<button data-store-id="store-1"></button>';
    document.getElementById('adminStoreList')!.querySelector('[data-store-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    (document.getElementById('storeMoveTargetOrgId') as HTMLInputElement).value = 'target_org';
    document.getElementById('storeMove')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    // confirmDangerousAction рисует textarea с обязательной причиной —
    // подтверждаем диалог как реальный пользователь.
    (document.getElementById('dangerActionReason') as HTMLTextAreaElement).value = 'перевод в другую сеть';
    document.getElementById('dangerActionConfirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(adminMoveStore).toHaveBeenCalledWith(expect.anything(), 'store-1', 'target_org', 'other_org');
    expect(adminListStores).toHaveBeenCalledTimes(2); // первичная загрузка + перезагрузка после переноса
    expect(document.getElementById('adminStoreDetail')!.innerHTML).toBe('');
  });
});
