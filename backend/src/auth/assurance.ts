/**
 * Auth Assurance Hardening (20.52.1, revised 20.53.0) — single home for
 * the AAL1/AAL2/AAL3 policy that used to be implicit/scattered
 * (MFA_MANDATORY_ROLES was duplicated in api/routes/auth/mfa.ts; "does
 * this account satisfy privileged access" wasn't checked anywhere
 * outside step-up-gated routes). See docs/ADR/009-mfa-step-up.md for the
 * full history — this file is that ADR's decision made explicit and
 * centralized, not a new architecture.
 *
 * Vocabulary used consistently across this codebase from here on:
 * - AAL1 — primary authentication only (password verified, or Telegram
 *   initData HMAC verified). No MFA involved.
 * - AAL2 — a confirmed second factor was ACTUALLY VERIFIED for this
 *   specific access context: for browser/phone, that's
 *   employee_sessions.mfa_verified_at (set when the session itself was
 *   established via the MFA-login branch); for Telegram (no session
 *   object at all — ADR-005), that's a short-lived server-side grant
 *   (auth/mfa/telegram-grant.ts, mfa_telegram_grants table) obtained by
 *   completing a real MFA challenge within the current Mini App context.
 *   Both channels now require the SAME kind of concrete proof — "has a
 *   confirmed factor configured" is necessary but never sufficient on
 *   its own (see 20.53.0 revision note below).
 * - AAL3 — a fresh, just-now MFA proof for THIS specific dangerous
 *   action (auth/step-up.ts's ticket). Not "was AAL2 at some point in
 *   this session/grant" — a stolen/left-open session or grant must not
 *   be enough to perform a step-up-gated action on its own.
 *
 * 20.53.0 revision — closed Telegram bypass: before this, a Telegram
 * request from an admin/supervisor whose account merely HAD a confirmed
 * factor configured was treated as AAL2, without that factor ever being
 * verified for the current access context (no Telegram "login" event to
 * gate on). A compromised device/session with valid initData HMAC could
 * reach privileged functionality on that alone. Fixed by requiring the
 * SAME concrete, timestamped proof both channels now: browser via
 * session.mfa_verified_at, Telegram via a real per-context grant.
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
 * `channelAal2VerifiedAt` — a concrete timestamp string (truthy) means
 * AAL2 was actually verified for THIS channel context (browser session
 * or Telegram grant, see class docstring); `null` means it was not
 * (either no session/grant at all, or one that predates the factor being
 * configured). Callers MUST resolve this per-channel before calling —
 * this function no longer distinguishes channels itself, by design: both
 * now carry the exact same kind of proof, so there is nothing
 * channel-specific left to special-case here.
 *
 * Two distinct failure reasons, deliberately not collapsed into one:
 * - mfa_enrollment_required: the account has no confirmed factor at all.
 *   Only path forward is the enrollment endpoints (see requireActive's
 *   allowMfaEnrollment escape hatch).
 * - mfa_reverification_required: the account DOES have a confirmed
 *   factor, but this channel context (session or grant) never actually
 *   proved it — either none exists yet, or it predates the factor (see
 *   §4/RESET-1 for the browser case; for Telegram, simply "no grant
 *   issued yet in this access context").
 */
export async function checkPrivilegedAssurance(
  employeeId: number,
  role: string,
  channelAal2VerifiedAt: string | null
): Promise<PrivilegedAssuranceResult> {
  if (!isMfaMandatoryForRole(role)) return { ok: true };
  const hasFactor = await hasConfirmedMfaFactor(employeeId);
  if (!hasFactor) return { ok: false, reason: 'mfa_enrollment_required' };
  if (channelAal2VerifiedAt === null) {
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
