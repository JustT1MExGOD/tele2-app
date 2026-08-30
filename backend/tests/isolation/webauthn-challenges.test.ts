/**
 * §P1-B (20.54.0) — WebAuthn ceremony challenge lifecycle
 * (data/repositories/mfa.ts::createWebAuthnChallenge/consumeWebAuthnChallenge).
 * No test coverage existed for this at all before this pass, despite it
 * being the single point that decides purpose-binding (register vs
 * authenticate), TTL, employee-scoping, and single-use consumption for
 * every WebAuthn ceremony in the app (login-time MFA, step-up, Telegram
 * AAL2 verify, and registration itself all go through it).
 *
 * Full end-to-end ceremonies (auth/mfa/webauthn.ts::startRegistration/
 * finishRegistration/startAuthentication/finishAuthentication) are
 * deliberately NOT covered here — that would require synthesizing a
 * real authenticator keypair + signed clientDataJSON/authenticatorData
 * matching @simplewebauthn/server's exact wire format, which is
 * disproportionate to what's actually being verified: the race-safety,
 * TTL, and scoping properties all live in this repository layer, not in
 * the (vetted, not-our-code) cryptographic verification itself.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { query } from '../../src/data/db/index.js';
import { createWebAuthnChallenge, consumeWebAuthnChallenge } from '../../src/data/repositories/mfa.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('WebAuthn ceremony challenges (data/repositories/mfa.ts)', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('single-use — concurrent consume() calls: exactly one gets the challenge', async () => {
    const emp = await fx.createEmployee(await fx.createOrg(), { role: 'employee', mfa: false });
    await createWebAuthnChallenge(emp.id, 'authenticate', 'challenge-parallel-test');

    const [a, b] = await Promise.all([
      consumeWebAuthnChallenge(emp.id, 'authenticate'),
      consumeWebAuthnChallenge(emp.id, 'authenticate')
    ]);
    const winners = [a, b].filter((v) => v !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toBe('challenge-parallel-test');

    // A third, later consume() finds nothing left — not re-issued, not
    // silently reset by the losing concurrent call.
    const third = await consumeWebAuthnChallenge(emp.id, 'authenticate');
    expect(third).toBeNull();
  });

  it('expired challenge is never returned, even though still formally unconsumed', async () => {
    const emp = await fx.createEmployee(await fx.createOrg(), { role: 'employee', mfa: false });
    // createWebAuthnChallenge() hardcodes a 5-minute TTL — bypass it via
    // direct SQL to test the expiry branch without waiting 5 minutes.
    await query(
      `INSERT INTO mfa_webauthn_challenges (employee_id, kind, challenge, expires_at)
       VALUES ($1, 'authenticate', 'expired-challenge', now() - interval '1 second')`,
      [emp.id]
    );
    const result = await consumeWebAuthnChallenge(emp.id, 'authenticate');
    expect(result).toBeNull();
  });

  it('kind is a hard boundary — a register challenge is invisible to an authenticate consume, and vice versa', async () => {
    const emp = await fx.createEmployee(await fx.createOrg(), { role: 'employee', mfa: false });
    await createWebAuthnChallenge(emp.id, 'register', 'register-challenge');
    expect(await consumeWebAuthnChallenge(emp.id, 'authenticate')).toBeNull();
    expect(await consumeWebAuthnChallenge(emp.id, 'register')).toBe('register-challenge');
  });

  it('employee-scoped — one employee cannot consume another employee\'s challenge', async () => {
    const orgId = await fx.createOrg();
    const empA = await fx.createEmployee(orgId, { role: 'employee', mfa: false });
    const empB = await fx.createEmployee(orgId, { role: 'employee', mfa: false });
    await createWebAuthnChallenge(empA.id, 'authenticate', 'a-only-challenge');
    expect(await consumeWebAuthnChallenge(empB.id, 'authenticate')).toBeNull();
    expect(await consumeWebAuthnChallenge(empA.id, 'authenticate')).toBe('a-only-challenge');
  });

  // §P1-B — the same 'authenticate' kind is shared by three different
  // flows (login-time MFA, step-up, Telegram AAL2 verify: all three call
  // auth/mfa/webauthn.ts::startAuthentication/finishAuthentication with
  // no flow-specific kind). Verified here: this repository layer does
  // NOT itself enforce "the right challenge for the right ceremony" — it
  // just hands out whichever unconsumed 'authenticate' challenge for
  // this employee is most recent, consumed() calls included. If two
  // ceremonies are pending at once, BOTH challenge strings are
  // eventually consumable (newest first), not just one.
  //
  // This is still safe, not a bypass: a WebAuthn assertion cryptographically
  // embeds the exact challenge bytes the authenticator actually signed
  // (clientDataJSON.challenge), and auth/mfa/webauthn.ts::finishAuthentication
  // passes whatever this layer returns as `expectedChallenge` straight into
  // @simplewebauthn/server's verifyAuthenticationResponse(), which rejects
  // any mismatch. So the worst case from two overlapping ceremonies is a
  // legitimate response occasionally failing to verify because the "wrong"
  // (mismatched) challenge got consumed first — a usability edge case, not
  // a security one: no response can ever be accepted against a challenge
  // it didn't itself sign, and single-use consumption still prevents any
  // one challenge from being reused for a second verification.
  it('when two authenticate challenges are pending, both are eventually consumable, newest first — never reused', async () => {
    const emp = await fx.createEmployee(await fx.createOrg(), { role: 'employee', mfa: false });
    await createWebAuthnChallenge(emp.id, 'authenticate', 'older-challenge');
    await createWebAuthnChallenge(emp.id, 'authenticate', 'newer-challenge');
    expect(await consumeWebAuthnChallenge(emp.id, 'authenticate')).toBe('newer-challenge');
    expect(await consumeWebAuthnChallenge(emp.id, 'authenticate')).toBe('older-challenge');
    // Both now consumed — nothing left, and neither is handed out twice.
    expect(await consumeWebAuthnChallenge(emp.id, 'authenticate')).toBeNull();
  });
});
