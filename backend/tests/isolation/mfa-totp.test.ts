/**
 * 20.52.0 (MFA) — TOTP через otplib (vetted library, RFC 6238 official
 * test vectors indirectly covered by the library's own test suite; here
 * we test OUR integration: enrollment/confirm/replay-protection/disable
 * against a real local Postgres, not otplib's algorithm itself).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { generate } from 'otplib';
import { query } from '../../src/data/db/index.js';
import { TestFixtures } from '../helpers/fixtures.js';
import * as totp from '../../src/auth/mfa/totp.js';

describe('auth/mfa/totp', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('enroll → confirm with a valid code → isTotpConfirmed() true', async () => {
    const org = await fx.createOrg('TOTP Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const enrollment = await totp.startTotpEnrollment(id, 'test-label');
    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/); // Base32
    expect(enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(await totp.isTotpConfirmed(id)).toBe(false);

    const code = await generate({ secret: enrollment.secret });
    const ok = await totp.confirmTotpEnrollment(id, code);
    expect(ok).toBe(true);
    expect(await totp.isTotpConfirmed(id)).toBe(true);
  });

  it('confirm with a wrong code fails, does not confirm', async () => {
    const org = await fx.createOrg('TOTP Wrong Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    await totp.startTotpEnrollment(id, 'test-label');
    const ok = await totp.confirmTotpEnrollment(id, '000000');
    expect(ok).toBe(false);
    expect(await totp.isTotpConfirmed(id)).toBe(false);
  });

  it('unconfirmed enrollment does not satisfy verifyConfirmedTotp (§5 invariant)', async () => {
    const org = await fx.createOrg('TOTP Unconfirmed Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const enrollment = await totp.startTotpEnrollment(id, 'test-label');
    const code = await generate({ secret: enrollment.secret });
    // Не подтверждали через confirmTotpEnrollment — verifyConfirmedTotp
    // (используется login-time/step-up) обязан отклонить, даже с верным кодом.
    expect(await totp.verifyConfirmedTotp(id, code)).toBe(false);
  });

  it('replay protection: the same code cannot be used twice', async () => {
    const org = await fx.createOrg('TOTP Replay Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const enrollment = await totp.startTotpEnrollment(id, 'test-label');
    const now = Math.floor(Date.now() / 1000);
    const code = await generate({ secret: enrollment.secret, epoch: now });
    expect(await totp.confirmTotpEnrollment(id, code)).toBe(true);

    // Тот же код, тот же timeStep — второй verifyConfirmedTotp обязан
    // отклонить (afterTimeStep replay-защита), не только «код неверный».
    expect(await totp.verifyConfirmedTotp(id, code)).toBe(false);

    // Код для следующего окна — валиден.
    const nextCode = await generate({ secret: enrollment.secret, epoch: now + 30 });
    expect(await totp.verifyConfirmedTotp(id, nextCode)).toBe(true);
  });

  it('rejects non-numeric / malformed codes without throwing', async () => {
    const org = await fx.createOrg('TOTP Malformed Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const enrollment = await totp.startTotpEnrollment(id, 'test-label');
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));

    for (const bad of ['', 'abcdef', '12345', '1234567890123', '<script>alert(1)</script>']) {
      expect(await totp.verifyConfirmedTotp(id, bad)).toBe(false);
    }
  });

  it('re-enrolling replaces the secret and resets confirmed_at/last_time_step', async () => {
    const org = await fx.createOrg('TOTP Reenroll Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const first = await totp.startTotpEnrollment(id, 'first');
    await totp.confirmTotpEnrollment(id, await generate({ secret: first.secret }));
    expect(await totp.isTotpConfirmed(id)).toBe(true);

    const second = await totp.startTotpEnrollment(id, 'second');
    expect(second.secret).not.toBe(first.secret);
    // Новый enrollment снова НЕ подтверждён, пока не пройден confirm.
    expect(await totp.isTotpConfirmed(id)).toBe(false);
    // Старый секрет больше не работает.
    expect(await totp.verifyConfirmedTotp(id, await generate({ secret: first.secret }))).toBe(false);
  });

  it('disableTotp() removes the row entirely', async () => {
    const org = await fx.createOrg('TOTP Disable Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const enrollment = await totp.startTotpEnrollment(id, 'test-label');
    await totp.confirmTotpEnrollment(id, await generate({ secret: enrollment.secret }));
    await totp.disableTotp(id);
    expect(await totp.isTotpConfirmed(id)).toBe(false);
    const row = await query(`SELECT * FROM employee_totp WHERE employee_id = $1`, [id]);
    expect(row.rows.length).toBe(0);
  });
});
