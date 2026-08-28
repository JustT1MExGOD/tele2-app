/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/06c-support-tickets.js file-for-file. История продаж, FAQ/
 * тикеты поддержки, копирование графика на неделю, CSV-экспорты.
 *
 * historyEmployeeFilter is written from OUTSIDE this module (index.html's
 * inline onclick, and frontend/js/05-my-plan.js's onclick template string:
 * `historyEmployeeFilter=${empId};switchPage('history')`) — unlike
 * __taskClientId/__storeProfileDisplayName (private module vars, only ever
 * read within their own file), this one stays a real window property so
 * those still-legacy onclick handlers keep working unmodified.
 *
 * copyScheduleWeek() intentionally stays a raw fetch(), not window.apiClient
 * — found during the 20.7.0 typed-client migration that POST
 * /schedules/copy-week doesn't exist on the backend (always 404s). Not
 * fixing it here: that's a new feature with real schedule-conflict-semantics
 * questions, not a mechanical migration.
 */
import type {
  AdminTicketsListResponse,
  CreateTicketResponse,
  FaqListResponse,
  MyTicketsResponse,
  SalesHistoryResponse
} from '../../../../src/shared/api-types.js';

declare global {
  interface Window {
    historyEmployeeFilter: number | null;
  }
}
window.historyEmployeeFilter = window.historyEmployeeFilter ?? null;

export async function loadHistory(): Promise<void> {
  const box = document.getElementById('historyList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const from = todayMoscow().slice(0, 8) + '01';
    const to = todayMoscow();
    const filter = window.historyEmployeeFilter;
    const empParam = filter ? `&employee_id=${filter}` : '';
    const data: SalesHistoryResponse = await window.apiClient.getSalesHistory(
      authHeaders(),
      `?from=${from}&to=${to}${empParam}${orgQueryParam()}`
    );
    const items = data.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty">Нет продаж за период</div>';
      return;
    }
    box.innerHTML = items
      .map(
        (s) => `
          <div class="row">
            <div class="row-body">
              <div class="row-title">${filter ? esc(s.store_name) : esc(s.full_name)}</div>
              <div class="row-sub">${String(s.sale_date).slice(0, 10)}${filter ? '' : ' · ' + esc(s.store_name)}
                · SIM ${s.sim || 0} · MNP ${s.mnp || 0} · ПА ${s.pa || 0}</div>
            </div>
          </div>
        `
      )
      .join('');
  } catch {
    box.innerHTML = '<div class="empty">Нужна привязка Telegram</div>';
  }
}

export function mondayOf(d: string): string {
  const x = new Date(d + 'T12:00:00');
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x.toISOString().slice(0, 10);
}

export async function copyScheduleWeek(): Promise<void> {
  if (!canManage()) return;
  const from = mondayOf(todayMoscow());
  const toD = new Date(from + 'T12:00:00');
  toD.setDate(toD.getDate() + 7);
  const to = toD.toISOString().slice(0, 10);
  if (!confirm(`Скопировать график ${from} → неделя с ${to}?`)) return;
  const res = await fetch(API + '/schedules/copy-week', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ from_monday: from, to_monday: to })
  });
  if (!res.ok) {
    toast('Ошибка', 'err');
    return;
  }
  const data = await res.json();
  toast('Скопировано смен: ' + (data.copied || 0), 'ok');
}

export async function loadSupport(): Promise<void> {
  const box = document.getElementById('faqList');
  if (box) {
    try {
      const list: FaqListResponse = await window.apiClient.getFaq(authHeaders()).catch(() => []);
      if (!list.length) {
        box.innerHTML = '<div class="empty">FAQ пока пуст</div>';
      } else {
        box.innerHTML = list
          .map(
            (f) => `
            <button class="row" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">
              <div class="row-body"><div class="row-title">${esc(f.question)}</div></div>
              <div class="row-chevron">›</div>
            </button>
            <div class="empty" style="display:none;text-align:left;padding:0 16px 14px;color:var(--text-secondary)">${esc(f.answer)}</div>
          `
          )
          .join('');
      }
    } catch {
      box.innerHTML = '<div class="empty">Не удалось загрузить FAQ</div>';
    }
  }

  const chat = document.getElementById('supportChat');
  if (chat) {
    try {
      const tickets: MyTicketsResponse = await window.apiClient.getMyTickets(authHeaders());
      if (!tickets.length) {
        chat.innerHTML = '<div class="empty" style="padding:8px 0">Пока нет обращений</div>';
      } else {
        chat.innerHTML = tickets
          .slice(0, 8)
          .map(
            (tk) => `
              <div class="progress-block" style="margin-bottom:8px;padding:10px 12px">
                <div style="font-size:12px;color:var(--hint)">#${tk.id} · ${tk.status || ''}</div>
                <div style="font-size:14px;margin:4px 0">${esc(tk.message || '')}</div>
                ${tk.admin_reply ? `<div style="font-size:13px;color:var(--primary);margin-top:6px">↩ ${esc(tk.admin_reply)}</div>` : ''}
              </div>
            `
          )
          .join('');
      }
    } catch (_) {}
  }

  const adm = document.getElementById('adminTicketsSection');
  if (adm && canAdmin()) {
    adm.style.display = '';
    try {
      const list: AdminTicketsListResponse = await window.apiClient.getSupportTickets(authHeaders()).catch(() => []);
      const box2 = document.getElementById('adminTicketsList');
      if (box2) {
        if (!list.length) box2.innerHTML = '<div class="empty">Нет тикетов</div>';
        else
          box2.innerHTML = list
            .map(
              (tk) => `
            <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
              <div class="row-title">#${tk.id} ${esc(tk.full_name || '')}</div>
              <div class="row-sub">${esc(tk.message || '')}</div>
              <button class="btn-main" style="margin-top:4px" onclick="replyTicketPrompt(${tk.id})">Ответить</button>
            </div>
          `
            )
            .join('');
      }
    } catch (_) {}
  } else if (adm) {
    adm.style.display = 'none';
  }
}

export async function replyTicketPrompt(id: number): Promise<void> {
  if (!canAdmin()) {
    toast('Только admin', 'err');
    return;
  }
  const text = prompt('Ответ на тикет #' + id);
  if (!text) return;
  try {
    await window.apiClient.replyTicket(authHeaders(true), id, { reply: text });
  } catch (e) {
    toast('Ошибка', 'err');
    return;
  }
  toast('Ответ отправлен', 'ok');
  loadSupport();
}

export async function sendSupport(): Promise<void> {
  const input = document.getElementById('supportMsg') as HTMLInputElement | HTMLTextAreaElement | null;
  const message = input?.value.trim();
  if (!message) {
    toast('Введите сообщение', 'err');
    return;
  }
  try {
    const data: CreateTicketResponse = await window.apiClient.createSupportTicket(authHeaders(true), {
      message,
      full_name: me?.full_name || tgUser()?.first_name || 'Гость'
    });
    const el = document.getElementById('supportResult');
    if (el) {
      el.style.display = 'block';
      el.textContent = (data as any).auto_reply || (data as any).message || 'Отправлено';
    }
    if (input) input.value = '';
    toast('Отправлено', 'ok');
  } catch {
    toast('Ошибка отправки', 'err');
  }
}

export async function loadManagerTickets(): Promise<void> {
  if (!canAdmin()) return;
  const box = document.getElementById('ticketsBox');
  if (!box) return;
  box.innerHTML = '<div class="section"><div class="section-title">Тикеты</div><div class="skeleton"></div></div>';
  try {
    const list: AdminTicketsListResponse = await window.apiClient.getSupportTickets(authHeaders());
    const open = (list || []).filter((t) => t.status !== 'closed');
    box.innerHTML =
      `<div class="section"><div class="section-title">Тикеты (${open.length})</div>` +
      (open.length
        ? open
            .map(
              (t) => `
            <div class="progress-block" style="margin:8px 12px">
              <div class="row-title">#${t.id} · ${esc(t.full_name || 'Гость')} · ${t.status}</div>
              <div class="row-sub" style="margin:6px 0">${esc(t.message)}</div>
              ${
                t.admin_reply
                  ? `<div class="empty" style="text-align:left">Ответ: ${esc(t.admin_reply)}</div>`
                  : `
              <div class="field"><input id="treply_${t.id}" placeholder="Ответ сотруднику"></div>
              <button class="btn-main" onclick="replyTicket(${t.id})">Ответить в личку</button>`
              }
            </div>`
            )
            .join('')
        : '<div class="empty">Нет открытых</div>') +
      '</div>';
  } catch {
    box.innerHTML = '<div class="empty">Не удалось загрузить тикеты</div>';
  }
}

export async function replyTicket(id: number): Promise<void> {
  const input = document.getElementById('treply_' + id) as HTMLInputElement | null;
  const text = input?.value?.trim();
  if (!text) {
    toast('Введите ответ', 'err');
    return;
  }
  try {
    await window.apiClient.replyTicket(authHeaders(true), id, { reply: text });
  } catch (e) {
    toast('Ошибка', 'err');
    return;
  }
  toast('Ответ отправлен', 'ok');
  loadManagerTickets();
}

export async function exportCSV(type: string): Promise<void> {
  if (!canManage()) {
    toast('Только управляющий', 'err');
    return;
  }
  const month = todayMoscow().slice(0, 7);
  const from = month + '-01';
  const to = todayMoscow();
  let path = '';
  if (type === 'sales') path = `/export/sales.csv?from=${from}&to=${to}`;
  if (type === 'bfq') path = `/export/bfq.csv?month=${month}`;
  if (type === 'schedules') path = `/export/schedules.csv?month=${month}`;
  path += orgQueryParam();
  try {
    const blob = await window.apiClient.exportCsv(authHeaders(), path);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = type + '_' + month + '.csv';
    a.click();
    toast('Скачано', 'ok');
  } catch {
    toast('Ошибка экспорта', 'err');
  }
}

declare global {
  interface Window {
    loadHistory: typeof loadHistory;
    copyScheduleWeek: typeof copyScheduleWeek;
    loadSupport: typeof loadSupport;
    replyTicketPrompt: typeof replyTicketPrompt;
    sendSupport: typeof sendSupport;
    loadManagerTickets: typeof loadManagerTickets;
    replyTicket: typeof replyTicket;
    exportCSV: typeof exportCSV;
  }
}
window.loadHistory = loadHistory;
window.copyScheduleWeek = copyScheduleWeek;
window.loadSupport = loadSupport;
window.replyTicketPrompt = replyTicketPrompt;
window.sendSupport = sendSupport;
window.loadManagerTickets = loadManagerTickets;
window.replyTicket = replyTicket;
window.exportCSV = exportCSV;
