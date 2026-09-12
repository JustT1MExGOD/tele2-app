/**
 * Admin Control Center (20.59.0) — Audit tab. Thin wrapper around the
 * already-existing GET /audit route/features/admin/api.ts's
 * getAuditLog — no new backend surface needed here.
 */
import { getAuditLog } from '../../features/admin/api.js';

export async function renderAuditTab(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Журнал действий</div>
      <div style="padding:0 16px 8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="auditActionFilter" placeholder="action" style="flex:1;min-width:120px">
        <input type="text" id="auditTargetTypeFilter" placeholder="тип цели" style="flex:1;min-width:120px">
        <input type="date" id="auditFrom">
        <input type="date" id="auditTo">
        <button type="button" class="btn-ghost" id="auditSearchBtn">Найти</button>
      </div>
      <div id="adminAuditResults"><div class="skeleton"></div></div>
    </div>
  `;

  document.getElementById('auditSearchBtn')?.addEventListener('click', runAuditSearch);
  await runAuditSearch();
}

async function runAuditSearch(): Promise<void> {
  const box = document.getElementById('adminAuditResults');
  if (!box) return;
  const action = (document.getElementById('auditActionFilter') as HTMLInputElement | null)?.value.trim() || undefined;
  const targetType = (document.getElementById('auditTargetTypeFilter') as HTMLInputElement | null)?.value.trim() || undefined;
  const from = (document.getElementById('auditFrom') as HTMLInputElement | null)?.value || undefined;
  const to = (document.getElementById('auditTo') as HTMLInputElement | null)?.value || undefined;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await getAuditLog(authHeaders(), orgQueryParam(), { action, targetType, from, to, limit: 100 });
    if (!res.items.length) {
      box.innerHTML = '<div class="empty">Записей не найдено</div>';
      return;
    }
    box.innerHTML = res.items
      .map(
        (item) => `
        <div class="row" style="cursor:default">
          <div class="row-body">
            <div class="row-title">${esc(item.action)} · ${esc(item.target_type)}${item.target_id ? ' #' + esc(item.target_id) : ''}</div>
            <div class="row-sub">${esc(item.actor_name || 'система')}${item.actor_role ? ' (' + esc(item.actor_role) + ')' : ''}</div>
          </div>
        </div>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
  }
}
