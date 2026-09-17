/**
 * Admin Control Center, Phase 4+ (Area B4) — Operations Center. System
 * health across ALL orgs (open alerts + pending access requests) — read
 * only, no ack/approve actions here (see api/routes/admin/operations.ts's
 * header comment). Deliberately distinct from Command Center, which is
 * manager-facing and org-scoped.
 */
export function renderOperationsTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Открытые алерты по всем сетям</div>
      <div id="adminOpsAlertsSummary"></div>
      <div id="adminOpsAlertsList"></div>
    </div>
    <div class="section">
      <div class="section-title">Заявки на доступ по всем сетям</div>
      <div id="adminOpsAccessRequests"></div>
    </div>
  `;
  loadOperations();
}

async function loadOperations(): Promise<void> {
  const summaryBox = document.getElementById('adminOpsAlertsSummary');
  const alertsBox = document.getElementById('adminOpsAlertsList');
  const accessBox = document.getElementById('adminOpsAccessRequests');
  if (!summaryBox || !alertsBox || !accessBox) return;
  alertsBox.innerHTML = '<div class="skeleton"></div>';
  accessBox.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetOperationsOverview(authHeaders());

    summaryBox.innerHTML = Object.entries(d.alerts_by_severity).length
      ? `<div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">${Object.entries(d.alerts_by_severity)
          .map(([sev, count]) => `<span class="mchip">${esc(sev)}: ${esc(String(count))}</span>`)
          .join(' ')}</div>`
      : '';

    alertsBox.innerHTML = d.alerts.length
      ? d.alerts
          .map(
            (a: any) => `
            <div class="row" style="cursor:default">
              <div class="row-body">
                <div class="row-title">${esc(a.title || a.alert_type)}</div>
                <div class="row-sub">${esc(a.store_name || a.store_id || '')} · ${esc(a.severity || '')}</div>
              </div>
            </div>`
          )
          .join('')
      : '<div class="empty">Открытых алертов нет</div>';

    accessBox.innerHTML = d.pending_access_requests.length
      ? d.pending_access_requests
          .map(
            (r: any) => `
            <div class="row" style="cursor:default">
              <div class="row-body">
                <div class="row-title">${esc(r.full_name)}</div>
                <div class="row-sub">${esc(r.effective_org_id || r.org_id || '')}${r.telegram_username ? ' · @' + esc(r.telegram_username) : ''}</div>
              </div>
            </div>`
          )
          .join('')
      : '<div class="empty">Заявок на доступ нет</div>';
  } catch (e) {
    console.error(e);
    alertsBox.innerHTML = '<div class="empty">Не удалось загрузить данные</div>';
    accessBox.innerHTML = '';
  }
}
