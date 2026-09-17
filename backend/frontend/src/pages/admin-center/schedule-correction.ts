/**
 * Admin Control Center (Phase 4+) — Schedule Corrections tab. Same
 * search → detail → action structure as sales-correction.ts. "Void"
 * here is a hard delete (no restore) — see
 * core/admin/schedule-correction.ts's header comment.
 */
import { confirmDangerousAction, promptFieldCorrection } from './shared/dialogs.js';
import { fetchOrgStores } from '../../app/core.js';
import type { AdminScheduleRow } from '../../../../src/shared/api-types.js';

export function renderScheduleCorrectionTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Поиск строк графика</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="date" id="schedulesFrom" style="flex:1;min-width:120px">
        <input type="date" id="schedulesTo" style="flex:1;min-width:120px">
        <button type="button" class="btn-ghost" id="schedulesSearchBtn">Найти</button>
      </div>
      <div id="adminSchedulesResults"></div>
    </div>
    <div id="adminScheduleDetail"></div>
  `;

  document.getElementById('schedulesSearchBtn')?.addEventListener('click', runSchedulesSearch);
  document.getElementById('adminSchedulesResults')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-schedule-id]');
    if (row?.dataset.scheduleId) renderScheduleDetail(Number(row.dataset.scheduleId));
  });
}

async function runSchedulesSearch(): Promise<void> {
  const box = document.getElementById('adminSchedulesResults');
  if (!box) return;
  const from = (document.getElementById('schedulesFrom') as HTMLInputElement | null)?.value || undefined;
  const to = (document.getElementById('schedulesTo') as HTMLInputElement | null)?.value || undefined;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminSearchSchedules(authHeaders(), orgQueryParam(), { from, to, limit: 100 });
    if (!res.items.length) {
      box.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = res.items
      .map(
        (row) => `
        <button class="row" type="button" data-schedule-id="${esc(String(row.id))}">
          <div class="row-body">
            <div class="row-title">${esc(row.employee_name)} · ${esc(row.store_name)}</div>
            <div class="row-sub">${esc(row.work_date)}${row.shift_text ? ' · ' + esc(row.shift_text) : ''}</div>
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

async function renderScheduleDetail(scheduleId: number): Promise<void> {
  const box = document.getElementById('adminScheduleDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetSchedule(authHeaders(), scheduleId);
    const row = d.row;

    box.innerHTML = `
      <div class="section">
        <div class="section-title">${esc(row.employee_name)} · ${esc(row.store_name)} · ${esc(row.work_date)}</div>
        <div style="padding:0 16px 8px;color:var(--text-secondary,#8e8e93);font-size:13px">
          ${row.shift_text ? esc(row.shift_text) : ''} ${row.hours ? `· ${esc(String(row.hours))} ч` : ''}
        </div>
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="scheduleVoidBtn">Удалить (аннулировать)</button>
          <button type="button" class="btn-ghost" id="scheduleCorrectBtn">Изменить точку/дату/часы</button>
        </div>
      </div>
    `;

    document.getElementById('scheduleVoidBtn')?.addEventListener('click', () => onVoidSchedule(row));
    document.getElementById('scheduleCorrectBtn')?.addEventListener('click', () => onCorrectSchedule(row));
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить строку графика</div>';
  }
}

async function onVoidSchedule(row: AdminScheduleRow): Promise<void> {
  let previewHtml = '';
  try {
    const preview = await window.apiClient.adminPreviewVoidSchedule(authHeaders(true), row.id);
    previewHtml = `<pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(preview, null, 2))}</pre>`;
  } catch (_) {}

  const reason = await confirmDangerousAction({
    title: 'Удалить строку графика',
    description: 'Строка будет безвозвратно удалена. Восстановление невозможно — при необходимости внесите смену заново.',
    previewHtml,
    confirmLabel: 'Удалить'
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminVoidSchedule(authHeaders(true), row.id, row.version, reason);
    toast('Строка графика удалена', 'ok');
    const box = document.getElementById('adminScheduleDetail');
    if (box) box.innerHTML = '';
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}

async function onCorrectSchedule(row: AdminScheduleRow): Promise<void> {
  const stores = await fetchOrgStores();
  const options = stores.map((s: any) => ({ value: s.id, label: `${s.display_name || s.name} (${s.code})` }));

  const result = await promptFieldCorrection({
    title: 'Изменить строку графика',
    fields: [
      { id: 'store_id', label: 'Точка', type: 'select', value: row.store_id, options },
      { id: 'work_date', label: 'Дата', type: 'date', value: row.work_date },
      { id: 'hours', label: 'Часы', type: 'number', value: row.hours ?? '' }
    ]
  });
  if (result === null) return;

  const storeId = result.values.store_id !== row.store_id ? result.values.store_id : undefined;
  const workDate = result.values.work_date !== row.work_date ? result.values.work_date : undefined;
  const hours = result.values.hours !== '' ? Number(result.values.hours) : undefined;
  if (!storeId && !workDate && hours === undefined) return;

  if (workDate) {
    try {
      const preview = await window.apiClient.adminPreviewCorrectSchedule(authHeaders(true), row.id, workDate);
      if (preview.destinationExists) {
        toast('На выбранную дату у этого сотрудника уже есть смена в графике', 'err');
        return;
      }
    } catch (_) {}
  }

  try {
    await window.apiClient.adminCorrectSchedule(authHeaders(true), row.id, row.version, { storeId, workDate, hours }, result.reason);
    toast('Строка графика изменена', 'ok');
    renderScheduleDetail(row.id);
  } catch (e) {
    toast('Ошибка (возможно, версия устарела)', 'err');
  }
}
