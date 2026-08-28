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
  return { provider: 'phone', providerId: String(session.employee_id) };
}

export { COOKIE_NAME };
