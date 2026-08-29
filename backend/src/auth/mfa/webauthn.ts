/**
 * WebAuthn/passkey через @simplewebauthn/server (vetted, maintained —
 * §0/§4 запрещают писать WebAuthn-криптографию самостоятельно).
 *
 * rpID/origin — та же MINI_APP_URL, что уже canonical origin для CSRF
 * (auth/csrf.ts::expectedOrigin()), не новая переменная окружения:
 * rpID обязан быть валидным доменным именем (без протокола/порта),
 * origin — полный URL с протоколом. Если MINI_APP_URL не задан
 * (например в тестовом окружении), WebAuthn-регистрация/аутентификация
 * явно недоступна — см. isWebAuthnConfigured().
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential
} from '@simplewebauthn/server';
import * as mfaRepo from '../../data/repositories/mfa.js';

const RP_NAME = 'T2 Sales';

function rpConfig(): { rpID: string; origin: string } | null {
  const raw = process.env.MINI_APP_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return { rpID: url.hostname, origin: raw.replace(/\/$/, '') };
  } catch {
    return null;
  }
}

export function isWebAuthnConfigured(): boolean {
  return rpConfig() !== null;
}

/**
 * §7 (Auth Assurance Hardening, 20.52.1) — `requireUV` is role-driven by
 * the caller (api/routes/auth/mfa.ts passes true for admin/supervisor):
 * privileged enrollment asks for a UV-capable authenticator (PIN/biometric)
 * so authentication later can actually enforce it, not just hint at it.
 * Non-privileged callers keep the softer 'preferred' hint — MFA isn't
 * mandatory policy for them, no reason to force UV hardware they may not
 * have.
 */
export async function startRegistration(employeeId: number, userName: string, userDisplayName: string, requireUV: boolean) {
  const rp = rpConfig();
  if (!rp) throw new Error('WebAuthn is not configured (MINI_APP_URL missing)');
  const existing = await mfaRepo.listActiveWebAuthnCredentials(employeeId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName,
    userDisplayName,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: requireUV ? 'required' : 'preferred' }
  });
  await mfaRepo.createWebAuthnChallenge(employeeId, 'register', options.challenge);
  return options;
}

export async function finishRegistration(
  employeeId: number,
  response: RegistrationResponseJSON,
  deviceName: string | null
): Promise<{ verified: boolean }> {
  const rp = rpConfig();
  if (!rp) return { verified: false };
  const expectedChallenge = await mfaRepo.consumeWebAuthnChallenge(employeeId, 'register');
  if (!expectedChallenge) return { verified: false };

  // §7 — verifyRegistrationResponse throws (rather than returning
  // verified:false) on a mismatched challenge/origin/RPID or malformed
  // response; without this the route handler would surface an opaque 500
  // instead of the same clean "verification failed" outcome every other
  // rejection reason already produces.
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID
    });
  } catch {
    return { verified: false };
  }
  if (!result.verified || !result.registrationInfo) return { verified: false };

  const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
  await mfaRepo.createWebAuthnCredential({
    employeeId,
    credentialId: credential.id,
    publicKeyBase64: Buffer.from(credential.publicKey).toString('base64'),
    counter: credential.counter,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    deviceName
  });
  return { verified: true };
}

export async function startAuthentication(employeeId: number, requireUV: boolean) {
  const rp = rpConfig();
  if (!rp) throw new Error('WebAuthn is not configured (MINI_APP_URL missing)');
  const creds = await mfaRepo.listActiveWebAuthnCredentials(employeeId);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    // §7 — was unconditionally 'discouraged' while the server-side verify
    // call below defaulted requireUserVerification to true (the
    // @simplewebauthn/server default) — an inconsistency where an
    // authenticator honoring the 'discouraged' hint could produce a
    // response the server would then reject. Now explicit and consistent
    // on both sides: privileged callers get 'required'/true, others get
    // 'preferred'/false so a non-UV authenticator still works for them.
    userVerification: requireUV ? 'required' : 'preferred',
    allowCredentials: creds.map((c) => ({ id: c.credential_id }))
  });
  await mfaRepo.createWebAuthnChallenge(employeeId, 'authenticate', options.challenge);
  return options;
}

export async function finishAuthentication(
  employeeId: number,
  response: AuthenticationResponseJSON,
  requireUV: boolean
): Promise<{ verified: boolean }> {
  const rp = rpConfig();
  if (!rp) return { verified: false };
  const expectedChallenge = await mfaRepo.consumeWebAuthnChallenge(employeeId, 'authenticate');
  if (!expectedChallenge) return { verified: false };

  const stored = await mfaRepo.findWebAuthnCredentialById(response.id);
  // §20 инвариант — never accept a response for the wrong account: the
  // credential looked up by the response's own `id` must belong to the
  // SAME employee this authentication ceremony was started for, not
  // just "some employee somewhere". A credential id collision across
  // employees is prevented at the schema level too (UNIQUE, 0022), but
  // this check is what actually stops cross-account credential reuse.
  if (!stored || stored.employee_id !== employeeId) return { verified: false };

  const credential: WebAuthnCredential = {
    id: stored.credential_id,
    publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64')),
    counter: stored.counter
  };

  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential,
      requireUserVerification: requireUV
    });
  } catch {
    // §7 — wrong challenge/origin/RPID/malformed response all throw here;
    // fail closed the same way an invalid signature would (verified:false),
    // not an unhandled 500.
    return { verified: false };
  }
  if (!result.verified) return { verified: false };

  await mfaRepo.updateWebAuthnCounter(stored.credential_id, result.authenticationInfo.newCounter);
  return { verified: true };
}

export async function listCredentials(employeeId: number) {
  return mfaRepo.listActiveWebAuthnCredentials(employeeId);
}

export async function revokeCredential(id: number, employeeId: number): Promise<boolean> {
  return mfaRepo.revokeWebAuthnCredential(id, employeeId);
}
