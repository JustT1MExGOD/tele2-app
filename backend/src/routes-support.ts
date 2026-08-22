/**
 * Поддержка: FAQ + тикеты + чат сообщений
 * Список тикетов и ответы — только role = admin
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, requireAuth } from './middleware-auth.js';
import * as supportRepo from './repositories/support.js';
import { notifyAdmin, notifyUser } from './bot/index.js';
import { supportTicketAdmin } from './bot/messages.js';
import type {
  AdminTicketsSlaResponse,
  FaqListResponse,
  MyTicketsResponse,
  AdminTicketsListResponse,
  CreateTicketResponse,
  TicketReplyResponse
} from './shared/api-types.js';

const TicketMessageBody = Type.Object({
  message: Type.Optional(Type.String()),
  text: Type.Optional(Type.String())
});
type TicketMessageBody = Static<typeof TicketMessageBody>;

const CreateTicketBody = Type.Object({
  message: Type.String({ minLength: 1 }),
  full_name: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  priority: Type.Optional(Type.String())
});
type CreateTicketBody = Static<typeof CreateTicketBody>;

const TicketReplyBody = Type.Object({
  reply: Type.String({ minLength: 1 })
});
type TicketReplyBody = Static<typeof TicketReplyBody>;

function requireAdmin(request: any, reply: any) {
  if (!requireActive(request, reply)) return false;
  if (request.user?.role !== 'admin') {
    reply.code(403).send({ error: 'admin only', message: 'Тикеты доступны только администратору' });
    return false;
  }
  return true;
}

function slaMinutesForPriority(p: string) {
  if (p === 'urgent') return 60;
  if (p === 'high') return 120;
  return 240; // normal — 4ч
}

export async function registerSupportRoutes(app: FastifyInstance) {
  
  /** Admin: тикеты + SLA */
  app.get('/support/admin/tickets', async (request, reply): Promise<AdminTicketsSlaResponse | FastifyReply | undefined> => {
    if (!requireAdmin(request, reply)) return;
    try {
      const items = await supportRepo.listAdminTicketsWithSla();
      return { items };
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message || 'sla_query_failed', hint: 'sql/v8-0-roadmap.sql' });
    }
  });

  app.get('/support/faq', async (): Promise<FaqListResponse> => {
    try {
      return await supportRepo.listActiveFaq();
    } catch {
      return [];
    }
  });

  /** Мои тикеты + сообщения */
  app.get('/support/my', async (request, reply): Promise<MyTicketsResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const tg = Number(request.user!.telegram_id);
    return supportRepo.listMyTickets(tg, request.user!.employee_id);
  });

  app.get('/support/tickets/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await supportRepo.findTicket(Number(id));
    if (!t) return reply.code(404).send({ error: 'not found' });
    const isAdmin = request.user?.role === 'admin';
    const isOwner =
      Number(t.telegram_id) === Number(request.user?.telegram_id) ||
      Number(t.employee_id) === Number(request.user?.employee_id);
    if (!isAdmin && !isOwner) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const messages = await supportRepo.listMessages(Number(id));
    return { ticket: t, messages };
  });

  /** Новое сообщение в тикет (сотрудник или admin) */
  app.post(
    '/support/tickets/:id/messages',
    { schema: { body: TicketMessageBody } },
    async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as TicketMessageBody;
    const text = String(body.message || body.text || '').trim();
    if (!text) return reply.code(400).send({ error: 'message required' });

    const t = await supportRepo.findTicket(Number(id));
    if (!t) return reply.code(404).send({ error: 'not found' });
    const isAdmin = request.user?.role === 'admin';
    const isOwner =
      Number(t.telegram_id) === Number(request.user?.telegram_id) ||
      Number(t.employee_id) === Number(request.user?.employee_id);
    if (!isAdmin && !isOwner) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const sender = isAdmin ? 'admin' : 'user';
    let msg;
    try {
      msg = await supportRepo.addMessage(Number(id), sender, request.user!.employee_id, request.user!.full_name, text);
    } catch {
      // fallback: append to admin_reply
      await supportRepo.appendAdminReplyFallback(Number(id), text);
      return { ok: true, fallback: true };
    }

    if (isAdmin) {
      await supportRepo.markAnsweredByAdmin(Number(id));
    } else {
      await supportRepo.markReopenedByUser(Number(id));
    }

    if (isAdmin && t.telegram_id) {
      await notifyUser(
        t.telegram_id,
        `💬 <b>Ответ поддержки</b>\n\n${text}`
      );
    } else if (!isAdmin) {
      await notifyAdmin(
        supportTicketAdmin({
          from: request.user!.full_name || 'Сотрудник',
          category: 'chat',
          message: text,
          ticketId: Number(id)
        })
      );
    }

    return msg;
    }
  );

  /** Создать тикет */
  app.post(
    '/support',
    { schema: { body: CreateTicketBody } },
    async (request, reply): Promise<CreateTicketResponse | FastifyReply | undefined> => {
    const b = (request.body || {}) as CreateTicketBody;
    const message = String(b.message || '').trim();
    if (!message) return reply.code(400).send({ error: 'message required' });

    // identity — ТОЛЬКО из подтверждённого request.user (Telegram initData),
    // никогда из тела запроса: раньше b.telegram_id/b.employee_id принимались
    // от кого угодно (роут намеренно доступен гостю без карточки) — любой
    // неаутентифицированный вызывающий мог создать тикет от имени чужого
    // employee_id/telegram_id. full_name — не identity-поле само по себе
    // (не даёт доступа ни к чему), гостю без request.user можно представиться
    // самому — но и тут в приоритете подтверждённое имя, если оно есть.
    const telegram_id = request.user?.telegram_id || null;
    const employee_id = request.user?.employee_id || null;
    const full_name = request.user?.full_name || String(b.full_name || '').trim() || 'Гость';
    const category = b.category || 'other';

    let autoAnswer: string | null = null;
    try {
      const faq = await supportRepo.listActiveFaqFull();
      const lower = message.toLowerCase();
      for (const row of faq) {
        const keys: string[] = row.keywords || [];
        if (Array.isArray(keys) && keys.some((k) => lower.includes(String(k).toLowerCase()))) {
          autoAnswer = row.answer;
          break;
        }
      }
    } catch (_) {}

    const priority = b.priority === 'urgent' || b.priority === 'high'
      ? String(b.priority)
      : 'normal';
    const slaMin = slaMinutesForPriority(priority);
    const ticket = await supportRepo.createTicket({
      employeeId: employee_id,
      telegramId: telegram_id,
      fullName: full_name,
      category,
      message,
      status: autoAnswer ? 'answered' : 'open',
      adminReply: autoAnswer,
      answeredAt: autoAnswer ? new Date() : null,
      priority,
      slaMinutes: slaMin
    });

    try {
      await supportRepo.addMessage(ticket.id, 'user', employee_id, full_name, message);
      if (autoAnswer) {
        await supportRepo.addMessage(ticket.id, 'bot', null, 'T2 Support', autoAnswer);
      }
    } catch (_) {}

    if (!autoAnswer) {
      await notifyAdmin(
        supportTicketAdmin({
          from: full_name,
          category,
          message,
          ticketId: ticket.id
        })
      );
    }

    return {
      ticket,
      auto_reply: autoAnswer,
      message: autoAnswer || 'Сообщение отправлено администратору.'
    };
    }
  );

  /** Очередь — только admin */
  app.get('/support/tickets', async (request, reply): Promise<AdminTicketsListResponse | undefined> => {
    if (!requireAdmin(request, reply)) return;
    return supportRepo.listOpenQueue();
  });

  app.post(
    '/support/tickets/:id/reply',
    { schema: { body: TicketReplyBody } },
    async (request, reply): Promise<TicketReplyResponse | FastifyReply | undefined> => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const { reply: text } = request.body as TicketReplyBody;

    const t = await supportRepo.replyAsAdmin(Number(id), String(text));
    if (!t) return reply.code(404).send({ error: 'not found' });

    try {
      await supportRepo.addMessage(Number(id), 'admin', request.user!.employee_id, request.user!.full_name, String(text));
    } catch (_) {}

    if (t.telegram_id) {
      await notifyUser(t.telegram_id, `💬 <b>Ответ поддержки</b>\n\n${text}`);
    }
    return t;
    }
  );

  /** Закрыть тикет (admin) */
  app.post('/support/tickets/:id/resolve', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const t = await supportRepo.resolveTicket(Number(id));
    if (!t) return reply.code(404).send({ error: 'not found' });
    return t;
  });
}
