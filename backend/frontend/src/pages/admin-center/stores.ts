/**
 * Admin Control Center (20.59.0) — Stores tab: list (org-scoped) +
 * detail with edit / activate / deactivate.
 */
import { confirmDangerousAction } from './shared/dialogs.js';

// Цвет точки в графике (stores.color). Формат тот же, что валидирует бэкенд
// (PATCH /admin/stores/:id); значение подставляется в inline style, поэтому
// всё, что не #rrggbb, заменяется дефолтом ещё до рендера.
const STORE_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_STORE_COLOR = '#6d9eeb';

function safeStoreColor(value: unknown): string {
  return typeof value === 'string' && STORE_COLOR_RE.test(value) ? value : DEFAULT_STORE_COLOR;
}

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
          <span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;flex:none;background:${safeStoreColor(s.color)}"></span>
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
    const d = await window.apiClient.adminGetStore(authHeaders(), storeId, orgQueryParam());
    const s = d.store;
    const color = safeStoreColor(s.color);
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
        <div style="padding:0 16px 12px;border-top:1px solid var(--border)">
          <div class="row-sub" style="padding:10px 0 6px">Цвет точки в графике</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="color" id="storeColorInput" value="${color}" aria-label="Цвет точки" style="width:44px;height:36px;padding:0;border:none;background:none;cursor:pointer">
            <span id="storeColorPreview" class="mchip" style="cursor:default;background:${color}22;color:${color};border:1px solid ${color}">Пример: 9-21</span>
            <button type="button" class="btn-ghost" id="storeSaveColor">Сохранить цвет</button>
          </div>
        </div>
        <div style="padding:0 16px 12px;border-top:1px solid var(--border)">
          <div class="row-sub" style="padding:10px 0 6px">Перенести точку в другую сеть (в т.ч. другого дилера)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="text" id="storeMoveTargetOrgId" placeholder="org_id сети-получателя" style="flex:1;min-width:160px;box-sizing:border-box">
            <button type="button" class="btn-ghost" id="storeMove">Перенести</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('storeSaveName')?.addEventListener('click', () => onSaveStoreName(storeId));
    document.getElementById('storeColorInput')?.addEventListener('input', (e) => {
      const picked = safeStoreColor((e.target as HTMLInputElement).value);
      const preview = document.getElementById('storeColorPreview');
      if (preview) {
        preview.style.background = `${picked}22`;
        preview.style.color = picked;
        preview.style.borderColor = picked;
      }
    });
    document.getElementById('storeSaveColor')?.addEventListener('click', () => onSaveStoreColor(storeId));
    document.getElementById('storeDeactivate')?.addEventListener('click', () => onDeactivateStore(storeId));
    document.getElementById('storeReactivate')?.addEventListener('click', () => onReactivateStore(storeId));
    document.getElementById('storeMove')?.addEventListener('click', () => onMoveStore(storeId));
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
    await window.apiClient.adminEditStore(authHeaders(true), storeId, { name }, window.adminViewOrgId);
    toast('Сохранено', 'ok');
    loadStoreList();
    renderStoreDetail(storeId);
  } catch (e) {
    toast('Ошибка сохранения', 'err');
  }
}

async function onSaveStoreColor(storeId: string): Promise<void> {
  const input = document.getElementById('storeColorInput') as HTMLInputElement | null;
  const color = (input?.value || '').trim();
  if (!STORE_COLOR_RE.test(color)) {
    toast('Выберите цвет', 'err');
    return;
  }
  try {
    await window.apiClient.adminEditStore(authHeaders(true), storeId, { color }, window.adminViewOrgId);
    toast('Цвет сохранён', 'ok');
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
    await window.apiClient.adminDeactivateStore(authHeaders(true), storeId, window.adminViewOrgId);
    toast('Точка деактивирована', 'ok');
    loadStoreList();
    renderStoreDetail(storeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onReactivateStore(storeId: string): Promise<void> {
  try {
    await window.apiClient.adminReactivateStore(authHeaders(true), storeId, window.adminViewOrgId);
    toast('Точка восстановлена', 'ok');
    loadStoreList();
    renderStoreDetail(storeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

// 20.77.0 — перенос точки между сетями/дилерами; бэкенд существовал с
// 20.72.0, фронтенда не было нигде.
async function onMoveStore(storeId: string): Promise<void> {
  const input = document.getElementById('storeMoveTargetOrgId') as HTMLInputElement | null;
  const toOrgId = (input?.value || '').trim();
  if (!toOrgId) {
    toast('Укажите org_id сети-получателя', 'err');
    return;
  }
  const reason = await confirmDangerousAction({
    title: 'Перенести точку в другую сеть',
    description: `Точка переедет в сеть «${toOrgId}». Все продажи/график/история останутся с точкой.`
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminMoveStore(authHeaders(true), storeId, toOrgId, window.adminViewOrgId);
    toast('Точка перенесена', 'ok');
    loadStoreList();
    // Перенесённая точка больше не в текущей сети — панель детали за ней больше не актуальна.
    document.getElementById('adminStoreDetail')!.innerHTML = '';
  } catch (e: any) {
    toast(e?.message || 'Не удалось перенести точку', 'err');
  }
}
