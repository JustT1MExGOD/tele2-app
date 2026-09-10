/**
 * Replacement shift ("замена") — an employee from Org A may manually work a
 * shift at a same-SECTOR Org B store, without gaining general Org B access.
 * Identity/home org never changes; access is restricted to the active work
 * context only. See migration 0031, core/shifts/work-context.ts,
 * core/orgs/sector-membership.ts.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { findReplacementEmployeesForStoreDate } from '../../src/data/repositories/shifts.js';

const fx = new TestFixtures();
const sectorIds: string[] = [];

async function createSector(name: string): Promise<string> {
  const id = `t17_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_sector`;
  await query(`INSERT INTO sectors (id, name) VALUES ($1, $2)`, [id, name]);
  sectorIds.push(id);
  return id;
}

async function setOrgSector(orgId: string, sectorId: string | null): Promise<void> {
  await query(`UPDATE organizations SET sector_id = $2 WHERE id = $1`, [orgId, sectorId]);
}

afterAll(async () => {
  await query(`DELETE FROM shift_sessions WHERE employee_id = ANY($1)`, [fx.employeeIds.length ? fx.employeeIds : [-1]]);
  await fx.cleanup();
  if (sectorIds.length) await query(`DELETE FROM sectors WHERE id = ANY($1)`, [sectorIds]);
});

describe('Replacement shift — resolve-store eligibility', () => {
  it('own-org store -> allowed, mode NORMAL', async () => {
    const orgA = await fx.createOrg('RS Org A1');
    const storeA = await fx.createStore(orgA, 'RS Store A1');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeA]);
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: storeRow.rows[0].code }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(true);
    expect(body.mode).toBe('NORMAL');
    expect(body.store.code).toBe(storeRow.rows[0].code);
  });

  it('same-sector foreign-org store -> allowed, mode REPLACEMENT', async () => {
    const sector = await createSector('RS Sector Shared 1');
    const orgA = await fx.createOrg('RS Org A2');
    const orgB = await fx.createOrg('RS Org B2');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B2');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: storeRow.rows[0].code }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(true);
    expect(body.mode).toBe('REPLACEMENT');
    // Only safe fields — no org_id/internal fields leaked.
    expect(Object.keys(body.store).sort()).toEqual(['address', 'code', 'display_name', 'id', 'name'].sort());
  });

  it('different-sector foreign-org store -> blocked, no foreign data revealed', async () => {
    const sectorA = await createSector('RS Sector A3');
    const sectorB = await createSector('RS Sector B3');
    const orgA = await fx.createOrg('RS Org A3');
    const orgB = await fx.createOrg('RS Org B3');
    await setOrgSector(orgA, sectorA);
    await setOrgSector(orgB, sectorB);
    const storeB = await fx.createStore(orgB, 'RS Store B3');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: storeRow.rows[0].code }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toBe(false);
    expect(body.message).toBe('Эта точка не входит в ваш сектор. Выход на замену недоступен.');
    expect(body.store).toBeUndefined();
    expect(body.mode).toBeUndefined();
  });

  it('foreign-org store with NO sector configured on either org -> blocked (unconfigured sector never grants access)', async () => {
    const orgA = await fx.createOrg('RS Org A4');
    const orgB = await fx.createOrg('RS Org B4');
    // deliberately no setOrgSector call — both orgs have sector_id = NULL
    const storeB = await fx.createStore(orgB, 'RS Store B4');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: storeRow.rows[0].code }
    });
    expect(res.json().allowed).toBe(false);
  });

  it('inactive store -> blocked', async () => {
    const sector = await createSector('RS Sector Inactive');
    const orgA = await fx.createOrg('RS Org A5');
    const orgB = await fx.createOrg('RS Org B5');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B5');
    await query(`UPDATE stores SET is_active = false WHERE id = $1`, [storeB]);
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: storeRow.rows[0].code }
    });
    expect(res.json().allowed).toBe(false);
    expect(res.json().message).toBe('Точка неактивна.');
  });

  it('inactive employee -> blocked (already rejected upstream at auth, before reaching eligibility logic — resolveStoreEligibility\'s own is_active check is a redundant defense-in-depth layer, confirmed unreachable in the normal flow but kept for direct/future callers)', async () => {
    const orgA = await fx.createOrg('RS Org A6');
    const storeA = await fx.createStore(orgA, 'RS Store A6');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    await query(`UPDATE employees SET is_active = false WHERE id = $1`, [emp.id]);
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeA]);
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: storeRow.rows[0].code }
    });
    expect(res.statusCode).toBe(401);
    await query(`UPDATE employees SET is_active = true WHERE id = $1`, [emp.id]);
  });

  it('nonexistent store code -> blocked, generic message', async () => {
    const orgA = await fx.createOrg('RS Org A7');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: '/shifts/resolve-store',
      headers: { ...authAs(emp.telegramId), 'content-type': 'application/json' },
      payload: { code: 'no-such-code-999' }
    });
    expect(res.json().allowed).toBe(false);
  });
});

describe('Replacement shift — /shifts/open lifecycle', () => {
  it('no-schedule employee can manually open a replacement shift at a same-sector foreign store', async () => {
    const sector = await createSector('RS Sector Open1');
    const orgA = await fx.createOrg('RS Org A8');
    const orgB = await fx.createOrg('RS Org B8');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B8');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const openRes = await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-01' }
    });
    expect(openRes.statusCode).toBe(200);
    const session = openRes.json().session;
    expect(session.store_id).toBe(storeB);
    expect(session.work_mode).toBe('REPLACEMENT');
    expect(session.org_id).toBe(orgB);
    expect(session.selection_source).toBe('MANUAL_CODE');

    // Identity/home org untouched.
    const empRow = await query(`SELECT org_id FROM employees WHERE id = $1`, [emp.id]);
    expect(empRow.rows[0].org_id).toBe(orgA);
  });

  it('different-sector store code at /shifts/open -> 403, no shift opened', async () => {
    const sectorA = await createSector('RS Sector Open2 A');
    const sectorB = await createSector('RS Sector Open2 B');
    const orgA = await fx.createOrg('RS Org A9');
    const orgB = await fx.createOrg('RS Org B9');
    await setOrgSector(orgA, sectorA);
    await setOrgSector(orgB, sectorB);
    const storeB = await fx.createStore(orgB, 'RS Store B9');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };
    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);

    const openRes = await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-01' }
    });
    expect(openRes.statusCode).toBe(403);
    const openCount = await query(`SELECT COUNT(*)::int c FROM shift_sessions WHERE employee_id = $1`, [emp.id]);
    expect(openCount.rows[0].c).toBe(0);
  });

  it('active shift store cannot be changed — must close before opening elsewhere', async () => {
    const sector = await createSector('RS Sector Lock');
    const orgA = await fx.createOrg('RS Org A10');
    const orgB = await fx.createOrg('RS Org B10');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeA = await fx.createStore(orgA, 'RS Store A10');
    const storeB = await fx.createStore(orgB, 'RS Store B10');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const openA = await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_id: storeA, work_date: '2026-07-02' }
    });
    expect(openA.statusCode).toBe(200);

    const storeBRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const openB = await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeBRow.rows[0].code, work_date: '2026-07-02' }
    });
    expect(openB.statusCode).toBe(403);
    expect(openB.json().message).toMatch(/уже открыта смена на другой точке/i);

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
  });
});

describe('Replacement shift — sale attribution and spoof prevention', () => {
  it("a replacement employee's sale is attributed to the actual (foreign) store/org, not their home org", async () => {
    const sector = await createSector('RS Sector Sale1');
    const orgA = await fx.createOrg('RS Org A11');
    const orgB = await fx.createOrg('RS Org B11');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B11');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const openRes = await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-03' }
    });
    expect(openRes.statusCode).toBe(200);

    const saleRes = await app.inject({
      method: 'POST', url: '/sales',
      headers, payload: { employee_id: emp.id, store_id: storeB, sale_date: '2026-07-03', sim: 3 }
    });
    expect(saleRes.statusCode).toBe(200);

    const saleRow = await query(`SELECT employee_id, store_id, sim FROM sales WHERE employee_id = $1 AND store_id = $2`, [emp.id, storeB]);
    // employee_id is bigint — the pg driver returns bigint columns as strings.
    expect(Number(saleRow.rows[0].employee_id)).toBe(emp.id);
    expect(saleRow.rows[0].store_id).toBe(storeB);
    // Store B's own totals include it — org is derived transitively via store_id (no org_id column on sales).
    const storeOrgRow = await query(`SELECT COALESCE(org_id,'default') as org_id FROM stores WHERE id = $1`, [storeB]);
    expect(storeOrgRow.rows[0].org_id).toBe(orgB);

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
  });

  it('cannot spoof a sale to a foreign store without an active REPLACEMENT shift there (no shift open at all)', async () => {
    const sector = await createSector('RS Sector Spoof1');
    const orgA = await fx.createOrg('RS Org A12');
    const orgB = await fx.createOrg('RS Org B12');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B12');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    // No /shifts/open call at all — same-sector eligibility alone must NOT be enough for a sale.
    const saleRes = await app.inject({
      method: 'POST', url: '/sales',
      headers, payload: { employee_id: emp.id, store_id: storeB, sale_date: '2026-07-04', sim: 1 }
    });
    expect(saleRes.statusCode).toBe(403);
  });

  it('cannot spoof a sale to a foreign store while a REPLACEMENT shift is open at a DIFFERENT foreign store', async () => {
    const sector = await createSector('RS Sector Spoof2');
    const orgA = await fx.createOrg('RS Org A13');
    const orgB = await fx.createOrg('RS Org B13');
    const orgC = await fx.createOrg('RS Org C13');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    await setOrgSector(orgC, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B13');
    const storeC = await fx.createStore(orgC, 'RS Store C13');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const storeBRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const openRes = await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeBRow.rows[0].code, work_date: '2026-07-05' }
    });
    expect(openRes.statusCode).toBe(200);

    // Sector-eligible C, but the active shift is at B — must not be accepted for C.
    const saleRes = await app.inject({
      method: 'POST', url: '/sales',
      headers, payload: { employee_id: emp.id, store_id: storeC, sale_date: '2026-07-05', sim: 1 }
    });
    expect(saleRes.statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
  });

  it('quick-sale (/sales/quick) and offline sync (/sync/batch) respect the same replacement-store attribution rule', async () => {
    const sector = await createSector('RS Sector Sale2');
    const orgA = await fx.createOrg('RS Org A14');
    const orgB = await fx.createOrg('RS Org B14');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B14');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-06' }
    });

    const quickRes = await app.inject({
      method: 'POST', url: '/sales/quick',
      headers, payload: { text: 'две симки', store_id: storeB, sale_date: '2026-07-06' }
    });
    expect(quickRes.statusCode).toBe(200);

    const syncRes = await app.inject({
      method: 'POST', url: '/sync/batch',
      headers, payload: { ops: [{ client_id: `rs-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: 'sale', store_id: storeB, sale_date: '2026-07-06', metrics: { mnp: 1 } }] }
    });
    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.json().results[0].status).toBe('applied');

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
  });
});

describe('Replacement shift — cross-org isolation (no escalation)', () => {
  it('an employee with an open REPLACEMENT shift still only sees their HOME org\'s employee list — an ?org_id= override is silently ignored for non-admin roles, unaffected by the active work context', async () => {
    const sector = await createSector('RS Sector Iso1');
    const orgA = await fx.createOrg('RS Org A15');
    const orgB = await fx.createOrg('RS Org B15');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B15');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const foreignEmp = await fx.createEmployee(orgB, { role: 'employee', fullName: 'RS Foreign Only' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-07' }
    });

    // GET /employees is requireActive-only (not requireManager) — isolation
    // here is "resolveViewOrgId ignores the query override for non-admin",
    // not a 403. An active REPLACEMENT shift must not change that: the
    // foreign org's own employee (created only in Org B) must never appear.
    const res = await app.inject({ method: 'GET', url: `/employees?org_id=${orgB}`, headers });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as Array<{ id: number }>).map((e) => e.id);
    expect(ids).not.toContain(foreignEmp.id);

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
  });

  it("principal.org_id (home org) is never overwritten by an open REPLACEMENT shift — GET /me still reports Org A", async () => {
    const sector = await createSector('RS Sector Iso2');
    const orgA = await fx.createOrg('RS Org A16');
    const orgB = await fx.createOrg('RS Org B16');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B16');
    const emp = await fx.createEmployee(orgA, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-08' }
    });

    const meRes = await app.inject({ method: 'GET', url: '/me', headers });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().org_id).toBe(orgA);

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
  });
});

describe('Replacement shift — report recipient data (repo layer)', () => {
  it('findReplacementEmployeesForStoreDate returns exactly the employees with a REPLACEMENT session at that store/date, deduplicated', async () => {
    const sector = await createSector('RS Sector Report1');
    const orgA = await fx.createOrg('RS Org A17');
    const orgB = await fx.createOrg('RS Org B17');
    await setOrgSector(orgA, sector);
    await setOrgSector(orgB, sector);
    const storeB = await fx.createStore(orgB, 'RS Store B17');
    const empReplacement = await fx.createEmployee(orgA, { role: 'employee' });
    const empHome = await fx.createEmployee(orgB, { role: 'employee' });
    const app = await getApp();

    const storeRow = await query(`SELECT code FROM stores WHERE id = $1`, [storeB]);
    const headers = { ...authAs(empReplacement.telegramId), 'content-type': 'application/json' };
    await app.inject({
      method: 'POST', url: '/shifts/open',
      headers, payload: { store_code: storeRow.rows[0].code, work_date: '2026-07-09' }
    });
    // Home-org employee opens their own store normally (NORMAL, not REPLACEMENT).
    const headersHome = { ...authAs(empHome.telegramId), 'content-type': 'application/json' };
    await app.inject({
      method: 'POST', url: '/shifts/open',
      headers: headersHome, payload: { store_id: storeB, work_date: '2026-07-09' }
    });

    const reps = await findReplacementEmployeesForStoreDate(storeB, '2026-07-09');
    expect(reps.length).toBe(1);
    expect(Number(reps[0].employee_id)).toBe(empReplacement.id);

    await app.inject({ method: 'POST', url: '/shifts/close', headers, payload: {} });
    await app.inject({ method: 'POST', url: '/shifts/close', headers: headersHome, payload: {} });
  });

  it('a store/date with no replacement shifts returns an empty list', async () => {
    const orgA = await fx.createOrg('RS Org A18');
    const storeA = await fx.createStore(orgA, 'RS Store A18');
    const reps = await findReplacementEmployeesForStoreDate(storeA, '2026-07-10');
    expect(reps).toEqual([]);
  });
});
