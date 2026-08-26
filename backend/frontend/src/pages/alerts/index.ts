/**
 * 21.x (Frontend rewrite continuation) — third migrated legacy page,
 * replacing frontend/js/17-alerts.js file-for-file. Unlike promos.js (a
 * standalone modal), this one IS a router.ts "page" — same page-<name> DOM
 * / switchPage() dispatch shape as reports.js (20.12.0): window.loadAlertsPage
 * bridges into the registry so 02-nav-utils.js's loadPage() if-chain keeps
 * calling it completely unchanged.
 *
 * setAlertsFilter/openAlertDetail/changeAlertStatus are bridged onto
 * window.* too — the legacy modal/list HTML calls them back via
 * onclick="..." attribute strings baked into innerHTML. renderAlertDetail
 * is NOT bridged — nothing calls it via an onclick string, only from
 * inside this module (openAlertDetail, changeAlertStatus), so it stays a
 * private helper.
 */
import { registerPage, renderPage } from '../../app/router.js';
import type { AlertItem } from '../../../../src/shared/api-types.js';

let alertsFilter = 'open';

const ALERT_STATUS_LABEL: Record<string, string> = {
  open: 'Новый',
  acked: 'Принят',
  in_progress: 'В работе',
  resolved: 'Решён',
  dismissed: 'Не актуален'
};

const CRITICAL_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>';
const WARN_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>';
const TASK_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg>';

export function setAlertsFilter(f: string): void {
  alertsFilter = f;
  loadAlertsPage();
}

export async function loadAlertsPage(): Promise<void> {
  const box = document.getElementById('alertsPageBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const items: AlertItem[] = await window.apiClient.getAlerts(authHeaders(), alertsFilter, orgQueryParam());

    box.innerHTML = `
      <div class="quick" style="padding:0 16px 10px;flex-wrap:wrap">
        ${['open', 'in_progress', 'resolved', 'dismissed']
          .map(
            (s) =>
              `<button class="${alertsFilter === s ? 'active' : ''}" onclick="setAlertsFilter('${s}')">${ALERT_STATUS_LABEL[s]}</button>`
          )
          .join('')}
      </div>
      <div style="padding:0 16px 16px">
        ${
          items.length
            ? items
                .map(
                  (a) => `
          <button class="row" onclick="openAlertDetail(${a.id})">
            <div class="row-icon">${a.severity === 'critical' ? CRITICAL_ICON : WARN_ICON}</div>
            <div class="row-body">
              <div class="row-title">${esc(a.title)}</div>
              <div class="row-sub">${esc(a.store_name || '')} · ${ALERT_STATUS_LABEL[a.status] || a.status}${a.task_id ? ' · есть задача' : ''}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`
                )
                .join('')
            : '<div class="empty">Нет алертов</div>'
        }
      </div>`;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить алерты</div>';
  }
}

export async function openAlertDetail(id: number): Promise<void> {
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  if (title) title.textContent = 'Алерт';
  if (body) body.innerHTML = '<div class="skeleton"></div>';
  document.getElementById('overlay')?.classList.add('show');
  // Product Analytics (20.34) — открыли ли алерт вообще, не блокирует рендер
  // деталей и не роняет его при сетевой ошибке (та же дисциплина, что
  // announcements/:id/read на фронте).
  window.apiClient.markAlertRead(authHeaders(true), id).catch(() => {});
  await renderAlertDetail(id);
}

async function renderAlertDetail(id: number): Promise<void> {
  const box = document.getElementById('modalBody');
  if (!box) return;
  try {
    const items: AlertItem[] = await window.apiClient.getAlerts(authHeaders(), alertsFilter, orgQueryParam());
    let a: Partial<AlertItem> & { id: number } = items.find((x) => Number(x.id) === Number(id)) as AlertItem;
    if (!a) {
      // элемент мог уже уйти из текущего фильтра (сменился статус) —
      // достаточно контекста, чтобы просто показать кнопки перехода.
      a = { id, title: 'Алерт', status: alertsFilter };
    }

    const next: [string, string][] = [];
    if (a.status !== 'in_progress' && a.status !== 'resolved' && a.status !== 'dismissed') {
      next.push(['in_progress', 'Взять в работу']);
    }
    if (a.status !== 'resolved') next.push(['resolved', 'Решено']);
    if (a.status !== 'dismissed') next.push(['dismissed', 'Не актуально']);

    box.innerHTML = `
      <div class="empty" style="text-align:left;padding:0 0 10px">
        <b>${esc(a.title || '')}</b>${a.body ? '<br>' + esc(a.body) : ''}
      </div>
      <div style="font-size:12px;color:var(--hint);margin-bottom:10px">
        ${esc(a.store_name || '')} · ${ALERT_STATUS_LABEL[a.status || ''] || a.status}${a.created_at ? ' · ' + new Date(a.created_at).toLocaleString('ru') : ''}
      </div>
      ${
        a.task_id
          ? `<button class="row" onclick="openTaskDetail(${a.task_id})">
        <div class="row-icon">${TASK_ICON}</div>
        <div class="row-body"><div class="row-title">Связанная задача</div><div class="row-sub">${a.task_status === 'done' ? 'Выполнена' : 'В работе'}</div></div>
        <div class="row-chevron">›</div>
      </button>`
          : ''
      }
      <div class="quick" style="margin-top:10px">
        ${next.map(([s, label]) => `<button onclick="changeAlertStatus(${a.id}, '${s}', this)">${label}</button>`).join('')}
      </div>
    `;
  } catch (e) {
    box.innerHTML = '<div class="empty">Не удалось загрузить алерт</div>';
  }
}

export async function changeAlertStatus(id: number, status: string, btnEl: HTMLButtonElement | null): Promise<void> {
  if (btnEl?.disabled) return;
  if (btnEl) btnEl.disabled = true;
  try {
    await window.apiClient.changeAlertStatus(authHeaders(true), id, { status });
    toast('Статус обновлён', 'ok');
    await renderAlertDetail(id);
    if (typeof page !== 'undefined' && page === 'alerts') loadAlertsPage();
  } catch (e) {
    toast('Не удалось изменить статус', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

registerPage('alerts', loadAlertsPage);

declare global {
  interface Window {
    loadAlertsPage: () => void;
    setAlertsFilter: typeof setAlertsFilter;
    openAlertDetail: typeof openAlertDetail;
    changeAlertStatus: typeof changeAlertStatus;
  }
}
window.loadAlertsPage = () => {
  renderPage('alerts');
};
window.setAlertsFilter = setAlertsFilter;
window.openAlertDetail = openAlertDetail;
window.changeAlertStatus = changeAlertStatus;
