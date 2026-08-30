import * as mfaRepo from '../../data/repositories/mfa.js';
import { isTotpConfirmed } from './totp.js';

/** True if the employee has at least one usable second factor — used to
 * decide (a) whether login must branch into the MFA-verification step,
 * and (b) implicitly, whether POST /auth/mfa/step-up can ever succeed
 * for them at all (see auth/step-up.ts docstring). */
export async function hasConfirmedMfaFactor(employeeId: number): Promise<boolean> {
  if (await isTotpConfirmed(employeeId)) return true;
  const creds = await mfaRepo.listActiveWebAuthnCredentials(employeeId);
  return creds.length > 0;
}

export * as totp from './totp.js';
export * as webauthn from './webauthn.js';
export * as recoveryCodes from './recovery-codes.js';
export * as telegramGrant from './telegram-grant.js';
