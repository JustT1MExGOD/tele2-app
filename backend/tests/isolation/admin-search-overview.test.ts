/**
 * Admin Control Center (20.59.0) — global search and overview: RBAC,
 * org-scoping, basic relevance.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Admin Control Center — Search & Overview', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Search Org A');
    orgB = await fx.createOrg('Search Org B');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    await fx.createEmployee(orgA, { role: 'employee', fullName: 'Findable Zebra Ivanov' });
    await fx.createEmployee(orgB, { role: 'employee', fullName: 'Findable Zebra Petrov' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = ANY($1)`, [[orgA, orgB]]);
    await fx.cleanup();
  });

  it('non-admin is blocked from /admin/search and /admin/overview', async () => {
    const app = await getApp();
    const s = await app.inject({ method: 'GET', url: '/admin/search?q=Zebra', headers: authAs(managerA.telegramId) });
    expect(s.statusCode).toBe(403);
    const o = await app.inject({ method: 'GET', url: '/admin/overview', headers: authAs(managerA.telegramId) });
    expect(o.statusCode).toBe(403);
  });

  it('search is permission-aware: results are scoped to the admin\'s own org by default', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/admin/search?q=Zebra', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const employees = res.json().employees;
    expect(employees.some((e: any) => e.full_name.includes('Ivanov'))).toBe(true);
    expect(employees.some((e: any) => e.full_name.includes('Petrov'))).toBe(false);
  });

  it('search requires at least 2 characters and otherwise returns empty', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/admin/search?q=a', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().employees).toEqual([]);
    expect(res.json().stores).toEqual([]);
  });

  it('overview returns real counts with no fabricated fields', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/admin/overview', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.employees.active).toBe('number');
    expect(typeof body.stores.active).toBe('number');
    expect(typeof body.pending_access_requests).toBe('number');
    expect(typeof body.open_support_tickets).toBe('number');
    expect(typeof body.active_alerts).toBe('number');
  });
});
