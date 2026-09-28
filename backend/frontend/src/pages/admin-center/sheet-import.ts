/**
 * Admin Control Center — «Импорт графика из Таблиц»: очередь строк, для
 * которых сопоставление имени из Google Таблицы с сотрудником оказалось
 * неточным (см. core/integrations/sheet-schedule-import.ts). Точные
 * совпадения сюда не попадают — подтверждаются автоматически.
 */
import type { SheetImportPendingRow } from '../../../../src/shared/api-types.js';
import { REPLACEMENT_PLACEHOLDER_STORE_ID } from '../../../../src/shared/replacement.js';

// id сотрудника, найденного через поиск (data-si-search), для строк без готового кандидата — ключ по id pending-строки.
const searchPicks = new Map<number, number>();

export function renderSheetImportTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Импорт графика из Таблиц</div>
      <div class="row-sub" style="padding:0 16px 8px">Строки, для которых имя из таблицы не совпало с сотрудником один-в-один. Точные совпадения применяются сами, сюда не попадают.</div>
      <div id="sheetImportList"></div>
    </div>
  `;

  document.getElementById('sheetImportList')?.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const confirmBtn = target?.closest<HTMLElement>('[data-si-confirm]');
    const rejectBtn = target?.closest<HTMLElement>('[data-si-reject]');
    if (confirmBtn) onConfirm(Number(confirmBtn.dataset.siConfirm));
    if (rejectBtn) onReject(Number(rejectBtn.dataset.siReject));
  });
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  document.getElementById('sheetImportList')?.addEventListener('input', (e) => {
    const input = (e.target as Element | null)?.closest<HTMLInputElement>('[data-si-search]');
    if (!input) return;
    const pendingId = Number(input.dataset.siSearch);
    searchPicks.delete(pendingId);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(pendingId, input), 250);
  });

  loadPending();
}

async function loadPending(): Promise<void> {
  const box = document.getElementById('sheetImportList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminGetSheetImportPending(authHeaders());
    renderList(box, res.items);
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить очередь</div>';
  }
}

function renderList(box: HTMLElement, items: SheetImportPendingRow[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">Очередь пуста — всё сопоставлено</div>';
    return;
  }
  box.innerHTML = items
    .map((r) => {
      const scorePct = r.candidate_score != null ? Math.round(r.candidate_score * 100) : null;
      const candidateHint = r.candidate_full_name
        ? `Похоже на: <b>${esc(r.candidate_full_name)}</b>${scorePct != null ? ` (${scorePct}%)` : ''}`
        : 'Похожего сотрудника не нашлось';
      const storeLabel = r.store_id === REPLACEMENT_PLACEHOLDER_STORE_ID
        ? 'Замена (точка неизвестна)'
        : (r.store_name || 'точка не указана');
      return `
      <div class="row" style="cursor:default;flex-wrap:wrap">
        <div class="row-body">
          <div class="row-title">«${esc(r.sheet_name_raw)}» · ${esc(r.work_date)} · ${esc(r.shift_raw || '—')}</div>
          <div class="row-sub">${esc(storeLabel)} · ${candidateHint}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" data-si-search="${r.id}" placeholder="искать сотрудника…" value="${r.candidate_full_name ? esc(r.candidate_full_name) : ''}" style="max-width:220px">
          <div data-si-search-results="${r.id}" class="row-sub"></div>
          <button type="button" class="btn-main" data-si-confirm="${r.id}">Подтвердить</button>
          <button type="button" class="btn-ghost" data-si-reject="${r.id}">Отклонить</button>
        </div>
      </div>`;
    })
    .join('');
  // кандидат по умолчанию (если был) — сразу доступен для подтверждения без набора текста
  for (const r of items) if (r.candidate_employee_id) searchPicks.set(r.id, r.candidate_employee_id);
}

async function runSearch(pendingId: number, input: HTMLInputElement): Promise<void> {
  const term = input.value.trim();
  const box = document.querySelector<HTMLElement>(`[data-si-search-results="${pendingId}"]`);
  if (!box) return;
  if (term.length < 2) { box.innerHTML = ''; return; }
  try {
    const res = await window.apiClient.adminSearch(authHeaders(), term, '');
    box.innerHTML = res.employees
      .map((e: { id: number; full_name: string }) => `<button type="button" class="btn-ghost" data-si-pick="${pendingId}:${e.id}">${esc(e.full_name)}</button>`)
      .join(' ') || 'ничего не найдено';
    box.querySelectorAll<HTMLElement>('[data-si-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [, empId] = (btn.dataset.siPick || '').split(':');
        searchPicks.set(pendingId, Number(empId));
        input.value = btn.textContent || '';
        box.innerHTML = '';
      });
    });
  } catch (e) {
    console.error(e);
  }
}

async function onConfirm(id: number): Promise<void> {
  const employeeId = searchPicks.get(id) || 0;
  if (!employeeId) {
    toast('Выберите сотрудника', 'err');
    return;
  }
  try {
    await window.apiClient.adminConfirmSheetImportPending(authHeaders(), id, employeeId);
    toast('Подтверждено, применено к графику', 'ok');
    loadPending();
  } catch (e) {
    toast('Ошибка подтверждения', 'err');
  }
}

async function onReject(id: number): Promise<void> {
  try {
    await window.apiClient.adminRejectSheetImportPending(authHeaders(), id);
    toast('Отклонено', 'ok');
    loadPending();
  } catch (e) {
    toast('Ошибка отклонения', 'err');
  }
}
