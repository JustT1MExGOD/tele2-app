/**
 * Объявления сети и каналы-обсуждения. Выделено из routes-v13.ts.
 * announcements.org_id и channels.org_id существовали в схеме и раньше,
 * но ни один запрос их не читал — тот же паттерн, что plan_share и
 * micro_report_times до этого: сотрудник любой сети видел объявления
 * и мог читать/писать в каналы вообще всех сетей.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, requireManager, resolveViewOrgId } from '../../../auth/guards.js';
import * as commsRepo from '../../../data/repositories/comms.js';
import type { AnnouncementsListResponse, CreateAnnouncementResponse, AnnouncementReadsResponse } from '../../../shared/api-types.js';

const PostAnnouncementBody = Type.Object({
  title: Type.String({ minLength: 1 }),
  body: Type.String({ minLength: 1 }),
  required: Type.Optional(Type.Boolean()),
  org_id: Type.Optional(Type.String())
});
type PostAnnouncementBody = Static<typeof PostAnnouncementBody>;

const PostChannelMessageBody = Type.Object({
  body: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  due_at: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type PostChannelMessageBody = Static<typeof PostChannelMessageBody>;

export async function registerCommsRoutes(app: FastifyInstance) {
  app.get('/announcements', async (request, reply): Promise<AnnouncementsListResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const empId = request.user!.employee_id!;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return commsRepo.listActiveForEmployee(empId, orgId);
  });

  app.post(
    '/announcements',
    { schema: { body: PostAnnouncementBody } },
    async (request, reply): Promise<CreateAnnouncementResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const body = request.body as PostAnnouncementBody;
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    return commsRepo.create(body.title, body.body, body.required, request.user!.employee_id, orgId);
    }
  );

  // Security audit (20.52.0) — раньше без org-проверки: любой сотрудник
  // мог отметить прочитанным объявление ЧУЖОЙ сети, зная/угадав id.
  app.post('/announcements/:id/read', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const annOrgId = await commsRepo.findOrgId(id);
    if (!annOrgId || annOrgId !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Объявление не принадлежит вашей сети' });
    }
    await commsRepo.markRead(Number(id), request.user!.employee_id);
    return { ok: true };
  });

  // Кто прочитал объявление — раньше read-статус был виден только самому
  // сотруднику (is_read у себя), manager не мог понять, кто из команды ещё
  // не в курсе обязательного объявления.
  app.get('/announcements/:id/reads', async (request, reply): Promise<AnnouncementReadsResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);

    const annOrgId = await commsRepo.findOrgId(id);
    if (!annOrgId || annOrgId !== orgId) {
      return reply.code(403).send({ error: 'forbidden', message: 'Объявление не принадлежит вашей сети' });
    }

    const read = await commsRepo.listReads(id, orgId);
    const unread = await commsRepo.listUnread(id, orgId);
    return { read, unread };
  });

  async function assertChannelInOrg(channelId: string, orgId: string): Promise<boolean> {
    const channelOrgId = await commsRepo.findChannelOrgId(channelId);
    return !!channelOrgId && channelOrgId === orgId;
  }

  app.get('/channels/:id/messages', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = request.query as { org_id?: string };
    if (!(await assertChannelInOrg(id, resolveViewOrgId(request.user!, org_id)))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Канал не принадлежит вашей сети' });
    }
    const rows = await commsRepo.listChannelMessages(id);
    return rows.reverse();
  });

  app.post(
    '/channels/:id/messages',
    { schema: { body: PostChannelMessageBody } },
    async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as PostChannelMessageBody;
    if (!(await assertChannelInOrg(id, resolveViewOrgId(request.user!, body.org_id)))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Канал не принадлежит вашей сети' });
    }
    const text = String(body.body || body.message || '').trim();
    if (!text) return reply.code(400).send({ error: 'body required' });
    return commsRepo.createChannelMessage(id, request.user!.employee_id, text, body.due_at || null);
    }
  );
}
