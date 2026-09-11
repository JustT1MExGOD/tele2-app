import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

/**
 * IDOR / cross-tenant PII leak: GET /avatars/:employeeId (src/api/routes/
 * me/avatar.ts) used to be fully public and unauthenticated — the route's
 * own (now-outdated, see git history) comment documented that
 * employees.id is a plain sequential SERIAL (fully enumerable 1,2,3,...)
 * and that the only defense was a per-IP rate limit (30/min), explicitly
 * flagged as "DEFERRED, см. PASS 3 finding #6".
 *
 * FIXED: the route now requires requireActive() auth and enforces
 * employeesRepo.belongsToOrg() — same tenant boundary the rest of this
 * codebase's cross-employee reads use. A bare <img src> can no longer
 * reach it (no auth header on a plain <img>), so the frontend
 * (app/nav.ts::applyAvatarImg) now fetches the blob via window.apiClient
 * with real auth headers and sets it as a blob: URL. This test file
 * proves the fix: what used to leak now returns 401/404, while a
 * same-org authenticated request still works.
 */
describe('ADVERSARIAL: GET /avatars/:employeeId — cross-tenant avatar IDOR (fixed)', () => {
  const fx = new TestFixtures();
  let orgVictim: string;
  let victim: { id: number; telegramId: number };
  const VICTIM_PHOTO = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]), // JPEG magic bytes — passes sniffImageMime()
    Buffer.from('totally-private-victim-photo-bytes-not-for-attacker')
  ]);

  beforeAll(async () => {
    orgVictim = await fx.createOrg('Avatar Victim Org');
    victim = await fx.createEmployee(orgVictim, { role: 'employee', fullName: 'Avatar Victim' });
    // Seed the victim's "uploaded" avatar directly (equivalent to a real
    // POST /me/avatar by the victim) — the DAL write path is not what's
    // under test here, only the GET's tenant/auth boundary.
    await query(`UPDATE employees SET avatar_data = $1, avatar_mime = 'image/jpeg' WHERE id = $2`, [VICTIM_PHOTO, victim.id]);
  });

  afterAll(() => fx.cleanup());

  it('a fully unauthenticated request (no headers at all) is rejected, never sees the bytes', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/avatars/${victim.id}`
      // deliberately NO headers — not even X-Telegram-Id
    });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain('totally-private-victim-photo-bytes-not-for-attacker');
  });

  it('an authenticated employee of a COMPLETELY UNRELATED org is rejected — cross-tenant isolation now enforced', async () => {
    const orgAttacker = await fx.createOrg('Avatar Attacker Org');
    const attacker = await fx.createEmployee(orgAttacker, { role: 'employee', fullName: 'Avatar Attacker' });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/avatars/${victim.id}`,
      headers: authAs(attacker.telegramId)
    });
    // Same shape as any other cross-tenant lookup miss in this codebase —
    // 404, not 403, so the response doesn't even confirm the id exists.
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('totally-private-victim-photo-bytes-not-for-attacker');
  });

  it('an authenticated employee of the SAME org can still fetch a teammate\'s avatar — the fix is tenant-scoped, not a blanket lockout', async () => {
    const teammate = await fx.createEmployee(orgVictim, { role: 'employee', fullName: 'Avatar Teammate' });

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/avatars/${victim.id}`,
      headers: authAs(teammate.telegramId)
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('totally-private-victim-photo-bytes-not-for-attacker');
  });

  it('a non-existent employee_id returns 404 for an authenticated same-org-irrelevant caller (no leak of existence via status code)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/avatars/999999999`,
      headers: authAs(victim.telegramId)
    });
    expect(res.statusCode).toBe(404);
  });

  it('demonstrates enumerability: employee_id is a plain sequential SERIAL, not an opaque/random identifier (unrelated to the auth fix, still true)', async () => {
    // Confirms the fix relies on the AUTH+TENANT check, not on ids being
    // hard to guess — an attacker who somehow gets same-org auth can still
    // walk ids, which is fine (that's ordinary same-org visibility, same
    // as the Team page already shows). Cross-org walking is what's closed.
    const victim2 = await fx.createEmployee(orgVictim, { role: 'employee', fullName: 'Avatar Victim 2' });
    expect(victim2.id).toBeGreaterThan(0);
    expect(Math.abs(victim2.id - victim.id)).toBeLessThan(50);
  });
});
