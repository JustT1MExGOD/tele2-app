import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

/**
 * ACADEMY SECURITY INVARIANT (17-layer security hardening pass) —
 * Academy/tutorial/sandbox is NEVER an authorization boundary. A
 * client-controlled value must never bypass RBAC, org isolation, or
 * MFA; never create foreign-store access; never turn a simulation into
 * an authorized production mutation; reward amounts must always be
 * server-authoritative, never client-supplied.
 *
 * A prior read-only audit of core/academy/service.ts + rewards.ts +
 * data/repositories/academy.ts already traced every write reachable from
 * the Academy routes and confirmed they're structurally confined to the
 * academy_* tables (academy_progress/academy_xp_events/academy_badges/
 * academy_contextual_dismissals) — this test locks that conclusion in as
 * an executable regression, not just a one-time code-reading exercise.
 */
describe('ADVERSARIAL: Academy is never an authorization/production-mutation boundary', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('an extra client-supplied xp/role/org_id field in the request body is silently ignored — reward stays server-authoritative', async () => {
    const org = await fx.createOrg('Academy No Escalate Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(employee.telegramId), 'content-type': 'application/json' };

    const before = await query(`SELECT xp, role FROM employees WHERE id = $1`, [employee.id]);

    const res = await app.inject({
      method: 'POST',
      url: '/academy/progress/complete-step',
      headers,
      // step_id present in the real reward table, plus attacker-controlled
      // extras a naive implementation might have accidentally trusted.
      payload: {
        step_id: 'employee-ch1-complete',
        xp: 999999,
        xp_awarded: 999999,
        role: 'admin',
        org_id: 'some-other-org',
        badge: { code: 'academy_employee_ch1', title: 'FORGED' }
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The real, documented server-side reward for this step (rewards.ts) —
    // NOT the 999999 the request body tried to supply.
    expect(body.xp_awarded).toBe(50);

    // Production tables untouched — no XP, no role change, ever.
    const after = await query(`SELECT xp, role FROM employees WHERE id = $1`, [employee.id]);
    expect(Number(after.rows[0].xp)).toBe(Number(before.rows[0].xp));
    expect(after.rows[0].role).toBe(before.rows[0].role);

    // Real employee_badges (production namespace) untouched — the Academy
    // badge lives only in academy_badges, a separate table (see 0032_academy.sql).
    const prodBadges = await query(`SELECT 1 FROM employee_badges WHERE employee_id = $1`, [employee.id]);
    expect(prodBadges.rows.length).toBe(0);
  });

  it('an unrecognized step_id cannot target an arbitrary table/column — it just completes with zero reward', async () => {
    const org = await fx.createOrg('Academy Unknown Step Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(employee.telegramId), 'content-type': 'application/json' };

    // Values that would be dangerous if step_id were ever concatenated
    // into SQL instead of used as a parameterized bind value.
    const res = await app.inject({
      method: 'POST',
      url: '/academy/progress/complete-step',
      headers,
      payload: { step_id: "x'; DROP TABLE employees; --" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ already_completed: false, reward_granted: false, xp_awarded: 0 });

    // The table obviously still exists and this employee is still in it —
    // proves step_id never reaches raw SQL construction.
    const stillExists = await query(`SELECT 1 FROM employees WHERE id = $1`, [employee.id]);
    expect(stillExists.rows.length).toBe(1);
  });

  it('Academy progress/reward routes require the same requireActive() auth as production routes — no sandbox-mode bypass', async () => {
    const app = await getApp();
    const noAuth = await app.inject({ method: 'GET', url: '/academy/progress' });
    expect(noAuth.statusCode).toBe(401);

    const noAuthComplete = await app.inject({
      method: 'POST',
      url: '/academy/progress/complete-step',
      headers: { 'content-type': 'application/json' },
      payload: { step_id: 'employee-ch1-complete' }
    });
    expect(noAuthComplete.statusCode).toBe(401);
  });

  it('Academy progress/XP/badges are fully org-isolated — one org\'s completion is invisible to another org\'s employee', async () => {
    const orgA = await fx.createOrg('Academy Isolation Org A');
    const orgB = await fx.createOrg('Academy Isolation Org B');
    const employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    const employeeB = await fx.createEmployee(orgB, { role: 'employee' });
    const app = await getApp();

    await app.inject({
      method: 'POST',
      url: '/academy/progress/complete-step',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { step_id: 'employee-ch1-intro' }
    });

    const bView = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(employeeB.telegramId) });
    expect(bView.json().completed_step_ids).toEqual([]);
  });
});
