/**
 * Admin Control Center, Phase 4+ (Area B4) — Operations Center: RBAC and
 * genuinely cross-org behavior (response spans ≥2 orgs, unlike Command
 * Center's org-scoped equivalent).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as alertsRepo from '../../src/data/repositories/alerts.js';

describe('Admin Control Center — Operations Center', () => {
  const fx = new TestFixtures();
  const alertIds: number[] = [];
  const accessRequestIds: number[] = [];

  afterAll(async () => {
    if (alertIds.length) await query(`DELETE FROM smart_alerts WHERE id = ANY($1)`, [alertIds]);
    if (accessRequestIds.length) await query(`DELETE FROM access_requests WHERE id = ANY($1)`, [accessRequestIds]);
    await fx.cleanup();
  });

  async function seedAccessRequest(orgId: string, fullName: string): Promise<number> {
    const res = await query(
      `INSERT INTO access_requests (telegram_id, telegram_username, full_name, status, org_id)
       VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
      [Math.floor(9_000_000_000 + Math.random() * 900_000_000), 'test_user', fullName, orgId]
    );
    const id = Number(res.rows[0].id);
    accessRequestIds.push(id);
    return id;
  }

  it('non-admin (manager/employee) is blocked from /admin/operations-overview', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Ops Org A');
    const managerA = await fx.createEmployee(orgA, { role: 'manager' });
    const employeeA = await fx.createEmployee(orgA, { role: 'employee' });

    const resManager = await app.inject({ method: 'GET', url: '/admin/operations-overview', headers: authAs(managerA.telegramId) });
    expect(resManager.statusCode).toBe(403);
    const resEmployee = await app.inject({ method: 'GET', url: '/admin/operations-overview', headers: authAs(employeeA.telegramId) });
    expect(resEmployee.statusCode).toBe(403);
  });

  it('is genuinely cross-org: an admin of org A sees open alerts and pending access requests from org B too', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Ops Org B');
    const orgB = await fx.createOrg('Ops Org C');
    const storeA = await fx.createStore(orgA, 'Ops Store A');
    const storeB = await fx.createStore(orgB, 'Ops Store B');
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });

    const alertA = await alertsRepo.insertOnce({
      store_id: storeA, alert_type: 'ops_test_a', severity: 'critical',
      title: 'Test alert org A', body: 'body', payload: {}
    });
    const alertB = await alertsRepo.insertOnce({
      store_id: storeB, alert_type: 'ops_test_b', severity: 'warn',
      title: 'Test alert org B', body: 'body', payload: {}
    });
    if (alertA) alertIds.push(Number(alertA.id));
    if (alertB) alertIds.push(Number(alertB.id));

    await seedAccessRequest(orgA, 'Ops Requester A');
    await seedAccessRequest(orgB, 'Ops Requester B');

    const res = await app.inject({ method: 'GET', url: '/admin/operations-overview', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const alertOrgIds = new Set(
      body.alerts
        .filter((a: any) => a.alert_type === 'ops_test_a' || a.alert_type === 'ops_test_b')
        .map((a: any) => (a.store_id === storeA ? orgA : orgB))
    );
    expect(alertOrgIds.has(orgA)).toBe(true);
    expect(alertOrgIds.has(orgB)).toBe(true);

    expect(body.alerts_by_severity.critical).toBeGreaterThanOrEqual(1);
    expect(body.alerts_by_severity.warn).toBeGreaterThanOrEqual(1);

    const reqOrgIds = new Set(
      body.pending_access_requests
        .filter((r: any) => r.full_name === 'Ops Requester A' || r.full_name === 'Ops Requester B')
        .map((r: any) => r.effective_org_id || r.org_id)
    );
    expect(reqOrgIds.has(orgA)).toBe(true);
    expect(reqOrgIds.has(orgB)).toBe(true);
  });
});
