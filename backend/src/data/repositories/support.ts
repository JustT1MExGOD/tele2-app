/**
 * Data Access Layer (20.8.0, Full DAL) — тикеты поддержки, FAQ, сообщения.
 *
 * 20.51.0 (Application-Level Envelope Encryption, Phase B) — `message`/
 * `admin_reply`/`body` теперь МОГУТ храниться зашифрованными (см.
 * backend/src/security/crypto/**, docs/DATA-SECURITY-ARCHITECTURE.md).
 * Это Level 2 (application-level at-rest encryption), НЕ E2EE — admin
 * обязан читать содержимое тикета, это и есть сама фича поддержки;
 * шифрование защищает только сырую копию в БД (dump/leak), не
 * операционный поток — текст всё ещё уходит в Telegram админу в
 * plaintext через `notifyAdmin` (см. api/routes/ops/support.ts), это
 * происходит из переменной, которая была в руках роута ДО вызова сюда.
 *
 * `DATA_ENCRYPTION_ENABLED` управляет только НОВЫМИ записями — чтение уже
 * зашифрованной строки расшифровывается всегда, независимо от текущего
 * состояния флага (иначе выключение флага сделало бы старые тикеты
 * нечитаемыми молча — недопустимый downgrade). Строка без `*_encrypted`
 * (создана до миграции 0021 или пока флаг был выключен) — честная
 * историческая plaintext-граница, а не «упавшее шифрование» — фолбэк на
 * plaintext ТОЛЬКО для этого случая, никогда как реакция на ошибку
 * шифрования/расшифровки самой по себе (см. docs/SECURITY.md §32/§48.7).
 *
 * `id` для `support_tickets`/`support_messages` резервируется явным
 * `nextval()` ДО INSERT — AAD (§6) должен связывать ciphertext с реальным
 * id строки, а он неизвестен заранее при обычном `DEFAULT nextval(...)`.
 */
import { query } from '../db/index.js';
import {
  isEncryptionEnabled,
  createEnvKeyProvider,
  encryptField,
  decryptField,
  logDecryptFailure,
  type AadContext
} from '../../security/crypto/index.js';

const REDACTED = '[зашифровано]';
const DECRYPT_ERROR = '[ошибка расшифровки]';

function encryptOrKeep(plaintext: string, context: AadContext): { plainColumn: string; encryptedColumn: string | null } {
  if (!isEncryptionEnabled()) return { plainColumn: plaintext, encryptedColumn: null };
  const keyProvider = createEnvKeyProvider();
  const envelope = encryptField(plaintext, context, keyProvider);
  return { plainColumn: REDACTED, encryptedColumn: JSON.stringify(envelope) };
}

function decryptOrKeep(
  plainColumn: string,
  encryptedColumn: unknown,
  context: AadContext,
  table: string,
  id: number | string
): string {
  if (encryptedColumn == null) return plainColumn; // pre-migration/pre-flag строка — не ошибка
  try {
    const keyProvider = createEnvKeyProvider();
    return decryptField(encryptedColumn as any, context, keyProvider);
  } catch (e) {
    logDecryptFailure({ table, id }, e);
    return DECRYPT_ERROR;
  }
}

async function reserveId(sequence: string): Promise<number> {
  const res = await query(`SELECT nextval($1::regclass) AS id`, [sequence]);
  return Number(res.rows[0].id);
}

function decryptTicketRow(row: any): any {
  if (!row) return row;
  const { message_encrypted, admin_reply_encrypted, ...rest } = row;
  const message = decryptOrKeep(
    row.message,
    message_encrypted,
    { type: 'support_ticket.message', id: row.id, schema_v: 1 },
    'support_tickets.message',
    row.id
  );
  const admin_reply =
    row.admin_reply == null && admin_reply_encrypted == null
      ? row.admin_reply
      : decryptOrKeep(
          row.admin_reply || '',
          admin_reply_encrypted,
          { type: 'support_ticket.admin_reply', id: row.id, schema_v: 1 },
          'support_tickets.admin_reply',
          row.id
        );
  return { ...rest, message, admin_reply };
}

function decryptMessageRow(row: any): any {
  if (!row) return row;
  const { body_encrypted, ...rest } = row;
  const body = decryptOrKeep(
    row.body,
    body_encrypted,
    { type: 'support_message.body', id: row.id, ticket_id: row.ticket_id },
    'support_messages.body',
    row.id
  );
  return { ...rest, body };
}

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
  return res.rows.map(decryptTicketRow);
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
  return res.rows.map(decryptTicketRow);
}

export async function findTicket(id: number): Promise<any | null> {
  const res = await query(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
  return decryptTicketRow(res.rows[0] || null);
}

export async function listMessages(ticketId: number): Promise<any[]> {
  const res = await query(
    `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId]
  ).catch(() => ({ rows: [] as any[] }));
  return res.rows.map(decryptMessageRow);
}

export async function addMessage(
  ticketId: number, senderRole: string, senderId: number | null, senderName: string | null, body: string
): Promise<any> {
  const id = await reserveId('public.support_messages_id_seq');
  const { plainColumn, encryptedColumn } = encryptOrKeep(body, {
    type: 'support_message.body',
    id,
    ticket_id: ticketId
  });
  const res = await query(
    `INSERT INTO support_messages (id, ticket_id, sender_role, sender_id, sender_name, body, body_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, ticketId, senderRole, senderId, senderName, plainColumn, encryptedColumn]
  );
  return decryptMessageRow(res.rows[0]);
}

/** POST /support/tickets/:id/messages — фолбэк, если INSERT в support_messages не удался (старая схема). */
export async function appendAdminReplyFallback(ticketId: number, text: string): Promise<void> {
  if (!isEncryptionEnabled()) {
    await query(
      `UPDATE support_tickets SET
         admin_reply = COALESCE(admin_reply,'') || E'\n---\n' || $1,
         status = 'open'
       WHERE id = $2`,
      [text, ticketId]
    );
    return;
  }
  // Зашифровано — конкатенация поверх ciphertext невозможна: читаем
  // текущее значение, расшифровываем, склеиваем в plaintext, шифруем
  // заново одним объектом. Редкий фолбэк-путь (реальный `addMessage()`
  // используется всегда, кроме падения INSERT) — лишний round-trip не в
  // hot path.
  const context: AadContext = { type: 'support_ticket.admin_reply', id: ticketId, schema_v: 1 };
  const cur = await query(`SELECT admin_reply, admin_reply_encrypted FROM support_tickets WHERE id = $1`, [ticketId]);
  const row = cur.rows[0];
  const existing = row ? decryptOrKeep(row.admin_reply || '', row.admin_reply_encrypted, context, 'support_tickets.admin_reply', ticketId) : '';
  const combined = `${existing}\n---\n${text}`;
  const { plainColumn, encryptedColumn } = encryptOrKeep(combined, context);
  await query(
    `UPDATE support_tickets SET
       admin_reply = $1,
       admin_reply_encrypted = $2,
       status = 'open'
     WHERE id = $3`,
    [plainColumn, encryptedColumn, ticketId]
  );
}

export async function markAnsweredByAdmin(ticketId: number): Promise<void> {
  await query(
    `UPDATE support_tickets SET
       status = 'answered',
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
    `UPDATE support_tickets SET status = 'open' WHERE id = $1`,
    [ticketId]
  );
}

export async function createTicket(data: {
  employeeId: number | null; telegramId: number | string | null; fullName: string; category: string;
  message: string; status: string; adminReply: string | null; answeredAt: Date | null;
  priority: string; slaMinutes: number;
}): Promise<any> {
  const id = await reserveId('public.support_tickets_id_seq');
  const msg = encryptOrKeep(data.message, { type: 'support_ticket.message', id, schema_v: 1 });
  const reply =
    data.adminReply != null
      ? encryptOrKeep(data.adminReply, { type: 'support_ticket.admin_reply', id, schema_v: 1 })
      : { plainColumn: null as any, encryptedColumn: null as string | null };
  const res = await query(
    `INSERT INTO support_tickets
       (id, employee_id, telegram_id, full_name, category, message, message_encrypted, status,
        admin_reply, admin_reply_encrypted, answered_at, priority, sla_minutes, sla_due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() + ($13::int * interval '1 minute'))
     RETURNING *`,
    [
      id, data.employeeId, data.telegramId, data.fullName, data.category,
      msg.plainColumn, msg.encryptedColumn, data.status,
      reply.plainColumn, reply.encryptedColumn, data.answeredAt, data.priority, data.slaMinutes
    ]
  );
  return decryptTicketRow(res.rows[0]);
}

export async function listOpenQueue(): Promise<any[]> {
  const res = await query(
    `SELECT * FROM support_tickets ORDER BY
       CASE status WHEN 'open' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 100`
  );
  return res.rows.map(decryptTicketRow);
}

export async function replyAsAdmin(id: number, text: string): Promise<any | null> {
  const { plainColumn, encryptedColumn } = encryptOrKeep(text, {
    type: 'support_ticket.admin_reply',
    id,
    schema_v: 1
  });
  const res = await query(
    `UPDATE support_tickets
     SET admin_reply = $1,
         admin_reply_encrypted = $2,
         status = 'answered',
         answered_at = now(),
         first_response_at = COALESCE(first_response_at, now()),
         sla_breached = CASE
           WHEN sla_due_at IS NOT NULL AND now() > sla_due_at THEN true
           ELSE COALESCE(sla_breached, false)
         END
     WHERE id = $3 RETURNING *`,
    [plainColumn, encryptedColumn, id]
  );
  return decryptTicketRow(res.rows[0] || null);
}

export async function resolveTicket(id: number): Promise<any | null> {
  const res = await query(
    `UPDATE support_tickets
     SET status = 'resolved',
         resolved_at = now(),
         first_response_at = COALESCE(first_response_at, now())
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return decryptTicketRow(res.rows[0] || null);
}
