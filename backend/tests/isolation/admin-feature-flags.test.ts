/**
 * Admin Control Center, Phase 4+ (Area B1) — Feature Flags: RBAC, global
 * upsert, org-override precedence, fallback-to-global on delete.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { isFeatureEnabled } from '../../src/core/shared/feature-flags.js';

describe('Admin Control Center — Feature Flags', () => {
  const fx = new TestFixtures();

  afterAll(async () => {
    await query(`DELETE FROM feature_flags WHERE key LIKE 'ff_test_%'`);
    await fx.cleanup();
  });

  it('non-admin (manager/employee) is blocked from every /admin/feature-flags route', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('FF Org A');
    const managerA = await fx.createEmployee(orgA, { role: 'manager' });
    const employeeA = await fx.createEmployee(orgA, { role: 'employee' });

    const list = await app.inject({ method: 'GET', url: '/admin/feature-flags', headers: authAs(managerA.telegramId) });
    expect(list.statusCode).toBe(403);

    const put = await app.inject({
      method: 'PUT', url: '/admin/feature-flags/ff_test_rbac',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { enabled: true }
    });
    expect(put.statusCode).toBe(403);

    const del = await app.inject({ method: 'DELETE', url: '/admin/feature-flags/ff_test_rbac', headers: authAs(managerA.telegramId) });
    expect(del.statusCode).toBe(403);
  });

  it('rejects an invalid key and a missing/non-boolean enabled', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('FF Org B');
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });

    const badKey = await app.inject({
      method: 'PUT', url: '/admin/feature-flags/Bad-Key!',
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { enabled: true }
    });
    expect(badKey.statusCode).toBe(400);

    const missingEnabled = await app.inject({
      method: 'PUT', url: '/admin/feature-flags/ff_test_badbody',
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { description: 'no enabled field' }
    });
    expect(missingEnabled.statusCode).toBe(400);
  });

  it('upserts a global flag, then an org override wins over it for isFeatureEnabled', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('FF Org C');
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });
    const key = 'ff_test_precedence';

    const global = await app.inject({
      method: 'PUT', url: `/admin/feature-flags/${key}`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { enabled: true, description: 'global default' }
    });
    expect(global.statusCode).toBe(200);
    expect(global.json().row.org_id).toBeNull();
    expect(global.json().row.enabled).toBe(true);

    expect(await isFeatureEnabled(key, orgA)).toBe(true);

    const override = await app.inject({
      method: 'PUT', url: `/admin/feature-flags/${key}`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { org_id: orgA, enabled: false, description: 'disabled for this org' }
    });
    expect(override.statusCode).toBe(200);
    expect(override.json().row.org_id).toBe(orgA);

    // Org override (false) wins over the global default (true).
    expect(await isFeatureEnabled(key, orgA)).toBe(false);
    // A different org still sees the global default.
    const orgB = await fx.createOrg('FF Org D');
    expect(await isFeatureEnabled(key, orgB)).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/admin/feature-flags', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(list.statusCode).toBe(200);
    const rows = list.json().items.filter((r: any) => r.key === key);
    expect(rows.length).toBe(2);
  });

  it('deleting the org override falls back to the global default', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('FF Org E');
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });
    const key = 'ff_test_fallback';

    await app.inject({
      method: 'PUT', url: `/admin/feature-flags/${key}`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { enabled: true }
    });
    await app.inject({
      method: 'PUT', url: `/admin/feature-flags/${key}`,
      headers: { ...authAs(adminA.telegramId, adminA.telegramGrantToken), 'content-type': 'application/json' },
      payload: { org_id: orgA, enabled: false }
    });
    expect(await isFeatureEnabled(key, orgA)).toBe(false);

    const del = await app.inject({
      method: 'DELETE', url: `/admin/feature-flags/${key}?org_id=${orgA}`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    expect(await isFeatureEnabled(key, orgA)).toBe(true);
  });

  it('a key with no rows at all is not enabled anywhere', async () => {
    expect(await isFeatureEnabled('ff_test_never_created', 'no-such-org')).toBe(false);
  });
});
