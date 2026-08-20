/**
 * Общий хелпер для ручных catch-блоков в роутах. Раньше многие роуты
 * отвечали клиенту `e?.message || String(e)` напрямую — для ошибок из pg
 * это сырой текст Postgres (иногда с именами колонок/constraint'ов),
 * который наружу отдавать не нужно. Реальная причина всё равно уходит в
 * лог (request.log.error), клиент получает только стабильный error-код.
 */
import { FastifyReply, FastifyRequest } from 'fastify';

export function serverError(request: FastifyRequest, reply: FastifyReply, errorCode: string, err: unknown) {
  request.log.error(err);
  return reply.code(500).send({ error: errorCode, message: 'Внутренняя ошибка сервера' });
}
