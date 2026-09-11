import { describe, it, expect, afterAll } from 'vitest';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { containEmployee } from '../../src/scripts/contain-compromised-employee.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

/**
 * Resilience/recovery tooling (17-layer security hardening pass, new
 * Layer 17) — docs/RUNBOOK.md's employee-compromise procedure previously
 * only documented raw hand-typed SQL; this is the safe script wrapping
 * it. Tests the core logic directly (containEmployee()), same split as
 * tests/isolation/backfill-support-encryption.test.ts uses for the
 * other dry-run/confirm CLI tool in this codebase.
 */
describe('contain-compromised-employee — dry-run-by-default incident-response tooling', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('unknown employee id — found:false, no error thrown', async () => {
    const res = await containEmployee({ employeeId: 999999999, sessions: true });
    expect(res.found).toBe(false);
  });

  it('without --confirm (dryRun) — reports the plan but changes NOTHING', async () => {
    const org = await fx.createOrg('Contain Dry Run Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    await sessionsRepo.createSession(employee.id, false, 'employee');
    await sessionsRepo.createSession(employee.id, false, 'employee');

    const res = await containEmployee({ employeeId: employee.id, sessions: true, deactivate: true });
    expect(res.dryRun).toBe(true);
    expect(res.activeSessions).toBe(2);
    expect(res.applied).toEqual({ sessions: false, mfa: false, deactivate: false });

    const stillActive = await query(`SELECT is_active FROM employees WHERE id = $1`, [employee.id]);
    expect(stillActive.rows[0].is_active).toBe(true);
    const stillHasSessions = await query(`SELECT COUNT(*)::int AS c FROM employee_sessions WHERE employee_id = $1`, [employee.id]);
    expect(stillHasSessions.rows[0].c).toBe(2);
  });

  it('with confirm:true — only the requested actions actually apply, nothing else', async () => {
    const org = await fx.createOrg('Contain Confirm Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    await sessionsRepo.createSession(employee.id, false, 'employee');

    // sessions only — deactivate NOT requested, so is_active must stay true.
    const res = await containEmployee({ employeeId: employee.id, sessions: true, confirm: true });
    expect(res.dryRun).toBe(false);
    expect(res.applied).toEqual({ sessions: true, mfa: false, deactivate: false });

    const sessionsLeft = await query(`SELECT COUNT(*)::int AS c FROM employee_sessions WHERE employee_id = $1`, [employee.id]);
    expect(sessionsLeft.rows[0].c).toBe(0);
    const stillActive = await query(`SELECT is_active FROM employees WHERE id = $1`, [employee.id]);
    expect(stillActive.rows[0].is_active).toBe(true);
  });

  it('--deactivate with confirm:true actually blocks the account', async () => {
    const org = await fx.createOrg('Contain Deactivate Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });

    const res = await containEmployee({ employeeId: employee.id, deactivate: true, confirm: true });
    expect(res.applied.deactivate).toBe(true);

    const row = await query(`SELECT is_active FROM employees WHERE id = $1`, [employee.id]);
    expect(row.rows[0].is_active).toBe(false);
  });
});
