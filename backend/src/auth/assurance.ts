/**
 * Auth Assurance Hardening (20.52.1) — single home for the AAL1/AAL2/AAL3
 * policy that used to be implicit/scattered (MFA_MANDATORY_ROLES was
 * duplicated in api/routes/auth/mfa.ts; "does this account satisfy
 * privileged access" wasn't checked anywhere outside step-up-gated
 * routes). See docs/ADR/009-mfa-step-up.md for the full history —  this
 * file is that ADR's decision made explicit and centralized, not a new
 * architecture.
 *
 * Vocabulary used consistently across this codebase from here on:
 * - AAL1 — primary authentication only (password verified, or Telegram
 *   initData HMAC verified). No MFA involved.
 * - AAL2 — a confirmed second factor was verified as part of establishing
 *   this specific session (browser/phone) or, for the Telegram channel
 *   (which has no session object to attach that fact to, see ADR-005),
 *   the account has at least one confirmed factor at all — the two are
 *   different guarantees, see checkPrivilegedAssurance() below.
 * - AAL3 — a fresh, just-now MFA proof for THIS specific dangerous
 *   action (auth/step-up.ts's ticket). Not "was AAL2 at some point in
 *   this session" — a stolen/left-open session must not be enough to
 *   perform a step-up-gated action on its own.
 */
import type { FastifyRequest } from 'fastify';
import { hasConfirmedMfaFactor } from './mfa/index.js';

/** Roles for which MFA is mandatory policy, not an optional add-on —
 * PRIV-MFA-1/2 invariants (docs/SECURITY.md). */
export const MFA_MANDATORY_ROLES = new Set(['admin', 'supervisor']);

export function isMfaMandatoryForRole(role: string | null | undefined): boolean {
  return !!role && MFA_MANDATORY_ROLES.has(role);
}

export type PrivilegedAssuranceResult =
  | { ok: true }
  | { ok: false; reason: 'mfa_enrollment_required' | 'mfa_reverification_required' };

/**
 * The actual PRIV-MFA-1 enforcement point: can this request's principal
 * use privileged (admin/supervisor) application functionality right now?
 * Called once per request from authPlugin (auth/guards.ts) and cached on
 * request.mfaAssurance — every requireActive()-gated route consumes the
 * cached result synchronously rather than re-querying.
 *
 * Two distinct failure reasons, deliberately not collapsed into one:
 * - mfa_enrollment_required: the account has no confirmed factor at all.
 *   Only path forward is the enrollment endpoints (see requireActive's
 *   allowMfaEnrollment escape hatch).
 * - mfa_reverification_required: the account DOES have a confirmed
 *   factor, but THIS browser/phone session was issued before that factor
 *   existed (or by a code path that bypassed the MFA-login branch — see
 *   §4/RESET-1) and so never actually completed MFA itself. Not
 *   reachable for Telegram (no session object — see class docstring),
 *   where "the account has a factor" is the only assurance signal that
 *   channel can carry.
 */
export async function checkPrivilegedAssurance(
  employeeId: number,
  role: string,
  sessionMfaVerifiedAt: string | null | undefined
): Promise<PrivilegedAssuranceResult> {
  if (!isMfaMandatoryForRole(role)) return { ok: true };
  const hasFactor = await hasConfirmedMfaFactor(employeeId);
  if (!hasFactor) return { ok: false, reason: 'mfa_enrollment_required' };
  // sessionMfaVerifiedAt === undefined means "no session object for this
  // request" (Telegram channel) — nothing further to check there.
  if (sessionMfaVerifiedAt === null) {
    return { ok: false, reason: 'mfa_reverification_required' };
  }
  return { ok: true };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Computed once in authPlugin; undefined until authPlugin has run. */
    mfaAssurance?: PrivilegedAssuranceResult;
  }
}

export function mfaAssuranceOk(request: FastifyRequest): boolean {
  return !request.mfaAssurance || request.mfaAssurance.ok;
}
