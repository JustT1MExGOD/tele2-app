/**
 * T2 Miranda, этап 2 — REST для диалогового мессенджера (§4/§5 плана).
 * org_id/employee_id ВСЕГДА из request.user; активный corporate_account_id
 * ВСЕГДА перечитывается с сервера через resolveActiveCorporateAccount() на
 * каждый запрос — никогда не принимается от клиента (§6 плана).
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive } from '../../../auth/guards.js';
import * as messengerService from '../../../core/messenger/service.js';
import { broadcastToMembers } from '../../../core/messenger/realtime-registry.js';
import * as messengerRepo from '../../../data/repositories/messenger.js';
import { employeeAwareKeyGenerator } from '../../../security/rate-limit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const ConversationIdParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type ConversationIdParams = Static<typeof ConversationIdParams>;

const DirectBody = Type.Object({ targetCorporateAccountId: Type.Integer() });
type DirectBody = Static<typeof DirectBody>;

const GroupBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  memberCorporateAccountIds: Type.Array(Type.Integer(), { minItems: 1, maxItems: 100 })
});
type GroupBody = Static<typeof GroupBody>;

const ReadBody = Type.Object({ messageId: Type.String({ pattern: '^[0-9]+$' }) });
type ReadBody = Static<typeof ReadBody>;

const GetMessagesQuery = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 32 })),
  after: Type.Optional(Type.String({ maxLength: 32 })),
  limit: Type.Optional(Type.String({ maxLength: 8 }))
});
type GetMessagesQuery = Static<typeof GetMessagesQuery>;

const PostMessageBody = Type.Object({
  clientMessageId: Type.String({ minLength: 36, maxLength: 36 }),
  body: Type.Optional(Type.Union([Type.String({ maxLength: 5000 }), Type.Null()])),
  attachmentIds: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 20 }))
});
type PostMessageBody = Static<typeof PostMessageBody>;

async function requireActiveAccountOrReply(request: any, reply: any): Promise<number | null> {
  const sessionToken = request.sessionToken;
  if (!sessionToken) {
    reply.code(409).send({ error: 'no_session_token', message: 'Miranda требует сессионный вход (телефон+пароль)' });
    return null;
  }
  const accountId = await messengerService.resolveActiveCorporateAccount(sessionToken);
  if (!accountId) {
    reply.code(409).send({ error: 'no_active_corporate_account', message: 'Нет активного корпоративного аккаунта на этом устройстве' });
    return null;
  }
  return accountId;
}

export async function registerMirandaMessengerRoutes(app: FastifyInstance) {
  app.post('/miranda/conversations/direct', { schema: { body: DirectBody } }, async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const accountId = await requireActiveAccountOrReply(request, reply);
    if (!accountId) return;
    const { targetCorporateAccountId } = request.body as DirectBody;
    const result = await messengerService.findOrCreateDirectConversation(request.user!.org_id, accountId, targetCorporateAccountId);
    if (result.ok !== true) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.code(200).send({ conversationId: result.conversationId });
  });

  app.post('/miranda/conversations/group', { schema: { body: GroupBody } }, async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const accountId = await requireActiveAccountOrReply(request, reply);
    if (!accountId) return;
    const { title, memberCorporateAccountIds } = request.body as GroupBody;
    const result = await messengerService.createGroupConversation(request.user!.org_id, accountId, title, memberCorporateAccountIds);
    if (result.ok !== true) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.code(200).send({ conversationId: result.conversationId });
  });

  app.get('/miranda/conversations', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const accountId = await requireActiveAccountOrReply(request, reply);
    if (!accountId) return;
    const items = await messengerService.listConversations(accountId);
    return reply.code(200).send({ items });
  });

  app.get('/miranda/conversations/:id/members', { schema: { params: ConversationIdParams } }, async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const accountId = await requireActiveAccountOrReply(request, reply);
    if (!accountId) return;
    const { id } = request.params as ConversationIdParams;
    if (!(await messengerService.isMember(id, accountId))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const items = await messengerService.listMembers(id);
    return reply.code(200).send({ items });
  });

  app.post('/miranda/conversations/:id/read', { schema: { params: ConversationIdParams, body: ReadBody } }, async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const accountId = await requireActiveAccountOrReply(request, reply);
    if (!accountId) return;
    const { id } = request.params as ConversationIdParams;
    if (!(await messengerService.isMember(id, accountId))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { messageId } = request.body as ReadBody;
    await messengerService.markRead(id, request.user!.org_id, accountId, request.user!.employee_id!, messageId);
    return reply.code(200).send({ ok: true });
  });

  app.get(
    '/miranda/conversations/:id/messages',
    {
      schema: { params: ConversationIdParams, querystring: GetMessagesQuery },
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: employeeAwareKeyGenerator('miranda_messages_get') }
      }
    },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const accountId = await requireActiveAccountOrReply(request, reply);
      if (!accountId) return;
      const { id } = request.params as ConversationIdParams;
      if (!(await messengerService.isMember(id, accountId))) {
        return reply.code(404).send({ error: 'not_found' });
      }
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
        const items = await messengerService.listMessagesAfter(id, orgId, after, limit);
        return { items, nextCursor: null };
      }
      const result = await messengerService.listMessages(id, orgId, limit, cursor);
      return { items: result.items, nextCursor: result.nextCursor };
    }
  );

  app.post(
    '/miranda/conversations/:id/messages',
    {
      schema: { params: ConversationIdParams, body: PostMessageBody },
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: employeeAwareKeyGenerator('miranda_messages_post') }
      }
    },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const accountId = await requireActiveAccountOrReply(request, reply);
      if (!accountId) return;
      const { id } = request.params as ConversationIdParams;
      if (!(await messengerService.isMember(id, accountId))) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const body = request.body as PostMessageBody;
      if (!UUID_RE.test(body.clientMessageId)) {
        return reply.code(400).send({ error: 'invalid_client_message_id', message: 'clientMessageId должен быть UUID' });
      }
      const attachmentIds = body.attachmentIds || [];
      const orgId = request.user!.org_id;
      const employeeId = request.user!.employee_id!;

      const result = await messengerService.createMessage(orgId, id, accountId, employeeId, body.clientMessageId, body.body, attachmentIds);
      if (result.ok !== true) {
        const statusCode = result.error === 'internal_error' ? 500 : 400;
        return reply.code(statusCode).send({ error: result.error, message: result.message });
      }
      if (!result.deduplicated) {
        void broadcastToMembers(id, { type: 'message', message: result.message });
        try {
          await messengerRepo.publishMessengerChanged(orgId, id, result.message.id);
        } catch (err) {
          request.log.warn({ err }, 'Messenger message saved; realtime signal unavailable');
        }
      }
      return reply.code(200).send(result.message);
    }
  );
}
