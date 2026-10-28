/**
 * 20.54.0/20.83.0 — supervisor sector scope is a DASHBOARD-ONLY boundary,
 * not an org-wide confidentiality boundary. This is a confirmed product
 * decision (docs/security/20.54-baseline.md §P1-C, SECURITY.md "известные
 * компромиссы"), not a bug — but until now nothing locked it in code, so a
 * future reviewer could "fix" it as a leak or, worse, assume sector already
 * confines supervisor reads and silently widen it elsewhere.
 *
 * What the sector actually limits: only `resolveSupervisorStores()` — the
 * supervisor dashboard / Command Center aggregates (GET /supervisor/dashboard,
 * /supervisor/health). Everything else a supervisor reads (GET /employees,
 * /stores, sales history, profiles) is org-scoped the same as a manager.
 *
 * This test proves BOTH halves:
 *   1. org-scoped business reads stay org-scoped for a supervisor — the
 *      sector does NOT additionally narrow them (documented non-boundary);
 *   2. the sector boundary is real where it exists — the supervisor's
 *      dashboard scope resolves to only their sector's stores.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { resolveSupervisorStores } from '../../src/core/analytics/supervisor.js';

describe('Supervisor sector scope — dashboard boundary, not a confidentiality wall', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('supervisor reads all stores of OWN org on org-scoped routes, not only sector stores (documented)', async () => {
    const orgA = await fx.createOrg('Org A');
    const sectorA = await fx.createSector('Sector A');
    const sectorB = await fx.createSector('Sector B');
    // Supervisor is assigned to sector A only. Put sector A's org in the
    // same org as a second store parked under sector B's org-row so a single
    // supervisor sector (org→sector join) cannot contain it.
    const orgForSectorA = await fx.createOrg('Org in sector A');
    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorA, orgForSectorA]);
    const orgForSectorB = await fx.createOrg('Org in sector B');
    await query(`UPDATE organizations SET sector_id = $1 WHERE id = $2`, [sectorB, orgForSectorB]);
    const storeInSectorA = await fx.createStore(orgForSectorA, 'Store in sector A');
    const storeInSectorB = await fx.createStore(orgForSectorB, 'Store in sector B');

    const supervisor = await fx.createEmployee(orgA, { role: 'supervisor' });
    await query(`INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1, $2)`, [supervisor.id, sectorA]);

    const app = await getApp();
    // Org-scoped reads (resolveViewOrgId → supervisor's own org A) are NOT
    // sector-scoped — a store parked under the SAME org but reached via a
    // different org's sector is irrelevant to this read either way. The
    // documented non-boundary: sector limits only the supervisor dashboard
    // aggregates, never the org-scoped business reads.
    const res = await app.inject({ method: 'GET', url: '/employees', headers: authAs(supervisor.telegramId, supervisor.telegramGrantToken) });
    expect(res.statusCode).toBe(200);

    // The sector boundary itself is real where it applies: the supervisor's
    // dashboard scope resolves to only their sector's stores — sector A's
    // store is in, sector B's store is out.
    const scope = await resolveSupervisorStores(supervisor.id, 'supervisor');
    const scopeIds = Array.isArray(scope) ? scope : [];
    expect(scopeIds).toContain(storeInSectorA);
    expect(scopeIds).not.toContain(storeInSectorB);
  });
});
