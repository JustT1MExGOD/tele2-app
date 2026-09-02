/**
 * REST-эндпоинты чата — история (keyset-пагинация) и отправка сообщения
 * (§5/§6 брифа). org_id/senderId ВСЕГДА берутся из request.user (см.
 * заголовок core/chat/service.ts) — client_id/org_id из тела запроса НЕ
 * читаются вообще, в отличие от resolveViewOrgId()-паттерна остальных
 * роутов (там override для admin — сознательная фича; здесь её нет,
 * scope переписки НИКОГДА не выбирается запросом, см. итоговый отчёт).
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive } from '../../../auth/guards.js';
import * as chatService from '../../../core/chat/service.js';
import { broadcastToOrg } from '../../../core/chat/realtime-registry.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const GetMessagesQuery = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 32 })),
  // after — polling fallback / WS-reconnect catch-up (§8/§9 брифа): "что
  // появилось новее этого id", ASC. Взаимоисключим с cursor в обработчике —
  // это два разных направления одной и той же keyset-пагинации, смешивать
  // их в одном запросе не имеет смысла.
  after: Type.Optional(Type.String({ maxLength: 32 })),
  limit: Type.Optional(Type.String({ maxLength: 8 }))
});
type GetMessagesQuery = Static<typeof GetMessagesQuery>;

const PostMessageBody = Type.Object({
  clientMessageId: Type.String({ minLength: 36, maxLength: 36 }),
  body: Type.Optional(Type.Union([Type.String({ maxLength: 5000 }), Type.Null()])),
  // maxItems здесь — только грубый ранний отсев абсурдных payload'ов
  // (сотни id'шников), НЕ бизнес-лимит: реальную границу в 5 вложений на
  // сообщение (§11 брифа) проверяет core/chat/service.ts::createMessage()
  // и отвечает своим кодом ошибки (too_many_attachments) — держать оба
  // предела на одном числе означало бы, что schema-валидатор перехватывает
  // запрос первым с невыразительным validation_failed вместо него.
  attachmentIds: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 20 }))
});
type PostMessageBody = Static<typeof PostMessageBody>;

export async function registerChatMessageRoutes(app: FastifyInstance) {
  app.get(
    '/chat/messages',
    { schema: { querystring: GetMessagesQuery }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const { cursor, after, limit: limitRaw } = request.query as GetMessagesQuery;
      let limit = DEFAULT_PAGE_SIZE;
      if (limitRaw !== undefined) {
        const parsed = Number(limitRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return reply.code(400).send({ error: 'invalid_limit', message: 'Некорректный limit' });
        }
        limit = Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
      }
      if (cursor !== undefined && !/^\d+$/.test(cursor)) {
        return reply.code(400).send({ error: 'invalid_cursor', message: 'Некорректный cursor' });
      }
      if (after !== undefined && !/^\d+$/.test(after)) {
        return reply.code(400).send({ error: 'invalid_after', message: 'Некорректный after' });
      }
      if (cursor !== undefined && after !== undefined) {
        return reply.code(400).send({ error: 'conflicting_params', message: 'cursor и after взаимоисключающие' });
      }
      const orgId = request.user!.org_id;
      if (after !== undefined) {
        const items = await chatService.listMessagesAfter(orgId, after, limit);
        return { items, nextCursor: null };
      }
      const result = await chatService.listMessages(orgId, limit, cursor);
      return { items: result.items, nextCursor: result.nextCursor };
    }
  );

  app.post(
    '/chat/messages',
    // Спам-защита отправки сообщений — отдельно от глобального IP-лимита
    // (app.ts), ключ по IP (тот же keyGenerator по умолчанию) сознательно
    // недостаточен сам по себе (сотрудники сети могут сидеть за одним
    // NAT/офисным IP, §14 брифа) — почему это ok для MVP-объёма см.
    // итоговый отчёт (раздел O): 20/мин с одного IP уже покрывает и
    // "весь офис долбит чат", DB unique(client_message_id) отдельно не
    // даёт задвоить сообщения при повторных попытках.
    { schema: { body: PostMessageBody }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const body = request.body as PostMessageBody;
      if (!UUID_RE.test(body.clientMessageId)) {
        return reply.code(400).send({ error: 'invalid_client_message_id', message: 'clientMessageId должен быть UUID' });
      }
      const attachmentIds = body.attachmentIds || [];
      const orgId = request.user!.org_id;
      const senderId = request.user!.employee_id!;

      const result = await chatService.createMessage(orgId, senderId, body.clientMessageId, body.body, attachmentIds);
      if (result.ok !== true) {
        const statusCode = result.error === 'internal_error' ? 500 : 400;
        return reply.code(statusCode).send({ error: result.error, message: result.message });
      }
      if (!result.deduplicated) {
        broadcastToOrg(orgId, { type: 'message', message: result.message });
      }
      return reply.code(200).send(result.message);
    }
  );
}
