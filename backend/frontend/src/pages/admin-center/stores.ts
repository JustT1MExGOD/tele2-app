/**
 * Admin Control Center (20.59.0) — Stores tab: list (org-scoped) +
 * detail with edit / activate / deactivate.
 */
import { confirmDangerousAction } from './shared/dialogs.js';

export async function renderStoresTab(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Точки сети</div>
      <div id="adminStoreList"><div class="skeleton"></div></div>
    </div>
    <div id="adminStoreDetail"></div>
  `;

  document.getElementById('adminStoreList')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-store-id]');
    if (row?.dataset.storeId) renderStoreDetail(row.dataset.storeId);
  });

  await loadStoreList();
}

async function loadStoreList(): Promise<void> {
  const box = document.getElementById('adminStoreList');
  if (!box) return;
  try {
    const res = await window.apiClient.adminListStores(authHeaders(), orgQueryParam());
    if (!res.items.length) {
      box.innerHTML = '<div class="empty">Нет точек</div>';
      return;
    }
    box.innerHTML = res.items
      .map(
        (s) => `
        <button class="row" type="button" data-store-id="${esc(s.id)}">
          <div class="row-body">
            <div class="row-title">${esc(s.display_name || s.name)}</div>
            <div class="row-sub">${esc(s.code)}${s.is_active ? '' : ' · деактивирована'}</div>
          </div>
          <div class="row-chevron">›</div>
        </button>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить точки</div>';
  }
}

async function renderStoreDetail(storeId: string): Promise<void> {
  const box = document.getElementById('adminStoreDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetStore(authHeaders(), storeId);
    const s = d.store;
    box.innerHTML = `
      <div class="section">
        <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>${esc(s.display_name || s.name)}</span>
          <span class="mchip" style="cursor:default">${esc(s.code)}</span>
        </div>
        <div style="padding:0 16px 12px">
          <input type="text" id="storeNameInput" placeholder="Название" value="${esc(s.name)}" style="width:100%;box-sizing:border-box;margin-bottom:8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn-ghost" id="storeSaveName">Сохранить</button>
            ${s.is_active
              ? `<button type="button" class="btn-ghost" id="storeDeactivate">Деактивировать</button>`
              : `<button type="button" class="btn-ghost" id="storeReactivate">Восстановить</button>`}
          </div>
        </div>
      </div>
    `;
    document.getElementById('storeSaveName')?.addEventListener('click', () => onSaveStoreName(storeId));
    document.getElementById('storeDeactivate')?.addEventListener('click', () => onDeactivateStore(storeId));
    document.getElementById('storeReactivate')?.addEventListener('click', () => onReactivateStore(storeId));
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить точку</div>';
  }
}

async function onSaveStoreName(storeId: string): Promise<void> {
  const input = document.getElementById('storeNameInput') as HTMLInputElement | null;
  const name = (input?.value || '').trim();
  if (!name) {
    toast('Укажите название', 'err');
    return;
  }
  try {
    await window.apiClient.adminEditStore(authHeaders(true), storeId, { name });
    toast('Сохранено', 'ok');
    loadStoreList();
    renderStoreDetail(storeId);
  } catch (e) {
    toast('Ошибка сохранения', 'err');
  }
}

async function onDeactivateStore(storeId: string): Promise<void> {
  const reason = await confirmDangerousAction({
    title: 'Деактивировать точку',
    description: 'Точка станет недоступна для новых смен и продаж. Действие обратимо.'
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminDeactivateStore(authHeaders(true), storeId);
    toast('Точка деактивирована', 'ok');
    loadStoreList();
    renderStoreDetail(storeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onReactivateStore(storeId: string): Promise<void> {
  try {
    await window.apiClient.adminReactivateStore(authHeaders(true), storeId);
    toast('Точка восстановлена', 'ok');
    loadStoreList();
    renderStoreDetail(storeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}
