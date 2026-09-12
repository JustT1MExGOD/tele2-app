/** Admin Control Center (20.59.0) — Overview tab: real counts only. */
export async function renderOverviewTab(container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetOverview(authHeaders(), orgQueryParam());
    container.innerHTML = `
      <div class="section">
        <div class="section-title">Обзор сети</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;padding:0 16px 16px">
          ${overviewCard('Точки', `${d.stores.active} / ${d.stores.total}`, 'активные / всего')}
          ${overviewCard('Сотрудники', `${d.employees.active} / ${d.employees.total}`, 'активные / всего')}
          ${overviewCard('Смены сегодня', String(d.shifts_today), 'открыто')}
          ${overviewCard('Заявки на доступ', String(d.pending_access_requests), 'в ожидании')}
          ${overviewCard('Обращения поддержки', String(d.open_support_tickets), 'открыто')}
          ${overviewCard('Алерты', String(d.active_alerts), 'активные')}
        </div>
      </div>
    `;
  } catch (e) {
    console.error(e);
    container.innerHTML = '<div class="empty">Не удалось загрузить обзор</div>';
  }
}

function overviewCard(title: string, value: string, sub: string): string {
  return `
    <div class="mchip" style="cursor:default;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px">
      <div style="font-size:12px;color:var(--text-secondary,#8e8e93)">${esc(title)}</div>
      <div style="font-size:20px;font-weight:700">${esc(value)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#8e8e93)">${esc(sub)}</div>
    </div>
  `;
}
