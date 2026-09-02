/**
 * Data Access Layer — внутренний чат сотрудников (20.57.0). Тот же DAL-
 * принцип, что и весь остальной backend (см. заголовок employees.ts): весь
 * SQL живёт здесь, routes/core только вызывают эти функции.
 */
import { query } from '../db/index.js';

export interface ChatMessageRow {
  id: string;
  org_id: string;
  sender_employee_id: number;
  client_message_id: string;
  body: string | null;
  content_type: string;
  created_at: string;
}

export interface ChatAttachmentRow {
  id: string;
  org_id: string;
  message_id: string | null;
  uploader_employee_id: number;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  created_at: string;
  expires_at: string | null;
}

/**
 * Идемпотентное создание — ON CONFLICT на UNIQUE(sender_employee_id,
 * client_message_id) сам разруливает конкурентный дубль на уровне БД: при
 * гонке двух одновременных POST с одним clientMessageId ровно один INSERT
 * реально вставляет строку, второй получает 0 rows здесь и должен сам
 * дальше вызвать findByClientMessageId() (см. core/chat/service.ts) —
 * никакой ручной блокировки/advisory lock не нужно, constraint это и есть
 * блокировка.
 */
export async function insertMessageIfAbsent(
  orgId: string,
  senderEmployeeId: number,
  clientMessageId: string,
  body: string | null,
  q: typeof query = query
): Promise<ChatMessageRow | null> {
  const res = await q(
    `INSERT INTO chat_messages (org_id, sender_employee_id, client_message_id, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (sender_employee_id, client_message_id) DO NOTHING
     RETURNING id, org_id, sender_employee_id, client_message_id, body, content_type, created_at`,
    [orgId, senderEmployeeId, clientMessageId, body]
  );
  return res.rows[0] || null;
}

export async function findByClientMessageId(
  senderEmployeeId: number,
  clientMessageId: string,
  q: typeof query = query
): Promise<ChatMessageRow | null> {
  const res = await q(
    `SELECT id, org_id, sender_employee_id, client_message_id, body, content_type, created_at
     FROM chat_messages
     WHERE sender_employee_id = $1 AND client_message_id = $2`,
    [senderEmployeeId, clientMessageId]
  );
  return res.rows[0] || null;
}

export interface ChatMessageWithAuthor extends ChatMessageRow {
  sender_full_name: string | null;
  sender_short_name: string | null;
  sender_role: string;
}

export async function getMessageWithAuthor(messageId: string, orgId: string): Promise<ChatMessageWithAuthor | null> {
  const res = await query(
    `SELECT m.id, m.org_id, m.sender_employee_id, m.client_message_id, m.body, m.content_type, m.created_at,
            e.full_name as sender_full_name, e.short_name as sender_short_name, e.role as sender_role
     FROM chat_messages m
     JOIN employees e ON e.id = m.sender_employee_id
     WHERE m.id = $1 AND m.org_id = $2 AND m.deleted_at IS NULL`,
    [messageId, orgId]
  );
  return res.rows[0] || null;
}

/**
 * Keyset-пагинация по id (bigserial, монотонен вместе с created_at — см.
 * комментарий в миграции). `beforeId` — курсор "загрузить более старые,
 * чем этот id" (прокрутка вверх), результат DESC. Без параметров —
 * последние `limit` сообщений, тоже DESC.
 */
export async function listMessages(
  orgId: string,
  limit: number,
  beforeId?: string
): Promise<ChatMessageWithAuthor[]> {
  const params: any[] = [orgId];
  let cursorFilter = '';
  if (beforeId) {
    params.push(beforeId);
    cursorFilter = `AND m.id < $${params.length}`;
  }
  params.push(limit);
  const res = await query(
    `SELECT m.id, m.org_id, m.sender_employee_id, m.client_message_id, m.body, m.content_type, m.created_at,
            e.full_name as sender_full_name, e.short_name as sender_short_name, e.role as sender_role
     FROM chat_messages m
     JOIN employees e ON e.id = m.sender_employee_id
     WHERE m.org_id = $1 AND m.deleted_at IS NULL ${cursorFilter}
     ORDER BY m.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

/**
 * "Что появилось НОВОГО с последнего известного id" — polling fallback
 * (§9 брифа) и WS reconnect catch-up (§8: "после reconnect frontend делает
 * catch-up GET по последнему canonical cursor/id"). ASC (в отличие от
 * listMessages выше) — естественный порядок для "довставить в конец ленты",
 * не нужно разворачивать на фронте. Bounded тем же limit — если пропущено
 * больше, фронт увидит nextCursor/остаток на следующем тике, не пытаемся
 * вернуть неограниченный хвост одним ответом.
 */
export async function listMessagesAfter(orgId: string, afterId: string, limit: number): Promise<ChatMessageWithAuthor[]> {
  const res = await query(
    `SELECT m.id, m.org_id, m.sender_employee_id, m.client_message_id, m.body, m.content_type, m.created_at,
            e.full_name as sender_full_name, e.short_name as sender_short_name, e.role as sender_role
     FROM chat_messages m
     JOIN employees e ON e.id = m.sender_employee_id
     WHERE m.org_id = $1 AND m.deleted_at IS NULL AND m.id > $2
     ORDER BY m.id ASC
     LIMIT $3`,
    [orgId, afterId, limit]
  );
  return res.rows;
}

export async function listAttachmentsForMessages(messageIds: string[], orgId: string): Promise<ChatAttachmentRow[]> {
  if (!messageIds.length) return [];
  const res = await query(
    `SELECT id, org_id, message_id, uploader_employee_id, storage_key, original_filename, mime_type, size_bytes, created_at, expires_at
     FROM chat_attachments
     WHERE org_id = $1 AND message_id = ANY($2)
     ORDER BY id`,
    [orgId, messageIds]
  );
  return res.rows;
}

export async function createPreparedAttachment(
  orgId: string,
  uploaderEmployeeId: number,
  storageKey: string,
  originalFilename: string,
  mimeType: string,
  sizeBytes: number,
  expiresAt: string
): Promise<ChatAttachmentRow> {
  const res = await query(
    `INSERT INTO chat_attachments (org_id, uploader_employee_id, storage_key, original_filename, mime_type, size_bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, org_id, message_id, uploader_employee_id, storage_key, original_filename, mime_type, size_bytes, created_at, expires_at`,
    [orgId, uploaderEmployeeId, storageKey, originalFilename, mimeType, sizeBytes, expiresAt]
  );
  return res.rows[0];
}

/**
 * Забирает prepared-вложения под FOR UPDATE ВНУТРИ той же транзакции, что
 * и создание сообщения (core/chat/service.ts) — без этого два конкурентных
 * POST могли бы оба "успешно" прочитать одно и то же ещё не связанное
 * вложение и оба посчитать его своим (IDOR/race на attachment ownership).
 * Фильтр message_id IS NULL — уже связанное вложение не поднять повторно.
 */
export async function lockOwnedUnattachedAttachments(
  ids: string[],
  orgId: string,
  uploaderEmployeeId: number,
  q: typeof query
): Promise<ChatAttachmentRow[]> {
  if (!ids.length) return [];
  const res = await q(
    `SELECT id, org_id, message_id, uploader_employee_id, storage_key, original_filename, mime_type, size_bytes, created_at, expires_at
     FROM chat_attachments
     WHERE id = ANY($1) AND org_id = $2 AND uploader_employee_id = $3
       AND message_id IS NULL AND expires_at > now()
     FOR UPDATE`,
    [ids, orgId, uploaderEmployeeId]
  );
  return res.rows;
}

export async function attachToMessage(attachmentIds: string[], messageId: string, q: typeof query): Promise<void> {
  if (!attachmentIds.length) return;
  await q(`UPDATE chat_attachments SET message_id = $1, expires_at = NULL WHERE id = ANY($2)`, [messageId, attachmentIds]);
}

export interface AttachmentDownloadRow extends ChatAttachmentRow {
  message_deleted_at: string | null;
}

/** Скачивание — org-scope это ЕДИНСТВЕННАЯ проверка авторизации (не
 * uploader-only): любой активный сотрудник сети видит все вложения общего
 * чата сети, как и сами сообщения (см. core/chat/service.ts). */
export async function getAttachmentForDownload(attachmentId: string, orgId: string): Promise<AttachmentDownloadRow | null> {
  const res = await query(
    `SELECT a.id, a.org_id, a.message_id, a.uploader_employee_id, a.storage_key, a.original_filename,
            a.mime_type, a.size_bytes, a.created_at, a.expires_at, m.deleted_at as message_deleted_at
     FROM chat_attachments a
     LEFT JOIN chat_messages m ON m.id = a.message_id
     WHERE a.id = $1 AND a.org_id = $2`,
    [attachmentId, orgId]
  );
  return res.rows[0] || null;
}

/** Просроченные prepared-вложения, ни к чему не привязанные — orphan
 * cleanup (cron/chat-attachment-cleanup.ts). Возвращает storage_key, чтобы
 * вызывающий код сначала удалил блоб через StorageAdapter, потом строку. */
export async function listExpiredOrphanAttachments(limit = 200): Promise<{ id: string; storage_key: string }[]> {
  const res = await query(
    `SELECT id, storage_key FROM chat_attachments
     WHERE message_id IS NULL AND expires_at IS NOT NULL AND expires_at < now()
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function deleteAttachmentRow(id: string): Promise<void> {
  await query(`DELETE FROM chat_attachments WHERE id = $1`, [id]);
}

/** Байты вложения (core/chat/storage.ts::PostgresBlobStorageAdapter) — тот
 * же DAL-принцип, что весь остальной файл: SQL живёт только здесь, адаптер
 * выше вызывает эти три функции, а не query() напрямую. */
export async function putBlob(storageKey: string, data: Buffer): Promise<void> {
  await query(`INSERT INTO chat_attachment_blobs (storage_key, data) VALUES ($1, $2)`, [storageKey, data]);
}

export async function getBlob(storageKey: string): Promise<Buffer | null> {
  const res = await query(`SELECT data FROM chat_attachment_blobs WHERE storage_key = $1`, [storageKey]);
  return res.rows[0]?.data ?? null;
}

export async function deleteBlob(storageKey: string): Promise<void> {
  await query(`DELETE FROM chat_attachment_blobs WHERE storage_key = $1`, [storageKey]);
}
