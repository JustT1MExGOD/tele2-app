/**
 * Full Security & Reliability Hardening (20.53.0), P0 §2 — Telegram AAL2
 * grant. Closes the gap confirmed against 20.52.1: checkPrivilegedAssurance()
 * treated "no session object" (Telegram — ADR-005) as license to accept
 * "the account HAS a confirmed factor" as sufficient privileged-access
 * proof, without that factor ever being verified for the CURRENT
 * Telegram access context. A compromised device/account with valid
 * initData could reach privileged functionality on that alone if the
 * victim happened to have MFA configured, without the attacker ever
 * proving the second factor themselves.
 *
 * This is the Telegram-channel equivalent of the browser session's
 * mfa_verified_at: a short-lived (12h), server-side, HttpOnly-cookie-
 * carried opaque grant, issued only after a real TOTP/WebAuthn/recovery
 * verification within THIS Mini App context. Not a second Telegram
 * "login" — initData HMAC verification remains the sole identity proof;
 * this is purely the AAL2 layer on top, for privileged roles only.
 */
import { FastifyReply, FastifyRequest } from 'fastify';
import * as mfaRepo from '../../data/repositories/mfa.js';

export const TELEGRAM_GRANT_COOKIE_NAME = 't2_tg_aal2';
const TELEGRAM_GRANT_MAX_AGE_SECONDS = 12 * 60 * 60; // держим в синхроне с mfaRepo's TTL

const isProd = () => process.env.RAILWAY_ENVIRONMENT === 'production';

/** Same-origin cookie — the Telegram Mini App is served from MINI_APP_URL,
 * the exact origin @simplewebauthn's rpID/CSRF's expectedOrigin already
 * anchor to (auth/csrf.ts, auth/mfa/webauthn.ts) — no cross-site
 * SameSite=None dance needed, same policy as the existing t2_session
 * cookie (auth/providers/phone.ts's consumer, api/routes/auth/session.ts). */
export function setTelegramGrantCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(TELEGRAM_GRANT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: TELEGRAM_GRANT_MAX_AGE_SECONDS
  });
}

export function clearTelegramGrantCookie(reply: FastifyReply): void {
  reply.clearCookie(TELEGRAM_GRANT_COOKIE_NAME, { path: '/' });
}

export async function issueTelegramGrant(employeeId: number, reply: FastifyReply): Promise<void> {
  const token = await mfaRepo.createTelegramGrant(employeeId);
  setTelegramGrantCookie(reply, token);
}

/**
 * Resolves the grant cookie (if present) against the DB for this
 * employee and stashes the raw token on `request.telegramGrantToken`
 * (mirrors `request.sessionToken` for the browser channel — both are
 * "the current request's channel-context token", consumed by step-up
 * ticket binding, see data/repositories/mfa.ts). Returns the grant's
 * verification timestamp (a concrete signal for assurance.ts) or null.
 *
 * Deliberately NOT called unconditionally in authPlugin for every
 * request — only worth the extra query when the resolved role is
 * MFA-mandatory in the first place (see guards.ts::authPlugin), same
 * short-circuit checkPrivilegedAssurance() already applies.
 */
export async function resolveTelegramGrantForRequest(request: FastifyRequest, employeeId: number): Promise<string | null> {
  const token = request.cookies?.[TELEGRAM_GRANT_COOKIE_NAME];
  if (!token) return null;
  const verifiedAt = await mfaRepo.resolveTelegramGrant(employeeId, token);
  if (verifiedAt) request.telegramGrantToken = token;
  return verifiedAt;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw Telegram AAL2 grant token for this request, set only when a
     * valid (unexpired, matching) grant was resolved — see
     * resolveTelegramGrantForRequest(). Undefined for browser/phone
     * requests and for Telegram requests with no/invalid grant. */
    telegramGrantToken?: string;
  }
}
