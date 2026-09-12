/**
 * Admin Control Center (20.59.0) — Sales Corrections tab.
 *
 * "Sale" here is one (employee, store, date) daily aggregate row, not a
 * per-transaction entity — see the plan's schema-finding note. Void
 * zeroes every metric on the row (reversible), correct-store moves the
 * row to a different store (= org correction, since org attribution is
 * derived from stores.org_id — see AdminSaleCorrectStorePreviewResponse's
 * crossOrg flag and the step-up requirement below).
 */
import { confirmDangerousAction, requestStepUpTicket } from './shared/dialogs.js';
import { fetchOrgStores } from '../../app/core.js';
import type { AdminSaleRow } from '../../../../src/shared/api-types.js';

let lastResults: AdminSaleRow[] = [];

export function renderSalesCorrectionTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Поиск строк продаж</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="date" id="salesFrom" style="flex:1;min-width:120px">
        <input type="date" id="salesTo" style="flex:1;min-width:120px">
        <label style="display:flex;align-items:center;gap:4px;font-size:13px">
          <input type="checkbox" id="salesIncludeVoided"> показывать аннулированные
        </label>
        <button type="button" class="btn-ghost" id="salesSearchBtn">Найти</button>
      </div>
      <div id="adminSalesResults"></div>
    </div>
    <div id="adminSaleDetail"></div>
  `;

  document.getElementById('salesSearchBtn')?.addEventListener('click', runSalesSearch);
  document.getElementById('adminSalesResults')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-sale-id]');
    if (row?.dataset.saleId) renderSaleDetail(row.dataset.saleId);
  });
}

async function runSalesSearch(): Promise<void> {
  const box = document.getElementById('adminSalesResults');
  if (!box) return;
  const from = (document.getElementById('salesFrom') as HTMLInputElement | null)?.value || undefined;
  const to = (document.getElementById('salesTo') as HTMLInputElement | null)?.value || undefined;
  const includeVoided = (document.getElementById('salesIncludeVoided') as HTMLInputElement | null)?.checked || false;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminSearchSales(authHeaders(), orgQueryParam(), { from, to, includeVoided, limit: 100 });
    lastResults = res.items;
    if (!res.items.length) {
      box.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = res.items
      .map(
        (row) => `
        <button class="row" type="button" data-sale-id="${esc(row.id)}">
          <div class="row-body">
            <div class="row-title">${esc(row.employee_name)} · ${esc(row.store_name)}</div>
            <div class="row-sub">${esc(row.sale_date)}${row.voided_at ? ' · аннулировано' : ''}</div>
          </div>
          <div class="row-chevron">›</div>
        </button>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Ошибка поиска</div>';
  }
}

async function renderSaleDetail(saleId: string): Promise<void> {
  const box = document.getElementById('adminSaleDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetSale(authHeaders(), saleId);
    const row = d.row;
    const metrics = Object.entries(row)
      .filter(([k, v]) => !['id', 'employee_id', 'store_id', 'sale_date', 'employee_name', 'store_name', 'voided_at', 'voided_by', 'void_reason', 'version'].includes(k) && typeof v === 'number')
      .map(([k, v]) => `<span class="mchip" style="cursor:default">${esc(k)}: ${esc(String(v))}</span>`)
      .join(' ');

    box.innerHTML = `
      <div class="section">
        <div class="section-title">${esc(row.employee_name)} · ${esc(row.store_name)} · ${esc(row.sale_date)}</div>
        <div style="padding:0 16px 8px;display:flex;gap:6px;flex-wrap:wrap">${metrics || '<span class="empty">нет метрик</span>'}</div>
        ${row.voided_at ? `<div style="padding:0 16px 8px;color:var(--text-secondary,#8e8e93);font-size:13px">Аннулировано: ${esc(row.void_reason || '')}</div>` : ''}
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap">
          ${row.voided_at
            ? `<button type="button" class="btn-ghost" id="saleRestoreBtn">Восстановить</button>`
            : `<button type="button" class="btn-ghost" id="saleVoidBtn">Аннулировать</button>
               <button type="button" class="btn-ghost" id="saleCorrectStoreBtn">Изменить точку</button>`}
        </div>
      </div>
    `;

    document.getElementById('saleVoidBtn')?.addEventListener('click', () => onVoidSale(row));
    document.getElementById('saleRestoreBtn')?.addEventListener('click', () => onRestoreSale(row));
    document.getElementById('saleCorrectStoreBtn')?.addEventListener('click', () => onCorrectStore(row));
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить строку</div>';
  }
}

async function onVoidSale(row: AdminSaleRow): Promise<void> {
  let previewHtml = '';
  try {
    const preview = await window.apiClient.adminPreviewVoidSale(authHeaders(true), row.id);
    previewHtml = `<pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(preview.metrics, null, 2))}</pre>`;
  } catch (_) {}

  const reason = await confirmDangerousAction({
    title: 'Аннулировать строку продаж',
    description: 'Все метрики этой строки будут обнулены. Действие обратимо через "Восстановить".',
    previewHtml
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminVoidSale(authHeaders(true), row.id, row.version, reason);
    toast('Строка аннулирована', 'ok');
    renderSaleDetail(row.id);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}

async function onRestoreSale(row: AdminSaleRow): Promise<void> {
  const reason = await confirmDangerousAction({
    title: 'Восстановить строку продаж',
    description: 'Значения метрик будут возвращены к состоянию до аннулирования.',
    confirmLabel: 'Восстановить'
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminRestoreSale(authHeaders(true), row.id, row.version, reason);
    toast('Строка восстановлена', 'ok');
    renderSaleDetail(row.id);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}

async function onCorrectStore(row: AdminSaleRow): Promise<void> {
  const stores = await fetchOrgStores();
  const options = stores
    .filter((s: any) => s.id !== row.store_id)
    .map((s: any) => `<option value="${esc(s.id)}">${esc(s.display_name || s.name)} (${esc(s.code)})</option>`)
    .join('');

  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  if (!modalTitle || !modalBody) return;
  modalTitle.textContent = 'Изменить точку строки продаж';
  modalBody.innerHTML = `
    <div class="section" style="padding:0">
      <div style="padding:0 16px 8px">
        <select id="correctStoreSelect" style="width:100%">${options}</select>
      </div>
      <div style="padding:0 16px;display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn-ghost" id="correctStoreCancel">Отмена</button>
        <button type="button" class="btn-main" id="correctStoreNext">Далее</button>
      </div>
    </div>
  `;
  document.getElementById('correctStoreCancel')?.addEventListener('click', () => closeModal());
  document.getElementById('correctStoreNext')?.addEventListener('click', async () => {
    const select = document.getElementById('correctStoreSelect') as HTMLSelectElement | null;
    const newStoreId = select?.value;
    if (!newStoreId) return;
    closeModal();

    let crossOrg = false;
    try {
      const preview = await window.apiClient.adminPreviewCorrectStore(authHeaders(true), row.id, newStoreId);
      crossOrg = preview.crossOrg;
    } catch (_) {}

    const reason = await confirmDangerousAction({
      title: 'Подтвердить смену точки',
      description: crossOrg
        ? 'Внимание: новая точка относится к другой сети. Потребуется MFA-подтверждение.'
        : 'Строка будет перенесена на выбранную точку.',
      confirmLabel: 'Перенести'
    });
    if (reason === null) return;

    let stepUpToken: string | undefined;
    if (crossOrg) {
      const ticket = await requestStepUpTicket();
      if (!ticket) return;
      stepUpToken = ticket;
    }

    try {
      await window.apiClient.adminCorrectSaleStore(authHeaders(true), row.id, row.version, newStoreId, reason, stepUpToken);
      toast('Точка изменена', 'ok');
      renderSaleDetail(row.id);
    } catch (e) {
      toast('Ошибка (возможно, версия устарела)', 'err');
    }
  });
  if (typeof openModal === 'function') openModal();
}
