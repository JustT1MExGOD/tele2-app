/**
 * Adversarial regression — account lockout is distinct from request rate-limit.
 * A password attacker rotating IPs must not get unlimited attempts against one
 * known employee; a correct password must not bypass an active lock.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { hashPassword } from '../../src/auth/password.js';
import { query } from '../../src/data/db/index.js';

function uniquePhone(): string {
  return '+7904' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('adversarial: account lockout after consecutive failed logins', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('5 failures lock the account; correct password cannot bypass the lock', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Account Lockout Org');
    const phone = uniquePhone();
    const password = 'lockout-correct-password';
    const passwordHash = await hashPassword(password);
    await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Lockout Target' });

    // Distinct forwarded IPs keep this test on the account-lockout axis rather
    // than the per-IP limiter. The phone identity is intentionally the same.
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': `10.88.0.${attempt}` },
        payload: { phone, password: 'wrong-password' }
      });
      if (attempt < 5) {
        expect(response.statusCode).toBe(401);
      } else {
        expect(response.statusCode).toBe(423);
        expect(response.json().error).toBe('account_locked');
      }
    }

    const lockedCorrectPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-forwarded-for': '10.88.0.99' },
      payload: { phone, password }
    });
    expect(lockedCorrectPassword.statusCode).toBe(423);
    expect(lockedCorrectPassword.json().error).toBe('account_locked');

    const state = await query(
      `SELECT failed_attempts, locked_until FROM security_account_lockouts
       WHERE employee_id = (SELECT id FROM employees WHERE phone = $1)`,
      [phone]
    );
    expect(Number(state.rows[0].failed_attempts)).toBe(5);
    expect(state.rows[0].locked_until).toBeTruthy();
  });

  it('expired consecutive-failure window resets instead of locking on an old attempt', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Account Lockout Window Org');
    const phone = uniquePhone();
    const passwordHash = await hashPassword('window-correct-password');
    const { id } = await fx.createPhoneEmployee(org, phone, passwordHash, { fullName: 'Window Target' });

    const first = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-forwarded-for': '10.89.0.1' },
      payload: { phone, password: 'wrong-password' }
    });
    expect(first.statusCode).toBe(401);

    // Simulate the 15-minute failure window expiring without waiting. This is
    // test setup, not the production path: the application never trusts a
    // client-supplied timestamp.
    await query(
      `UPDATE security_account_lockouts
       SET last_failed_at = now() - interval '16 minutes', locked_until = NULL
       WHERE employee_id = $1`,
      [id]
    );

    const next = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-forwarded-for': '10.89.0.2' },
      payload: { phone, password: 'wrong-password' }
    });
    expect(next.statusCode).toBe(401);

    const state = await query(
      `SELECT failed_attempts, locked_until FROM security_account_lockouts WHERE employee_id = $1`,
      [id]
    );
    expect(Number(state.rows[0].failed_attempts)).toBe(1);
    expect(state.rows[0].locked_until).toBeNull();
  });

  it('unknown phone failures do not create an account-lockout row', async () => {
    const app = await getApp();
    const phone = uniquePhone();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': `10.90.0.${attempt}` },
        payload: { phone, password: 'wrong-password' }
      });
      expect(response.statusCode).toBe(401);
    }
    const rows = await query(
      `SELECT 1 FROM security_account_lockouts
       WHERE employee_id IN (SELECT id FROM employees WHERE phone = $1)`,
      [phone]
    );
    expect(rows.rows).toHaveLength(0);
  });
});
