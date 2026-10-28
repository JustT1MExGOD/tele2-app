/**
 * 20.85.0 — full WebAuthn ceremony coverage with a real software
 * authenticator (tests/helpers/virtual-authenticator.ts). Previously only
 * boundary cases were covered (malformed input, wrong credential id, "not
 * configured", UV options) — the actual cryptographic happy path and the
 * signature/challenge/rpId negative paths were untested end-to-end because
 * there was no authenticator that could mint a valid response.
 *
 * The fixture is NOT a stub that bypasses verification: it produces real
 * ES256 signatures over `authData || sha256(clientDataJSON)`, exactly what
 * verifyAuthenticationResponse() checks. A wrong signature, a stale
 * challenge, a mismatched rpId, or a credential that doesn't belong to the
 * employee must all fail closed — that's what this locks.
 *
 * MINI_APP_URL is set in beforeAll because rpConfig() reads it lazily per
 * call (isWebAuthnConfigured()); tests run against the test DB schema.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VirtualAuthenticator, isoBase64URL } from '../helpers/virtual-authenticator.js';
import { TestFixtures } from '../helpers/fixtures.js';
import * as webauthn from '../../src/auth/mfa/webauthn.js';
import * as mfaRepo from '../../src/data/repositories/mfa.js';

const ORIGIN = 'https://t2.example.test';
const RPID = 't2.example.test';

describe('WebAuthn full ceremony (virtual authenticator)', () => {
  const fx = new TestFixtures();
  let savedUrl: string | undefined;

  beforeAll(() => {
    savedUrl = process.env.MINI_APP_URL;
    process.env.MINI_APP_URL = ORIGIN;
  });

  afterAll(async () => {
    if (savedUrl === undefined) delete process.env.MINI_APP_URL;
    else process.env.MINI_APP_URL = savedUrl;
    await fx.cleanup();
  });

  async function emp() {
    return fx.createEmployee(await fx.createOrg(), { role: 'employee', mfa: false });
  }

  it('register → authenticate round-trip: a credential enrolled then used verifies', async () => {
    const e = await emp();
    const authn = VirtualAuthenticator.create();

    // --- registration ceremony ---
    const regOptions = await webauthn.startRegistration(e.id, `u${e.id}`, 'Test User', false);
    expect(typeof regOptions.challenge).toBe('string');
    const attestation = authn.attestation({ rpId: RPID, challenge: regOptions.challenge, origin: ORIGIN });
    const regResult = await webauthn.finishRegistration(e.id, attestation as any, 'test-key');
    expect(regResult.verified).toBe(true);
    // The credential is persisted and listed.
    const creds = await mfaRepo.listActiveWebAuthnCredentials(e.id);
    expect(creds).toHaveLength(1);
    expect(creds[0].credential_id).toBe(authn.credentialId.toString('base64url'));

    // --- authentication ceremony ---
    const authOptions = await webauthn.startAuthentication(e.id, false);
    const assertion = authn.assertion({ rpId: RPID, challenge: authOptions.challenge, origin: ORIGIN });
    const authResult = await webauthn.finishAuthentication(e.id, assertion as any, false);
    expect(authResult.verified).toBe(true);
  });

  it('wrong signature is rejected — authenticating with a different key than the registered credential', async () => {
    const e = await emp();
    const authn = VirtualAuthenticator.create();
    const wrongKey = VirtualAuthenticator.create(); // different keypair entirely

    const regOptions = await webauthn.startRegistration(e.id, `u${e.id}`, 'Test User', false);
    await webauthn.finishRegistration(e.id, authn.attestation({ rpId: RPID, challenge: regOptions.challenge, origin: ORIGIN }) as any, null);

    const authOptions = await webauthn.startAuthentication(e.id, false);
    // Sign the assertion with the WRONG private key — signature won't verify
    // against the stored credential public key.
    const bad = authn.assertion({ rpId: RPID, challenge: authOptions.challenge, origin: ORIGIN, wrongKey });
    expect(await webauthn.finishAuthentication(e.id, bad as any, false)).toMatchObject({ verified: false });
  });

  it('mismatched challenge is rejected — a response signed for a different challenge does not verify', async () => {
    const e = await emp();
    const authn = VirtualAuthenticator.create();
    const regOptions = await webauthn.startRegistration(e.id, `u${e.id}`, 'Test User', false);
    await webauthn.finishRegistration(e.id, authn.attestation({ rpId: RPID, challenge: regOptions.challenge, origin: ORIGIN }) as any, null);

    // Start authentication, consume the real challenge, then try to reuse an
    // assertion signed against a DIFFERENT challenge.
    const authOptions = await webauthn.startAuthentication(e.id, false);
    await mfaRepo.consumeWebAuthnChallenge(e.id, 'authenticate'); // eat the good one
    // Re-create a challenge so there's something to consume, but sign the
    // assertion against a wrong challenge value.
    const { createWebAuthnChallenge } = mfaRepo;
    await createWebAuthnChallenge(e.id, 'authenticate', authOptions.challenge);
    const wrongChallenge = isoBase64URL.fromBuffer(Buffer.from('different-challenge-bytes'));
    const bad = authn.assertion({ rpId: RPID, challenge: wrongChallenge, origin: ORIGIN });
    expect(await webauthn.finishAuthentication(e.id, bad as any, false)).toMatchObject({ verified: false });
  });

  it('mismatched rpId is rejected — an assertion signed for another origin does not verify', async () => {
    const e = await emp();
    const authn = VirtualAuthenticator.create();
    const regOptions = await webauthn.startRegistration(e.id, `u${e.id}`, 'Test User', false);
    await webauthn.finishRegistration(e.id, authn.attestation({ rpId: RPID, challenge: regOptions.challenge, origin: ORIGIN }) as any, null);

    const authOptions = await webauthn.startAuthentication(e.id, false);
    // Signature is genuine but for a DIFFERENT rpId — the rpIdHash inside
    // authData won't match, so verification fails.
    const bad = authn.assertion({ rpId: 'evil.test', challenge: authOptions.challenge, origin: 'https://evil.test' });
    expect(await webauthn.finishAuthentication(e.id, bad as any, false)).toMatchObject({ verified: false });
  });

  it('credential not owned by the employee is rejected — a valid assertion under another account does not verify for this employee', async () => {
    const owner = await emp();
    const intruder = await emp();
    const authn = VirtualAuthenticator.create();

    const regOptions = await webauthn.startRegistration(owner.id, `u${owner.id}`, 'Owner', false);
    await webauthn.finishRegistration(owner.id, authn.attestation({ rpId: RPID, challenge: regOptions.challenge, origin: ORIGIN }) as any, null);

    // Intruder starts an authentication ceremony — but the stored credential
    // belongs to `owner`, not to them. finishAuthentication checks
    // stored.employee_id === employeeId before verifying.
    const authOptions = await webauthn.startAuthentication(intruder.id, false);
    const assertion = authn.assertion({ rpId: RPID, challenge: authOptions.challenge, origin: ORIGIN });
    expect(await webauthn.finishAuthentication(intruder.id, assertion as any, false)).toMatchObject({ verified: false });
  });
});
