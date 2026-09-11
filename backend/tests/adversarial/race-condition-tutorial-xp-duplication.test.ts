import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

/**
 * Race condition / TOCTOU: POST /me/tutorial-complete (src/api/routes/
 * analytics/insights.ts) used to check `hasBadge()` first and only call
 * `addXp()` + `grantBadge()` if the badge didn't exist yet — a classic
 * check-then-act, not wrapped in a transaction or protected by a row
 * lock. The unique constraint the old code implicitly relied on
 * (`employee_badges_employee_id_badge_code_earned_at_key`, migrations/
 * 0001_baseline.sql) is on (employee_id, badge_code, earned_at), and
 * earned_at defaults to now() at INSERT time — two concurrent inserts
 * land on different timestamps and never collide on it, so ON CONFLICT
 * DO NOTHING never fired for real duplicates.
 *
 * FIXED: the route no longer pre-checks — grantBadge() now returns
 * whether ITS OWN insert actually won (RETURNING id against a new
 * partial unique index scoped to one-time badge codes, migrations/
 * 0033_onetime_badge_dedup.sql), and addXp() only runs when it did. The
 * database's unique index is what serializes concurrent duplicates, not
 * application-level check-then-act — no transaction/lock needed for this
 * specific pattern.
 */
describe('ADVERSARIAL: POST /me/tutorial-complete — concurrent double-submit no longer duplicates XP or badge', () => {
  const fx = new TestFixtures();
  let org: string;
  let employee: { id: number; telegramId: number };

  afterAll(async () => {
    await query(`DELETE FROM employee_badges WHERE employee_id = $1`, [employee?.id]).catch(() => {});
    await fx.cleanup();
  });

  it('N concurrent tutorial-complete calls grant exactly one badge and exactly 50 XP total, never more', async () => {
    org = await fx.createOrg('Race Tutorial Org');
    employee = await fx.createEmployee(org, { role: 'employee', fullName: 'Race Tutorial Employee' });

    const app = await getApp();
    const before = await query(`SELECT xp FROM employees WHERE id = $1`, [employee.id]);
    const xpBefore = Number(before.rows[0]?.xp || 0);

    // 40, not 8: on a local loopback Postgres the round-trip is fast enough
    // that a smaller burst mostly serializes in practice (checked: 8
    // concurrent requests reliably produced xp=50/badges=1, i.e. no visible
    // race) even though the code has no transaction/lock protecting it.
    // A wider burst reliably wins the interleaving race here; a slower/
    // remote DB would need far fewer concurrent requests to trigger it.
    const CONCURRENCY = 40;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        app.inject({
          method: 'POST',
          url: '/me/tutorial-complete',
          headers: { ...authAs(employee.telegramId), 'content-type': 'application/json' },
          payload: {}
        })
      )
    );

    const after = await query(`SELECT xp FROM employees WHERE id = $1`, [employee.id]);
    const xpAfter = Number(after.rows[0]?.xp || 0);
    const badges = await query(
      `SELECT COUNT(*)::int AS n FROM employee_badges WHERE employee_id = $1 AND badge_code = 'tutorial_done'`,
      [employee.id]
    );

    // Expected (idempotent, as the code comment claims) behavior: exactly
    // +50 XP and exactly 1 badge row, no matter how many concurrent
    // requests raced each other. Instead, more than one write wins the
    // race and both XP and badge count are inflated.
    expect(xpAfter - xpBefore).toBe(50);
    expect(badges.rows[0].n).toBe(1);
  });

  it('the manager tutorial badge (tutorial_mgr_done) is independently deduped too, not conflated with the employee one', async () => {
    const orgMgr = await fx.createOrg('Race Tutorial Mgr Org');
    const mgr = await fx.createEmployee(orgMgr, { role: 'manager', fullName: 'Race Tutorial Manager' });
    const app = await getApp();

    await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: 'POST',
          url: '/me/tutorial-complete',
          headers: { ...authAs(mgr.telegramId), 'content-type': 'application/json' },
          payload: { mode: 'manager' }
        })
      )
    );

    const badges = await query(
      `SELECT COUNT(*)::int AS n FROM employee_badges WHERE employee_id = $1 AND badge_code = 'tutorial_mgr_done'`,
      [mgr.id]
    );
    expect(badges.rows[0].n).toBe(1);
    await query(`DELETE FROM employee_badges WHERE employee_id = $1`, [mgr.id]).catch(() => {});
  });

  it('does NOT break repeatable badges (ideal_shift) — the same code can legitimately be earned more than once, unlike the one-time tutorial badges', async () => {
    // Guards against the obvious wrong fix: a blanket UNIQUE(employee_id,
    // badge_code) would have silently stopped a real repeat achievement
    // from ever recording again. The fix here is a PARTIAL index scoped
    // to only the one-time codes (migrations/0033_onetime_badge_dedup.sql)
    // — this proves 'ideal_shift' is unaffected by it.
    const org2 = await fx.createOrg('Race Repeatable Badge Org');
    const emp2 = await fx.createEmployee(org2, { role: 'employee', fullName: 'Repeatable Badge Employee' });

    await query(
      `INSERT INTO employee_badges (employee_id, badge_code, title) VALUES ($1,'ideal_shift','Идеальная смена')`,
      [emp2.id]
    );
    await query(
      `INSERT INTO employee_badges (employee_id, badge_code, title) VALUES ($1,'ideal_shift','Идеальная смена')`,
      [emp2.id]
    );

    const count = await query(
      `SELECT COUNT(*)::int AS n FROM employee_badges WHERE employee_id = $1 AND badge_code = 'ideal_shift'`,
      [emp2.id]
    );
    expect(count.rows[0].n).toBe(2);
    await query(`DELETE FROM employee_badges WHERE employee_id = $1`, [emp2.id]).catch(() => {});
  });
});
