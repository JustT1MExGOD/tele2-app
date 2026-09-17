/**
 * Admin Control Center (Phase 4+) — Shift Corrections tab. Same
 * search → detail → action structure as sales-correction.ts. Void is
 * only offered for closed/auto_closed sessions — open shifts cannot be
 * voided (see core/admin/shift-correction.ts's VOIDABLE_STATUSES).
 */
import { confirmDangerousAction, requestStepUpTicket, promptFieldCorrection } from './shared/dialogs.js';
import { fetchOrgStores } from '../../app/core.js';
import type { AdminShiftRow } from '../../../../src/shared/api-types.js';

export function renderShiftCorrectionTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Поиск смен</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="date" id="shiftsFrom" style="flex:1;min-width:120px">
        <input type="date" id="shiftsTo" style="flex:1;min-width:120px">
        <label style="display:flex;align-items:center;gap:4px;font-size:13px">
          <input type="checkbox" id="shiftsIncludeVoided"> показывать аннулированные
        </label>
        <button type="button" class="btn-ghost" id="shiftsSearchBtn">Найти</button>
      </div>
      <div id="adminShiftsResults"></div>
    </div>
    <div id="adminShiftDetail"></div>
  `;

  document.getElementById('shiftsSearchBtn')?.addEventListener('click', runShiftsSearch);
  document.getElementById('adminShiftsResults')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-shift-id]');
    if (row?.dataset.shiftId) renderShiftDetail(Number(row.dataset.shiftId));
  });
}

async function runShiftsSearch(): Promise<void> {
  const box = document.getElementById('adminShiftsResults');
  if (!box) return;
  const from = (document.getElementById('shiftsFrom') as HTMLInputElement | null)?.value || undefined;
  const to = (document.getElementById('shiftsTo') as HTMLInputElement | null)?.value || undefined;
  const includeVoided = (document.getElementById('shiftsIncludeVoided') as HTMLInputElement | null)?.checked || false;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminSearchShifts(authHeaders(), orgQueryParam(), { from, to, includeVoided, limit: 100 });
    if (!res.items.length) {
      box.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = res.items
      .map(
        (row) => `
        <button class="row" type="button" data-shift-id="${esc(String(row.id))}">
          <div class="row-body">
            <div class="row-title">${esc(row.employee_name)} · ${esc(row.store_name)}</div>
            <div class="row-sub">${esc(row.work_date)} · ${esc(row.status)}${row.voided_at ? ' · аннулировано' : ''}</div>
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

async function renderShiftDetail(shiftId: number): Promise<void> {
  const box = document.getElementById('adminShiftDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetShift(authHeaders(), shiftId);
    const row = d.row;
    const canVoid = !row.voided_at && (row.status === 'closed' || row.status === 'auto_closed');

    box.innerHTML = `
      <div class="section">
        <div class="section-title">${esc(row.employee_name)} · ${esc(row.store_name)} · ${esc(row.work_date)}</div>
        <div style="padding:0 16px 8px;color:var(--text-secondary,#8e8e93);font-size:13px">Статус: ${esc(row.status)}</div>
        ${row.voided_at ? `<div style="padding:0 16px 8px;color:var(--text-secondary,#8e8e93);font-size:13px">Аннулировано: ${esc(row.void_reason || '')}</div>` : ''}
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap">
          ${row.voided_at
            ? `<button type="button" class="btn-ghost" id="shiftRestoreBtn">Восстановить</button>`
            : canVoid
              ? `<button type="button" class="btn-ghost" id="shiftVoidBtn">Аннулировать</button>
                 <button type="button" class="btn-ghost" id="shiftCorrectBtn">Изменить точку/дату</button>`
              : `<span style="font-size:13px;color:var(--text-secondary,#8e8e93)">Смена ещё открыта — аннулировать можно только закрытую смену</span>
                 <button type="button" class="btn-ghost" id="shiftCorrectBtn">Изменить точку/дату</button>`}
        </div>
      </div>
    `;

    document.getElementById('shiftVoidBtn')?.addEventListener('click', () => onVoidShift(row));
    document.getElementById('shiftRestoreBtn')?.addEventListener('click', () => onRestoreShift(row));
    document.getElementById('shiftCorrectBtn')?.addEventListener('click', () => onCorrectShift(row));
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить смену</div>';
  }
}

async function onVoidShift(row: AdminShiftRow): Promise<void> {
  let previewHtml = '';
  try {
    const preview = await window.apiClient.adminPreviewVoidShift(authHeaders(true), row.id);
    previewHtml = `<pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(preview, null, 2))}</pre>`;
  } catch (_) {}

  const reason = await confirmDangerousAction({
    title: 'Аннулировать смену',
    description: 'Смена будет помечена как аннулированная. Действие обратимо через "Восстановить".',
    previewHtml
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminVoidShift(authHeaders(true), row.id, row.version, reason);
    toast('Смена аннулирована', 'ok');
    renderShiftDetail(row.id);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}

async function onRestoreShift(row: AdminShiftRow): Promise<void> {
  const reason = await confirmDangerousAction({
    title: 'Восстановить смену',
    description: 'Смена будет возвращена в исходное состояние.',
    confirmLabel: 'Восстановить'
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminRestoreShift(authHeaders(true), row.id, row.version, reason);
    toast('Смена восстановлена', 'ok');
    renderShiftDetail(row.id);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}

async function onCorrectShift(row: AdminShiftRow): Promise<void> {
  const stores = await fetchOrgStores();
  const options = stores.map((s: any) => ({ value: s.id, label: `${s.display_name || s.name} (${s.code})` }));

  const result = await promptFieldCorrection({
    title: 'Изменить точку/дату смены',
    fields: [
      { id: 'store_id', label: 'Точка', type: 'select', value: row.store_id, options },
      { id: 'work_date', label: 'Дата', type: 'date', value: row.work_date }
    ]
  });
  if (result === null) return;

  const newStoreId = result.values.store_id !== row.store_id ? result.values.store_id : undefined;
  const workDate = result.values.work_date !== row.work_date ? result.values.work_date : undefined;
  if (!newStoreId && !workDate) return;

  let crossOrg = false;
  if (newStoreId) {
    try {
      const preview = await window.apiClient.adminPreviewCorrectShift(authHeaders(true), row.id, newStoreId);
      crossOrg = preview.crossOrg;
    } catch (_) {}
  }

  let stepUpToken: string | undefined;
  if (crossOrg) {
    const ticket = await requestStepUpTicket();
    if (!ticket) return;
    stepUpToken = ticket;
  }

  try {
    await window.apiClient.adminCorrectShift(authHeaders(true), row.id, row.version, { newStoreId, workDate }, result.reason, stepUpToken);
    toast('Смена изменена', 'ok');
    renderShiftDetail(row.id);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}
