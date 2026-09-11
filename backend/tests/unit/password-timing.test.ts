import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from '../../src/auth/password.js';

/**
 * Login timing side-channel (security audit hotfix) — POST /auth/login
 * used to short-circuit (`!e || ...`) before ever calling verifyPassword()
 * for an unknown phone number, skipping the expensive scrypt derivation
 * entirely; a known phone always paid that cost. The fix is that the
 * route now always calls verifyPassword(plain, e?.password_hash ||
 * DUMMY_PASSWORD_HASH) — this test verifies DUMMY_PASSWORD_HASH itself is
 * well-formed (so it doesn't fail parsing/length checks and short-circuit
 * BACK to near-zero cost, which would silently defeat the whole fix) and
 * that it never authenticates anyone, at the pure-function level — no
 * HTTP layer, no rate limiter, so this can't be flaky from shared
 * rate-limit budget the way an end-to-end timing test over real requests
 * would be.
 */
describe('DUMMY_PASSWORD_HASH — login timing side-channel fix', () => {
  it('is well-formed enough to reach the real scrypt derivation, not short-circuit on a parse/length check', async () => {
    const parts = DUMMY_PASSWORD_HASH.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(parts.length).toBe(3);
    // KEY_LENGTH is 64 bytes = 128 hex chars — verifyPassword() returns
    // false immediately (never running scrypt) if this doesn't match,
    // which would silently reintroduce the timing gap this fix closes.
    expect(parts[2].length).toBe(128);
    expect(Buffer.from(parts[2], 'hex').length).toBe(64);
  });

  it('never authenticates any password — it is not a real credential', async () => {
    for (const guess of ['', 'password', 'admin', '0'.repeat(64)]) {
      expect(await verifyPassword(guess, DUMMY_PASSWORD_HASH)).toBe(false);
    }
  });

  it('verifying against DUMMY_PASSWORD_HASH costs comparable real scrypt time to verifying against a genuine hash (not near-zero)', async () => {
    const realHash = await hashPassword('some-real-password-for-timing-comparison');

    const timeOf = async (fn: () => Promise<unknown>): Promise<number> => {
      const t0 = performance.now();
      await fn();
      return performance.now() - t0;
    };

    // Average a few runs each — scrypt cost dominates either way, but a
    // couple of samples smooths out incidental jitter.
    const N = 3;
    let realTotal = 0;
    let dummyTotal = 0;
    for (let i = 0; i < N; i++) {
      realTotal += await timeOf(() => verifyPassword('wrong-guess', realHash));
      dummyTotal += await timeOf(() => verifyPassword('wrong-guess', DUMMY_PASSWORD_HASH));
    }
    const realAvg = realTotal / N;
    const dummyAvg = dummyTotal / N;
    // Generous tolerance — the point is proving DUMMY_PASSWORD_HASH pays
    // real scrypt cost (not that timings are pixel-identical). The old
    // bug's skipped path would cost roughly a DB round-trip's worth of
    // time (sub-millisecond in this in-process test), a tiny fraction of
    // scrypt's tens-of-milliseconds cost — so this threshold is easily
    // wide enough to catch a regression back to that shape.
    expect(dummyAvg).toBeGreaterThan(realAvg * 0.5);
  });
});
