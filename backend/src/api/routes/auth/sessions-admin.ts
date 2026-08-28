/**
 * 20.48.0 (Web Security & Trust Layer, Auth & Session Security) —
 * просмотр/отзыв активных browser-сессий. Работает для ЛЮБОГО provider'а
 * (join по employee_id, не по provider) — Telegram-пользователь тоже
 * может увидеть и отозвать свою браузерную (phone) сессию, current у него
 * закономерно false на всех строках (нет t2_session cookie в его запросе).
 * Список — только id/created_at/last_seen_at/current, без IP/User-Agent/
 * геолокации: PII/privacy surface, не запрошено.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { requireActive } from '../../../auth/guards.js';
import { COOKIE_NAME } from '../../../auth/providers/phone.js';
import { CSRF_COOKIE_NAME } from '../../../auth/csrf.js';
import * as sessionsRepo from '../../../data/repositories/sessions.js';
import type { ListSessionsResponse, RevokeSessionResponse, RevokeOtherSessionsResponse } from '../../../shared/api-types.js';

function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

export async function registerSessionsAdminRoutes(app: FastifyInstance) {
  app.get('/auth/sessions', async (request, reply): Promise<ListSessionsResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const currentToken = request.cookies?.[COOKIE_NAME];
    const currentHash = currentToken ? sessionsRepo.hashToken(currentToken) : null;
    const rows = await sessionsRepo.listForEmployee(request.user!.employee_id!);
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        last_seen_at: r.last_seen_at,
        current: currentHash !== null && r.token_hash === currentHash
      }))
    };
  });

  app.delete('/auth/sessions/:id', async (request, reply): Promise<RevokeSessionResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const removed = await sessionsRepo.deleteById(Number(id), request.user!.employee_id!);
    if (!removed) return reply.code(404).send({ error: 'not_found', message: 'Сессия не найдена' });

    // Отозвана именно ТЕКУЩАЯ сессия — endpoint безопасен сам по себе, не
    // полагается на то, что фронтенд не покажет кнопку на своей строке:
    // чистим оба cookie на ответе, эквивалент logout.
    const currentToken = request.cookies?.[COOKIE_NAME];
    if (currentToken && sessionsRepo.hashToken(currentToken) === removed.token_hash) {
      clearAuthCookies(reply);
    }
    return { ok: true };
  });

  app.post('/auth/sessions/revoke-others', async (request, reply): Promise<RevokeOtherSessionsResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const currentToken = request.cookies?.[COOKIE_NAME];
    if (!currentToken) {
      return reply.code(400).send({ error: 'no_current_session', message: 'Нет активной browser-сессии для сравнения' });
    }
    await sessionsRepo.deleteAllExcept(request.user!.employee_id!, sessionsRepo.hashToken(currentToken));
    return { ok: true };
  });
}
