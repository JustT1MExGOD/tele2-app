import { describe, it, expect, afterAll } from 'vitest';
import { getApp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

/**
 * Cross-tenant directory leak: GET /access/employees-directory
 * (src/api/routes/org/access.ts) is intentionally public — a guest without
 * an employee card yet needs it to "claim" their own pre-provisioned row
 * during registration. Its own code comment already documented the
 * intent — scope the list to the network the guest picked in the picker,
 * "otherwise picking network B could still let them claim an employee of
 * network A" — but `org_id` was only an OPTIONAL query parameter.
 *
 * Omitting it entirely returned unclaimed employee names across EVERY
 * organization on the platform, on a route with zero authentication —
 * exactly the cross-tenant leak the comment said it was preventing.
 *
 * FIXED (17-layer security hardening pass): `org_id` is now required —
 * omitting it is a 400, not a wider unfiltered list. This test proves an
 * unauthenticated caller can no longer enumerate another org's unclaimed
 * employees by simply not specifying which network they're registering
 * into.
 */
describe('ADVERSARIAL: GET /access/employees-directory — org_id is now required, no more cross-tenant directory leak', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('omitting org_id entirely is rejected (400), not a wide-open cross-org list', async () => {
    const org = await fx.createOrg('Directory Leak Org');
    await fx.createEmployee(org, { role: 'employee', fullName: 'Directory Victim', telegramId: null });

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/access/employees-directory' });
    expect(res.statusCode).toBe(400);
  });

  it('with org_id, an unauthenticated caller sees only that org\'s unclaimed employees, never another org\'s', async () => {
    const orgA = await fx.createOrg('Directory Scope Org A');
    const orgB = await fx.createOrg('Directory Scope Org B');
    const nameA = `Unclaimed A ${Date.now()}`;
    const nameB = `Unclaimed B ${Date.now()}`;
    await fx.createEmployee(orgA, { role: 'employee', fullName: nameA, telegramId: null });
    await fx.createEmployee(orgB, { role: 'employee', fullName: nameB, telegramId: null });

    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: `/access/employees-directory?org_id=${encodeURIComponent(orgA)}` });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((e: any) => e.full_name);
    expect(names).toContain(nameA);
    expect(names).not.toContain(nameB);
  });
});
