/**
 * 21.1 — каскадный Дилер → Сектор → Сеть переключатель в 06-team-bfq.js.
 * Классический скрипт (не frontend/src/ ES-модуль) — нет реального браузера
 * с настоящей Telegram WebApp identity в этой среде (authHeaders() читает
 * window.Telegram.WebApp, которого здесь нет), поэтому кликового E2E через
 * настоящую авторизацию не было. Вместо этого — тот же jsdom-подход, что
 * уже применялся к пилотной странице (reports-page.test.ts), но напрямую
 * к реальному файлу classic-script (indirect eval в global scope, как он
 * и загружается в index.html), не к переписанной копии логики.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.resolve(import.meta.dirname, '../js/06-team-bfq.js'),
  'utf8'
);

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadSwitcher(orgs: any[], meRole = 'admin', currentOrgId = 'orgA') {
  document.body.innerHTML = '<div id="orgSwitcher"></div><div id="teamList"></div>';
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('me', { employee_id: 1, role: meRole, org_id: currentOrgId });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('canManage', () => true);
  vi.stubGlobal('canAdmin', () => true);
  vi.stubGlobal('stores', []);
  const getOrgsAdmin = vi.fn().mockResolvedValue(orgs);
  (globalThis as any).window.apiClient = { getOrgsAdmin };
  // loadTeam() гоняет ещё несколько apiClient-вызовов и рендерит #teamList —
  // не предмет этого теста (сам переключатель — предмет), стаб не даёт
  // цепочке switchAdminOrg→loadTeam упасть на отсутствующих моках.
  vi.stubGlobal('loadTeam', vi.fn());
  // Indirect eval — та же семантика, что <script> без type="module" в
  // index.html: top-level function-декларации становятся настоящими
  // глобалами, доступными вызовом ниже.
  (0, eval)(SRC);
  return { getOrgsAdmin };
}

const ORGS = [
  { id: 'orgA', name: 'Сеть А', sector_id: 'sectorX', dealer_name: 'ООО Ромашка' },
  { id: 'orgB', name: 'Сеть Б', sector_id: 'sectorX', dealer_name: 'ООО Ромашка' },
  { id: 'orgC', name: 'Сеть В', sector_id: 'sectorY', dealer_name: 'ИП Иванов' },
  { id: 'orgD', name: 'Сеть Г', sector_id: 'default', dealer_name: null }
];

describe('Команда — каскадный переключатель Дилер → Сектор → Сеть (21.1)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('рендерит три select и предвыбирает дилера/сектор/сеть текущей сети admin', async () => {
    loadSwitcher(ORGS, 'admin', 'orgA');
    await (globalThis as any).renderOrgSwitcher();

    const dealerSel = document.getElementById('swDealer') as HTMLSelectElement;
    const sectorSel = document.getElementById('swSector') as HTMLSelectElement;
    const orgSel = document.getElementById('swOrg') as HTMLSelectElement;

    expect(dealerSel.value).toBe('ООО Ромашка');
    expect(sectorSel.value).toBe('sectorX');
    expect(orgSel.value).toBe('orgA');
    // Обе сети сектора X (orgA, orgB) видны в третьем select — не только текущая.
    expect(Array.from(orgSel.options).map((o) => o.value).sort()).toEqual(['orgA', 'orgB']);
  });

  it('сеть без dealer_name попадает в бакет «Без дилера», не теряется и не падает', async () => {
    loadSwitcher(ORGS, 'admin', 'orgD');
    await (globalThis as any).renderOrgSwitcher();

    const dealerSel = document.getElementById('swDealer') as HTMLSelectElement;
    expect(dealerSel.value).toBe('Без дилера');
    expect(Array.from(dealerSel.options).map((o) => o.value)).toContain('Без дилера');
  });

  it('список дилеров содержит все различные dealer_name без дублей', async () => {
    loadSwitcher(ORGS, 'admin', 'orgA');
    await (globalThis as any).renderOrgSwitcher();

    const dealerSel = document.getElementById('swDealer') as HTMLSelectElement;
    const values = Array.from(dealerSel.options).map((o) => o.value).sort();
    expect(values).toEqual(['Без дилера', 'ИП Иванов', 'ООО Ромашка']);
  });

  it('смена дилера сужает список секторов до его секторов (renderSwitcherSectors напрямую, без loadTeam-цепочки)', async () => {
    loadSwitcher(ORGS, 'admin', 'orgA');
    await (globalThis as any).renderOrgSwitcher();

    // Симулируем "что покажет форма", если бы выбрали ИП Иванов — тот же
    // путь, что switchAdminDealer(), но без хвоста switchAdminOrg→loadTeam,
    // который тестировать здесь не нужно (не предмет фичи).
    (globalThis as any).renderSwitcherSectors('ИП Иванов', 'sectorY');
    const sectorSel = document.getElementById('swSector') as HTMLSelectElement;
    expect(Array.from(sectorSel.options).map((o) => o.value)).toEqual(['sectorY']);

    (globalThis as any).renderSwitcherOrgs('ИП Иванов', 'sectorY', 'orgC');
    const orgSel = document.getElementById('swOrg') as HTMLSelectElement;
    expect(Array.from(orgSel.options).map((o) => o.value)).toEqual(['orgC']);
  });

  it('admin не видит переключатель — display:none, не блокирует остальных ролей', async () => {
    loadSwitcher(ORGS, 'manager', 'orgA');
    await (globalThis as any).renderOrgSwitcher();
    const sw = document.getElementById('orgSwitcher') as HTMLElement;
    expect(sw.style.display).toBe('none');
  });
});
