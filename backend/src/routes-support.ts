/**
 * Поддержка: FAQ + тикеты + чат сообщений
 * Список тикетов и ответы — только role = admin
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireActive, requireAuth } from './middleware-auth.js';
import { notifyAdmin, notifyUser } from './bot/index.js';
import { supportTicketAdmin } from './bot/messages.js';

function requireAdmin(request: any, reply: any) {
  if (!requireActive(request, reply)) return false;
  if (request.user?.role !== 'admin') {
    reply.code(403).send({ error: 'admin only', message: 'Тикеты доступны только администратору' });
    return false;
  }
  return true;
}

export async function registerSupportRoutes(app: FastifyInstance) {
  app.get('/support/faq', async () => {
    try {
      const res = await query(
        `SELECT id, question, answer, sort_order FROM support_faq
         WHERE COALESCE(is_active, true) = true ORDER BY sort_order NULLS LAST, id`
      );
      return res.rows;
    } catch {
      return [];
    }
  });

  /** Мои тикеты + сообщения */
  app.get('/support/my', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tg = Number(request.user!.telegram_id);
    const res = await query(
      `SELECT * FROM support_tickets
       WHERE telegram_id = $1 OR employee_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [tg, request.user!.employee_id]
    );
    return res.rows;
  });

  app.get('/support/tickets/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const ticket = await query(`SELECT * FROM support_tickets WHERE id = $1`, [Number(id)]);
    if (!ticket.rows[0]) return reply.code(404).send({ error: 'not found' });
    const t = ticket.rows[0];
    const isAdmin = request.user?.role === 'admin';
    const isOwner =
      Number(t.telegram_id) === Number(request.user?.telegram_id) ||
      Number(t.employee_id) === Number(request.user?.employee_id);
    if (!isAdmin && !isOwner) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const msgs = await query(
      `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [Number(id)]
    ).catch(() => ({ rows: [] }));
    return { ticket: t, messages: msgs.rows };
  });

  /** Новое сообщение в тикет (сотрудник или admin) */
  app.post('/support/tickets/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const text = String(body.message || body.text || '').trim();
    if (!text) return reply.code(400).send({ error: 'message required' });

    const ticket = await query(`SELECT * FROM support_tickets WHERE id = $1`, [Number(id)]);
    if (!ticket.rows[0]) return reply.code(404).send({ error: 'not found' });
    const t = ticket.rows[0];
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
      msg = await query(
        `INSERT INTO support_messages (ticket_id, sender_role, sender_id, sender_name, body)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [
          Number(id),
          sender,
          request.user!.employee_id,
          request.user!.full_name,
          text
        ]
      );
    } catch {
      // fallback: append to admin_reply
      await query(
        `UPDATE support_tickets SET
           admin_reply = COALESCE(admin_reply,'') || E'\n---\n' || $1,
           status = 'open',
           updated_at = now()
         WHERE id = $2`,
        [text, Number(id)]
      );
      return { ok: true, fallback: true };
    }

    await query(
      `UPDATE support_tickets SET status = $1, updated_at = now() WHERE id = $2`,
      [isAdmin ? 'answered' : 'open', Number(id)]
    );

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

    return msg.rows[0];
  });

  /** Создать тикет */
  app.post('/support', async (request, reply) => {
    const b = (request.body || {}) as any;
    const message = String(b.message || '').trim();
    if (!message) return reply.code(400).send({ error: 'message required' });

    const telegram_id = b.telegram_id || request.user?.telegram_id || null;
    const employee_id = request.user?.employee_id || b.employee_id || null;
    const full_name = request.user?.full_name || b.full_name || 'Гость';
    const category = b.category || 'other';

    let autoAnswer: string | null = null;
    try {
      const faq = await query(`SELECT * FROM support_faq WHERE COALESCE(is_active,true)=true`);
      const lower = message.toLowerCase();
      for (const row of faq.rows) {
        const keys: string[] = row.keywords || [];
        if (Array.isArray(keys) && keys.some((k) => lower.includes(String(k).toLowerCase()))) {
          autoAnswer = row.answer;
          break;
        }
      }
    } catch (_) {}

    const ins = await query(
      `INSERT INTO support_tickets
         (employee_id, telegram_id, full_name, category, message, status, admin_reply, answered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        employee_id,
        telegram_id,
        full_name,
        category,
        message,
        autoAnswer ? 'answered' : 'open',
        autoAnswer,
        autoAnswer ? new Date() : null
      ]
    );
    const ticket = ins.rows[0];

    try {
      await query(
        `INSERT INTO support_messages (ticket_id, sender_role, sender_id, sender_name, body)
         VALUES ($1,'user',$2,$3,$4)`,
        [ticket.id, employee_id, full_name, message]
      );
      if (autoAnswer) {
        await query(
          `INSERT INTO support_messages (ticket_id, sender_role, sender_name, body)
           VALUES ($1,'bot','T2 Support',$2)`,
          [ticket.id, autoAnswer]
        );
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
  });

  /** Очередь — только admin */
  app.get('/support/tickets', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const res = await query(
      `SELECT * FROM support_tickets ORDER BY
         CASE status WHEN 'open' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 100`
    );
    return res.rows;
  });

  app.post('/support/tickets/:id/reply', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const { reply: text } = (request.body || {}) as any;
    if (!text) return reply.code(400).send({ error: 'reply required' });

    const res = await query(
      `UPDATE support_tickets
       SET admin_reply = $1, status = 'answered', answered_at = now()
       WHERE id = $2 RETURNING *`,
      [String(text), Number(id)]
    );
    const t = res.rows[0];
    if (!t) return reply.code(404).send({ error: 'not found' });

    try {
      await query(
        `INSERT INTO support_messages (ticket_id, sender_role, sender_id, sender_name, body)
         VALUES ($1,'admin',$2,$3,$4)`,
        [Number(id), request.user!.employee_id, request.user!.full_name, String(text)]
      );
    } catch (_) {}

    if (t.telegram_id) {
      await notifyUser(t.telegram_id, `💬 <b>Ответ поддержки</b>\n\n${text}`);
    }
    return t;
  });
}
