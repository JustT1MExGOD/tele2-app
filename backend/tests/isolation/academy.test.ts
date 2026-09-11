/**
 * T2 Academy — server-side progress/XP/badge persistence, separate from
 * production gamification (xp_events/employee_badges/employees.xp).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

const fx = new TestFixtures();

afterAll(async () => {
  if (fx.employeeIds.length) {
    await query(`DELETE FROM academy_progress WHERE employee_id = ANY($1)`, [fx.employeeIds]);
    await query(`DELETE FROM academy_xp_events WHERE employee_id = ANY($1)`, [fx.employeeIds]);
    await query(`DELETE FROM academy_badges WHERE employee_id = ANY($1)`, [fx.employeeIds]);
    await query(`DELETE FROM academy_contextual_dismissals WHERE employee_id = ANY($1)`, [fx.employeeIds]);
  }
  await fx.cleanup();
});

describe('T2 Academy — progress/XP/badges', () => {
  it('GET /academy/progress — empty for a fresh employee', async () => {
    const org = await fx.createOrg('Academy Org 1');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(emp.telegramId) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ completed_step_ids: [], xp_total: 0, badges: [] });
  });

  it('POST /academy/progress/complete-step — a step with no reward entry just marks completed, no XP/badge', async () => {
    const org = await fx.createOrg('Academy Org 2');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };
    const res = await app.inject({
      method: 'POST', url: '/academy/progress/complete-step',
      headers, payload: { step_id: 'employee-ch1-intro' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ already_completed: false, reward_granted: false, xp_awarded: 0 });

    const progress = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(emp.telegramId) });
    expect(progress.json().completed_step_ids).toEqual(['employee-ch1-intro']);
    expect(progress.json().xp_total).toBe(0);
  });

  it('a step present in the server reward table grants XP + badge exactly once, even if completed twice', async () => {
    const org = await fx.createOrg('Academy Org 3');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const first = await app.inject({
      method: 'POST', url: '/academy/progress/complete-step',
      headers, payload: { step_id: 'employee-ch1-complete' }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      already_completed: false, reward_granted: true, xp_awarded: 50,
      badge: { code: 'academy_employee_ch1', title: 'Первая замена' }
    });

    // Replay — client retry, double-tap, re-run of an already-finished
    // course: must NOT grant XP/badge a second time.
    const second = await app.inject({
      method: 'POST', url: '/academy/progress/complete-step',
      headers, payload: { step_id: 'employee-ch1-complete' }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ already_completed: true, reward_granted: false, xp_awarded: 0 });

    const progress = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(emp.telegramId) });
    expect(progress.json().xp_total).toBe(50);
    expect(progress.json().badges).toHaveLength(1);
    expect(progress.json().badges[0].code).toBe('academy_employee_ch1');
  });

  it('Academy XP/badges are a separate namespace from production gamification (employees.xp untouched)', async () => {
    const org = await fx.createOrg('Academy Org 4');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const before = await query(`SELECT xp FROM employees WHERE id = $1`, [emp.id]);
    await app.inject({
      method: 'POST', url: '/academy/progress/complete-step',
      headers, payload: { step_id: 'employee-ch1-complete' }
    });
    const after = await query(`SELECT xp FROM employees WHERE id = $1`, [emp.id]);
    expect(Number(after.rows[0].xp)).toBe(Number(before.rows[0].xp));

    const badgeRow = await query(`SELECT 1 FROM employee_badges WHERE employee_id = $1`, [emp.id]);
    expect(badgeRow.rows.length).toBe(0);
  });

  it('contextual lesson dismissal is per-employee, per-context, and persists', async () => {
    const org = await fx.createOrg('Academy Org 5');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const before = await app.inject({ method: 'GET', url: '/academy/contextual/bfq', headers: authAs(emp.telegramId) });
    expect(before.json()).toEqual({ dismissed: false });

    const dismiss = await app.inject({ method: 'POST', url: '/academy/contextual/dismiss', headers, payload: { context_id: 'bfq' } });
    expect(dismiss.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/academy/contextual/bfq', headers: authAs(emp.telegramId) });
    expect(after.json()).toEqual({ dismissed: true });

    // A different context is unaffected.
    const other = await app.inject({ method: 'GET', url: '/academy/contextual/promos', headers: authAs(emp.telegramId) });
    expect(other.json()).toEqual({ dismissed: false });
  });

  it('every employee-course chapter reward (ch2/ch3/ch4/final) grants its own XP+badge exactly once and accumulates', async () => {
    const org = await fx.createOrg('Academy Org 7');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    const rewards: Record<string, { xp: number; badge: string }> = {
      'employee-ch1-complete': { xp: 50, badge: 'academy_employee_ch1' },
      'employee-ch2-complete': { xp: 60, badge: 'academy_employee_ch2' },
      'employee-ch3-complete': { xp: 60, badge: 'academy_employee_ch3' },
      'employee-ch4-complete': { xp: 40, badge: 'academy_employee_ch4' },
      'employee-final-complete': { xp: 150, badge: 'academy_employee_course_complete' }
    };
    let runningXp = 0;

    for (const [stepId, expected] of Object.entries(rewards)) {
      const first = await app.inject({
        method: 'POST', url: '/academy/progress/complete-step',
        headers, payload: { step_id: stepId }
      });
      expect(first.json()).toEqual({
        already_completed: false, reward_granted: true, xp_awarded: expected.xp,
        badge: { code: expected.badge, title: expect.any(String) }
      });
      runningXp += expected.xp;

      // Replay — must not double-grant this specific step's reward.
      const replay = await app.inject({
        method: 'POST', url: '/academy/progress/complete-step',
        headers, payload: { step_id: stepId }
      });
      expect(replay.json()).toEqual({ already_completed: true, reward_granted: false, xp_awarded: 0 });
    }

    const progress = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(emp.telegramId) });
    expect(progress.json().xp_total).toBe(runningXp);
    expect(progress.json().badges).toHaveLength(Object.keys(rewards).length);
    const badgeCodes = progress.json().badges.map((b: any) => b.code).sort();
    expect(badgeCodes).toEqual(Object.values(rewards).map((r) => r.badge).sort());
  });

  it('progress resume — mid-course completed steps persist across separate requests (server is the source of truth)', async () => {
    const org = await fx.createOrg('Academy Org 8');
    const emp = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headers = { ...authAs(emp.telegramId), 'content-type': 'application/json' };

    await app.inject({ method: 'POST', url: '/academy/progress/complete-step', headers, payload: { step_id: 'employee-ch1-intro' } });
    await app.inject({ method: 'POST', url: '/academy/progress/complete-step', headers, payload: { step_id: 'employee-ch1-complete' } });

    // Simulate resuming later / on a different device: a fresh GET must
    // reflect exactly what was persisted, in no particular client-side order.
    const resumed = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(emp.telegramId) });
    expect(resumed.json().completed_step_ids.sort()).toEqual(['employee-ch1-complete', 'employee-ch1-intro'].sort());
    expect(resumed.json().xp_total).toBe(50);
  });

  it('progress is per-employee — one employee completing a step does not affect another', async () => {
    const org = await fx.createOrg('Academy Org 6');
    const empA = await fx.createEmployee(org, { role: 'employee' });
    const empB = await fx.createEmployee(org, { role: 'employee' });
    const app = await getApp();
    const headersA = { ...authAs(empA.telegramId), 'content-type': 'application/json' };

    await app.inject({
      method: 'POST', url: '/academy/progress/complete-step',
      headers: headersA, payload: { step_id: 'employee-ch1-intro' }
    });

    const progressB = await app.inject({ method: 'GET', url: '/academy/progress', headers: authAs(empB.telegramId) });
    expect(progressB.json().completed_step_ids).toEqual([]);
  });
});
