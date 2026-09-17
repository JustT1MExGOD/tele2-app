/**
 * Admin Control Center, Phase 4+ (Area B2) — Org Settings/Branding.
 * Surfaces the existing branding routes (GET /orgs, PUT /admin/org/:id) —
 * no new backend, reuses features/admin/api.ts's getOrgsAdmin/saveOrg,
 * already exposed on window.apiClient (see app/api-bridge.ts).
 */
import type { OrgAdminItem } from '../../../../src/shared/api-types.js';

let lastOrgs: OrgAdminItem[] = [];

export function renderOrgSettingsTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Сети</div>
      <div id="adminOrgsList"></div>
    </div>
    <div id="adminOrgDetail"></div>
  `;

  document.getElementById('adminOrgsList')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-org-id]');
    if (row?.dataset.orgId) renderOrgDetail(row.dataset.orgId);
  });

  loadOrgs();
}

async function loadOrgs(): Promise<void> {
  const box = document.getElementById('adminOrgsList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    lastOrgs = await window.apiClient.getOrgsAdmin(authHeaders());
    if (!lastOrgs.length) {
      box.innerHTML = '<div class="empty">Сетей нет</div>';
      return;
    }
    box.innerHTML = lastOrgs
      .map(
        (org) => `
        <button class="row" type="button" data-org-id="${esc(org.id)}">
          <div class="row-body">
            <div class="row-title">${esc(org.brand_name || org.name)}</div>
            <div class="row-sub">${esc(org.id)}${org.is_active === false ? ' · неактивна' : ''}</div>
          </div>
          <div class="row-chevron">›</div>
        </button>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить сети</div>';
  }
}

function renderOrgDetail(orgId: string): void {
  const box = document.getElementById('adminOrgDetail');
  if (!box) return;
  const org = lastOrgs.find((o) => o.id === orgId);
  if (!org) return;
  box.innerHTML = `
    <div class="section">
      <div class="section-title">${esc(org.brand_name || org.name)}</div>
      <div style="padding:0 16px 8px;display:flex;flex-direction:column;gap:8px">
        <input type="text" id="orgName" placeholder="Название" value="${esc(org.name)}">
        <input type="text" id="orgBrandName" placeholder="Отображаемое имя" value="${esc(org.brand_name || '')}">
        <input type="color" id="orgPrimaryColor" value="${esc(org.primary_color || '#2AABEE')}">
        <button type="button" class="btn-main" id="orgSaveBtn">Сохранить</button>
      </div>
    </div>
  `;
  document.getElementById('orgSaveBtn')?.addEventListener('click', () => onSaveOrg(orgId));
}

async function onSaveOrg(orgId: string): Promise<void> {
  const name = (document.getElementById('orgName') as HTMLInputElement | null)?.value.trim() || '';
  const brandName = (document.getElementById('orgBrandName') as HTMLInputElement | null)?.value.trim() || undefined;
  const primaryColor = (document.getElementById('orgPrimaryColor') as HTMLInputElement | null)?.value || undefined;
  if (!name) {
    toast('Укажите название', 'err');
    return;
  }
  try {
    await window.apiClient.saveOrg(authHeaders(), orgId, { name, brand_name: brandName, primary_color: primaryColor });
    toast('Сеть сохранена', 'ok');
    loadOrgs();
  } catch (e) {
    toast('Ошибка сохранения сети', 'err');
  }
}
