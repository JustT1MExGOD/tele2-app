/**
 * Не-Telegram вход (20.35, план) — второй provider поверх шва 20.9.0, ради
 * которого он и задумывался (docs/ADR/005-authentication-boundary.md).
 * Зеркало providers/telegram.ts, но источник identity — не подписанный
 * initData, а cookie-сессия (см. data/repositories/sessions.ts): сессия
 * уже резолвит конкретный employee_id, поэтому providerId здесь — сразу он,
 * не внешний id, который потом надо кем-то маппить.
 */
import { FastifyRequest } from 'fastify';
import { resolveSession, touchSession } from '../../data/repositories/sessions.js';
import type { Identity } from '../identity.js';

const COOKIE_NAME = 't2_session';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * §6/RESET-1 (20.52.1) — this specific browser/phone session's
     * mfa_verified_at, surfaced for auth/assurance.ts::checkPrivilegedAssurance
     * to tell "this session completed MFA" (AAL2) apart from "the account
     * merely has a factor configured". Left undefined for Telegram
     * requests (no session object exists for that channel at all —
     * ADR-005) — assurance.ts treats undefined and null differently on
     * purpose, see its docstring.
     */
    sessionMfaVerifiedAt?: string | null;
    /** Raw session token, needed only by MFA enrollment routes that
     * upgrade THIS session to AAL2 right after a factor is confirmed
     * (see sessions.ts::markSessionMfaVerified). Undefined for Telegram. */
    sessionToken?: string;
  }
}

export async function resolvePhoneIdentity(request: FastifyRequest): Promise<Identity | null> {
  const token = request.cookies?.[COOKIE_NAME];
  if (!token) return null;

  const session = await resolveSession(token);
  if (!session) {
    // 20.48.0 — cookie есть, но сессия истекла/невалидна: отдельная причина
    // от Telegram-'expired', чтобы requireAuth/requireActive не отвечали
    // текстом про переоткрытие Mini App человеку в браузере.
    request.authError = 'phone_expired';
    return null;
  }

  touchSession(token).catch(() => {});
  request.sessionMfaVerifiedAt = session.mfa_verified_at;
  request.sessionToken = token;
  return { provider: 'phone', providerId: String(session.employee_id) };
}

export { COOKIE_NAME };
