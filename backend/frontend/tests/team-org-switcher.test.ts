/**
 * 21.1 — каскадный Дилер → Сектор → Сеть переключатель, теперь в
 * src/pages/team (migrated from the classic-script frontend/js/06-team-bfq.js
 * in the batch-of-13 frontend rewrite — that file no longer exists on disk).
 * Kept as its own focused file (dealer-bucketing edge cases) rather than
 * folded into team-page.test.ts's lighter batch-calibrated coverage, since
 * this cascading logic has enough edge cases to deserve dedicated tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setupGlobals(meRole = 'admin', currentOrgId = 'orgA') {
  document.body.innerHTML = '<div id="orgSwitcher"></div><div id="teamList"></div>';
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('me', { employee_id: 1, role: meRole, org_id: currentOrgId });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('canManage', () => true);
  vi.stubGlobal('canAdmin', () => true);
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('roleLabel', (r: string) => r);
  vi.stubGlobal('assignableRoles', () => []);
  vi.stubGlobal('applyAvatarImg', vi.fn());
  vi.stubGlobal('stores', []);
  vi.stubGlobal('employees', []);
  (window as any).__stores = null;
  const getOrgsAdmin = vi.fn().mockResolvedValue(ORGS);
  const getEmployees = vi.fn().mockResolvedValue([]);
  const getSales = vi.fn().mockResolvedValue([]);
  (window as any).apiClient = { getOrgsAdmin, getEmployees, getSales };
  return { getOrgsAdmin, getEmployees, getSales };
}

const ORGS = [
  { id: 'orgA', name: 'Сеть А', sector_id: 'sectorX', dealer_name: 'ООО Ромашка' },
  { id: 'orgB', name: 'Сеть Б', sector_id: 'sectorX', dealer_name: 'ООО Ромашка' },
  { id: 'orgC', name: 'Сеть В', sector_id: 'sectorY', dealer_name: 'ИП Иванов' },
  { id: 'orgD', name: 'Сеть Г', sector_id: 'default', dealer_name: null }
];

describe('Команда — каскадный переключатель Дилер → Сектор → Сеть (21.1)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('рендерит три select и предвыбирает дилера/сектор/сеть текущей сети admin', async () => {
    setupGlobals('admin', 'orgA');
    const { renderOrgSwitcher } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();

    const dealerSel = document.getElementById('swDealer') as HTMLSelectElement;
    const sectorSel = document.getElementById('swSector') as HTMLSelectElement;
    const orgSel = document.getElementById('swOrg') as HTMLSelectElement;

    expect(dealerSel.value).toBe('ООО Ромашка');
    expect(sectorSel.value).toBe('sectorX');
    expect(orgSel.value).toBe('orgA');
    // Обе сети сектора X (orgA, orgB) видны в третьем select — не только текущая.
    expect(
      Array.from(orgSel.options)
        .map((o) => o.value)
        .sort()
    ).toEqual(['orgA', 'orgB']);
  });

  it('сеть без dealer_name попадает в бакет «Без дилера», не теряется и не падает', async () => {
    setupGlobals('admin', 'orgD');
    const { renderOrgSwitcher } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();

    const dealerSel = document.getElementById('swDealer') as HTMLSelectElement;
    expect(dealerSel.value).toBe('Без дилера');
    expect(Array.from(dealerSel.options).map((o) => o.value)).toContain('Без дилера');
  });

  it('список дилеров содержит все различные dealer_name без дублей', async () => {
    setupGlobals('admin', 'orgA');
    const { renderOrgSwitcher } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();

    const dealerSel = document.getElementById('swDealer') as HTMLSelectElement;
    const values = Array.from(dealerSel.options)
      .map((o) => o.value)
      .sort();
    expect(values).toEqual(['Без дилера', 'ИП Иванов', 'ООО Ромашка']);
  });

  it('смена дилера сужает список секторов до его секторов и сходится на первой сети (switchAdminDealer)', async () => {
    const { getEmployees } = setupGlobals('admin', 'orgA');
    const { renderOrgSwitcher, switchAdminDealer } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();

    switchAdminDealer('ИП Иванов');

    const sectorSel = document.getElementById('swSector') as HTMLSelectElement;
    expect(Array.from(sectorSel.options).map((o) => o.value)).toEqual(['sectorY']);
    const orgSel = document.getElementById('swOrg') as HTMLSelectElement;
    expect(Array.from(orgSel.options).map((o) => o.value)).toEqual(['orgC']);
    expect((globalThis as any).adminViewOrgId).toBe('orgC');
    // switchAdminDealer -> switchAdminOrg -> loadTeam() re-fetches employees for the new org.
    expect(getEmployees).toHaveBeenCalled();
  });

  it('не-admin не видит переключатель — display:none', async () => {
    setupGlobals('manager', 'orgA');
    const { renderOrgSwitcher } = await import('../src/pages/team/index.js');
    await renderOrgSwitcher();
    const sw = document.getElementById('orgSwitcher') as HTMLElement;
    expect(sw.style.display).toBe('none');
  });
});
