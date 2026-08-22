/**
 * Data Access Layer (20.8.0, Full DAL) — тикеты поддержки, FAQ, сообщения.
 */
import { query } from '../db/index.js';

export async function listAdminTicketsWithSla(): Promise<any[]> {
  const res = await query(
    `SELECT t.*,
       CASE
         WHEN t.resolved_at IS NOT NULL THEN 'resolved'
         WHEN t.sla_due_at IS NOT NULL AND now() > t.sla_due_at THEN 'breached'
         WHEN t.first_response_at IS NOT NULL THEN 'responded'
         ELSE 'waiting'
       END AS sla_status,
       EXTRACT(EPOCH FROM (COALESCE(t.sla_due_at, now()) - now())) / 60 AS minutes_left
     FROM support_tickets t
     ORDER BY
       CASE WHEN t.resolved_at IS NULL AND t.sla_due_at < now() THEN 0 ELSE 1 END,
       t.created_at DESC
     LIMIT 100`
  );
  return res.rows;
}

export async function listActiveFaq(): Promise<any[]> {
  const res = await query(
    `SELECT id, question, answer, sort_order FROM support_faq
     WHERE COALESCE(is_active, true) = true ORDER BY sort_order NULLS LAST, id`
  );
  return res.rows;
}

export async function listActiveFaqFull(): Promise<any[]> {
  const res = await query(`SELECT * FROM support_faq WHERE COALESCE(is_active,true)=true`);
  return res.rows;
}

export async function listMyTickets(telegramId: number, employeeId: number): Promise<any[]> {
  const res = await query(
    `SELECT * FROM support_tickets
     WHERE telegram_id = $1 OR employee_id = $2
     ORDER BY created_at DESC LIMIT 50`,
    [telegramId, employeeId]
  );
  return res.rows;
}

export async function findTicket(id: number): Promise<any | null> {
  const res = await query(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function listMessages(ticketId: number): Promise<any[]> {
  const res = await query(
    `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows;
}

export async function addMessage(
  ticketId: number, senderRole: string, senderId: number | null, senderName: string | null, body: string
): Promise<any> {
  const res = await query(
    `INSERT INTO support_messages (ticket_id, sender_role, sender_id, sender_name, body)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ticketId, senderRole, senderId, senderName, body]
  );
  return res.rows[0];
}

/** POST /support/tickets/:id/messages — фолбэк, если INSERT в support_messages не удался (старая схема). */
export async function appendAdminReplyFallback(ticketId: number, text: string): Promise<void> {
  await query(
    `UPDATE support_tickets SET
       admin_reply = COALESCE(admin_reply,'') || E'\n---\n' || $1,
       status = 'open',
       updated_at = now()
     WHERE id = $2`,
    [text, ticketId]
  );
}

export async function markAnsweredByAdmin(ticketId: number): Promise<void> {
  await query(
    `UPDATE support_tickets SET
       status = 'answered',
       updated_at = now(),
       first_response_at = COALESCE(first_response_at, now()),
       answered_at = COALESCE(answered_at, now()),
       sla_breached = CASE
         WHEN sla_due_at IS NOT NULL AND now() > sla_due_at THEN true
         ELSE COALESCE(sla_breached, false)
       END
     WHERE id = $1`,
    [ticketId]
  );
}

export async function markReopenedByUser(ticketId: number): Promise<void> {
  await query(
    `UPDATE support_tickets SET status = 'open', updated_at = now() WHERE id = $1`,
    [ticketId]
  );
}

export async function createTicket(data: {
  employeeId: number | null; telegramId: number | string | null; fullName: string; category: string;
  message: string; status: string; adminReply: string | null; answeredAt: Date | null;
  priority: string; slaMinutes: number;
}): Promise<any> {
  const res = await query(
    `INSERT INTO support_tickets
       (employee_id, telegram_id, full_name, category, message, status, admin_reply, answered_at,
        priority, sla_minutes, sla_due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + ($10::int * interval '1 minute'))
     RETURNING *`,
    [
      data.employeeId, data.telegramId, data.fullName, data.category, data.message,
      data.status, data.adminReply, data.answeredAt, data.priority, data.slaMinutes
    ]
  );
  return res.rows[0];
}

export async function listOpenQueue(): Promise<any[]> {
  const res = await query(
    `SELECT * FROM support_tickets ORDER BY
       CASE status WHEN 'open' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 100`
  );
  return res.rows;
}

export async function replyAsAdmin(id: number, text: string): Promise<any | null> {
  const res = await query(
    `UPDATE support_tickets
     SET admin_reply = $1,
         status = 'answered',
         answered_at = now(),
         first_response_at = COALESCE(first_response_at, now()),
         sla_breached = CASE
           WHEN sla_due_at IS NOT NULL AND now() > sla_due_at THEN true
           ELSE COALESCE(sla_breached, false)
         END
     WHERE id = $2 RETURNING *`,
    [text, id]
  );
  return res.rows[0] || null;
}

export async function resolveTicket(id: number): Promise<any | null> {
  const res = await query(
    `UPDATE support_tickets
     SET status = 'resolved',
         resolved_at = now(),
         updated_at = now(),
         first_response_at = COALESCE(first_response_at, now())
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return res.rows[0] || null;
}
