/**
 * Admin Control Center (20.59.0) — shell. Tabs: Overview / Employees /
 * Stores / Sales Corrections / Audit. Dispatch into #adminCenterBody via
 * a delegated [data-admin-tab] click listener (see app/nav.ts's
 * [data-page-trigger] precedent) — no inline onclick=, zero headroom on
 * check-inline-event-handlers.mjs's baseline.
 *
 * Deferred, not built this pass (named in the final report): a separate
 * Sessions & Security tab (folded into Employee Detail — backend routes
 * are employee-scoped only), a Ctrl+K global search palette (no bulk
 * employee-list route exists, only /admin/search with a 2-char minimum),
 * an org-switcher UI (existing switchAdminOrg()/window.adminViewOrgId
 * mechanism from pages/team/index.ts could be reused later).
 */
import { registerPage, renderPage } from '../../app/router.js';
import { renderOverviewTab } from './overview.js';
import { renderEmployeesTab } from './employees.js';
import { renderStoresTab } from './stores.js';
import { renderSalesCorrectionTab } from './sales-correction.js';
import { renderAuditTab } from './audit.js';

type AdminTab = 'overview' | 'employees' | 'stores' | 'sales' | 'audit';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'stores', label: 'Точки' },
  { id: 'sales', label: 'Коррекции продаж' },
  { id: 'audit', label: 'Аудит' }
];

let currentTab: AdminTab = 'overview';
let wired = false;

export async function renderAdminCenterPage(): Promise<void> {
  if (!canAdmin()) {
    switchPage('home');
    return;
  }

  const tabsBox = document.getElementById('adminCenterTabs');
  const body = document.getElementById('adminCenterBody');
  if (!tabsBox || !body) return;

  tabsBox.innerHTML = TABS.map(
    (t) => `<button type="button" class="btn-ghost${t.id === currentTab ? ' active' : ''}" data-admin-tab="${t.id}">${esc(t.label)}</button>`
  ).join('');

  if (!wired) {
    wired = true;
    tabsBox.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-admin-tab]');
      const tab = btn?.dataset.adminTab as AdminTab | undefined;
      if (tab) {
        currentTab = tab;
        renderAdminCenterPage();
      }
    });
  }

  await renderTabBody(body);
}

async function renderTabBody(body: HTMLElement): Promise<void> {
  switch (currentTab) {
    case 'overview':
      await renderOverviewTab(body);
      break;
    case 'employees':
      renderEmployeesTab(body);
      break;
    case 'stores':
      await renderStoresTab(body);
      break;
    case 'sales':
      renderSalesCorrectionTab(body);
      break;
    case 'audit':
      await renderAuditTab(body);
      break;
  }
}

registerPage('admin-center', renderAdminCenterPage);

declare global {
  interface Window {
    renderAdminCenter: () => void;
  }
}
window.renderAdminCenter = () => {
  renderPage('admin-center');
};
