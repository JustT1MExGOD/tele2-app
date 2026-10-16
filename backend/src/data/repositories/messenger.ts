/**
 * Data Access Layer — T2 Miranda, этап 2: диалоговый мессенджер. Структура
 * SQL сознательно почти дословно повторяет data/repositories/chat.ts (см.
 * migrations/0040_messenger.sql) — отличие в том, что participant/sender
 * это corporate_account_id, не employee_id напрямую (§4 плана).
 */
import { query } from '../db/index.js';

export interface ConversationRow {
  id: string;
  org_id: string;
  type: 'direct' | 'group';
  title: string | null;
  created_by_corporate_account_id: string;
  created_at: string;
}

export async function createConversation(
  orgId: string,
  type: 'direct' | 'group',
  title: string | null,
  createdByCorporateAccountId: number,
  memberCorporateAccountIds: number[],
  q: typeof query
): Promise<ConversationRow> {
  const res = await q(
    `INSERT INTO messenger_conversations (org_id, type, title, created_by_corporate_account_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, org_id, type, title, created_by_corporate_account_id, created_at`,
    [orgId, type, title, createdByCorporateAccountId]
  );
  const conversation = res.rows[0];
  for (const accountId of memberCorporateAccountIds) {
    await q(
      `INSERT INTO messenger_conversation_members (conversation_id, corporate_account_id) VALUES ($1, $2)
       ON CONFLICT (conversation_id, corporate_account_id) DO NOTHING`,
      [conversation.id, accountId]
    );
  }
  return conversation;
}

/** Найти уже существующий 1:1-диалог между ровно этими двумя аккаунтами —
 * избегаем задвоения direct-диалогов при повторном "написать этому
 * человеку" с разных устройств/заходов. */
export async function findDirectConversationBetween(
  orgId: string,
  accountIdA: number,
  accountIdB: number
): Promise<ConversationRow | null> {
  const res = await query(
    `SELECT c.id, c.org_id, c.type, c.title, c.created_by_corporate_account_id, c.created_at
     FROM messenger_conversations c
     WHERE c.org_id = $1 AND c.type = 'direct'
       AND (SELECT count(*) FROM messenger_conversation_members m WHERE m.conversation_id = c.id) = 2
       AND EXISTS (SELECT 1 FROM messenger_conversation_members m WHERE m.conversation_id = c.id AND m.corporate_account_id = $2)
       AND EXISTS (SELECT 1 FROM messenger_conversation_members m WHERE m.conversation_id = c.id AND m.corporate_account_id = $3)
     LIMIT 1`,
    [orgId, accountIdA, accountIdB]
  );
  return res.rows[0] || null;
}

export async function getConversation(id: string, orgId: string): Promise<ConversationRow | null> {
  const res = await query(
    `SELECT id, org_id, type, title, created_by_corporate_account_id, created_at
     FROM messenger_conversations WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  return res.rows[0] || null;
}

/** Членство — ЕДИНСТВЕННАЯ проверка авторизации на доступ к диалогу (§4/§6
 * плана): не-участник не видит/не пишет, вне зависимости от org/роли. */
export async function isMember(conversationId: string, corporateAccountId: number): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM messenger_conversation_members WHERE conversation_id = $1 AND corporate_account_id = $2`,
    [conversationId, corporateAccountId]
  );
  return res.rows.length > 0;
}

export interface ConversationListItem {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  last_read_message_id: string | null;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_created_at: string | null;
  unread_count: string;
}

/** Список диалогов этого корпоративного аккаунта (не employee_id) — для
 * экрана "список контактов/диалогов" Miranda. */
export async function listConversationsForAccount(corporateAccountId: number): Promise<ConversationListItem[]> {
  const res = await query(
    `SELECT c.id, c.type, c.title, cm.last_read_message_id,
            lm.id AS last_message_id, lm.body AS last_message_body, lm.created_at AS last_message_created_at,
            (SELECT count(*) FROM messenger_messages m
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                AND (cm.last_read_message_id IS NULL OR m.id > cm.last_read_message_id)) AS unread_count
     FROM messenger_conversation_members cm
     JOIN messenger_conversations c ON c.id = cm.conversation_id
     LEFT JOIN LATERAL (
       SELECT id, body, created_at FROM messenger_messages
       WHERE conversation_id = c.id AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 1
     ) lm ON true
     WHERE cm.corporate_account_id = $1
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [corporateAccountId]
  );
  return res.rows;
}

export interface ConversationMemberRow {
  corporate_account_id: string;
  employee_id: string | null;
  employee_full_name: string;
  display_label: string | null;
}

export async function listMembers(conversationId: string): Promise<ConversationMemberRow[]> {
  const res = await query(
    `SELECT ca.id AS corporate_account_id, ca.employee_id,
            COALESCE(e.full_name, ca.account_name) AS employee_full_name, ca.display_label
     FROM messenger_conversation_members cm
     JOIN corporate_accounts ca ON ca.id = cm.corporate_account_id
     LEFT JOIN employees e ON e.id = ca.employee_id
     WHERE cm.conversation_id = $1
     ORDER BY cm.id ASC`,
    [conversationId]
  );
  return res.rows;
}

export async function addMember(conversationId: string, corporateAccountId: number, q: typeof query = query): Promise<void> {
  await q(
    `INSERT INTO messenger_conversation_members (conversation_id, corporate_account_id) VALUES ($1, $2)
     ON CONFLICT (conversation_id, corporate_account_id) DO NOTHING`,
    [conversationId, corporateAccountId]
  );
}

export async function updateLastRead(conversationId: string, corporateAccountId: number, messageId: string): Promise<void> {
  await query(
    `UPDATE messenger_conversation_members SET last_read_message_id = $3
     WHERE conversation_id = $1 AND corporate_account_id = $2
       AND (last_read_message_id IS NULL OR last_read_message_id < $3)`,
    [conversationId, corporateAccountId, messageId]
  );
}

export interface MessengerMessageRow {
  id: string;
  conversation_id: string;
  org_id: string;
  sender_corporate_account_id: string;
  sender_employee_id: string | null;
  client_message_id: string;
  body: string | null;
  content_type: string;
  created_at: string;
}

/** Идемпотентность — тем же приёмом, что chatRepo.insertMessageIfAbsent:
 * UNIQUE(sender_corporate_account_id, client_message_id) сам разруливает
 * конкурентный дубль на уровне БД. senderEmployeeId — NULL для точечного
 * (Этап B) отправителя без employee_id. */
export async function insertMessageIfAbsent(
  conversationId: string,
  orgId: string,
  senderCorporateAccountId: number,
  senderEmployeeId: number | null,
  clientMessageId: string,
  body: string | null,
  q: typeof query
): Promise<MessengerMessageRow | null> {
  const res = await q(
    `INSERT INTO messenger_messages (conversation_id, org_id, sender_corporate_account_id, sender_employee_id, client_message_id, body)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sender_corporate_account_id, client_message_id) DO NOTHING
     RETURNING id, conversation_id, org_id, sender_corporate_account_id, sender_employee_id, client_message_id, body, content_type, created_at`,
    [conversationId, orgId, senderCorporateAccountId, senderEmployeeId, clientMessageId, body]
  );
  return res.rows[0] || null;
}

export async function findByClientMessageId(
  senderCorporateAccountId: number,
  clientMessageId: string,
  q: typeof query
): Promise<MessengerMessageRow | null> {
  const res = await q(
    `SELECT id, conversation_id, org_id, sender_corporate_account_id, sender_employee_id, client_message_id, body, content_type, created_at
     FROM messenger_messages WHERE sender_corporate_account_id = $1 AND client_message_id = $2`,
    [senderCorporateAccountId, clientMessageId]
  );
  return res.rows[0] || null;
}

export interface MessengerMessageWithSender extends MessengerMessageRow {
  sender_full_name: string | null;
  sender_display_label: string | null;
}

export async function getMessageWithSender(messageId: string, conversationId: string): Promise<MessengerMessageWithSender | null> {
  const res = await query(
    `SELECT m.id, m.conversation_id, m.org_id, m.sender_corporate_account_id, m.sender_employee_id,
            m.client_message_id, m.body, m.content_type, m.created_at,
            COALESCE(e.full_name, ca.account_name) AS sender_full_name, ca.display_label AS sender_display_label
     FROM messenger_messages m
     JOIN corporate_accounts ca ON ca.id = m.sender_corporate_account_id
     LEFT JOIN employees e ON e.id = ca.employee_id
     WHERE m.id = $1 AND m.conversation_id = $2 AND m.deleted_at IS NULL`,
    [messageId, conversationId]
  );
  return res.rows[0] || null;
}

export async function listMessages(conversationId: string, limit: number, beforeId?: string): Promise<MessengerMessageWithSender[]> {
  const params: any[] = [conversationId];
  let cursorFilter = '';
  if (beforeId) {
    params.push(beforeId);
    cursorFilter = `AND m.id < $${params.length}`;
  }
  params.push(limit);
  const res = await query(
    `SELECT m.id, m.conversation_id, m.org_id, m.sender_corporate_account_id, m.sender_employee_id,
            m.client_message_id, m.body, m.content_type, m.created_at,
            COALESCE(e.full_name, ca.account_name) AS sender_full_name, ca.display_label AS sender_display_label
     FROM messenger_messages m
     JOIN corporate_accounts ca ON ca.id = m.sender_corporate_account_id
     LEFT JOIN employees e ON e.id = ca.employee_id
     WHERE m.conversation_id = $1 AND m.deleted_at IS NULL ${cursorFilter}
     ORDER BY m.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

export async function listMessagesAfter(conversationId: string, afterId: string, limit: number): Promise<MessengerMessageWithSender[]> {
  const res = await query(
    `SELECT m.id, m.conversation_id, m.org_id, m.sender_corporate_account_id, m.sender_employee_id,
            m.client_message_id, m.body, m.content_type, m.created_at,
            COALESCE(e.full_name, ca.account_name) AS sender_full_name, ca.display_label AS sender_display_label
     FROM messenger_messages m
     JOIN corporate_accounts ca ON ca.id = m.sender_corporate_account_id
     LEFT JOIN employees e ON e.id = ca.employee_id
     WHERE m.conversation_id = $1 AND m.deleted_at IS NULL AND m.id > $2
     ORDER BY m.id ASC
     LIMIT $3`,
    [conversationId, afterId, limit]
  );
  return res.rows;
}

export interface MessengerAttachmentRow {
  id: string;
  org_id: string;
  message_id: string | null;
  uploader_corporate_account_id: string;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  created_at: string;
  expires_at: string | null;
}

export async function listAttachmentsForMessages(messageIds: string[], orgId: string): Promise<MessengerAttachmentRow[]> {
  if (!messageIds.length) return [];
  const res = await query(
    `SELECT id, org_id, message_id, uploader_corporate_account_id, storage_key, original_filename, mime_type, size_bytes, created_at, expires_at
     FROM messenger_attachments WHERE org_id = $1 AND message_id = ANY($2) ORDER BY id`,
    [orgId, messageIds]
  );
  return res.rows;
}

export async function createPreparedAttachment(
  orgId: string,
  uploaderCorporateAccountId: number,
  storageKey: string,
  originalFilename: string,
  mimeType: string,
  sizeBytes: number,
  expiresAt: string
): Promise<MessengerAttachmentRow> {
  const res = await query(
    `INSERT INTO messenger_attachments (org_id, uploader_corporate_account_id, storage_key, original_filename, mime_type, size_bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, org_id, message_id, uploader_corporate_account_id, storage_key, original_filename, mime_type, size_bytes, created_at, expires_at`,
    [orgId, uploaderCorporateAccountId, storageKey, originalFilename, mimeType, sizeBytes, expiresAt]
  );
  return res.rows[0];
}

/** FOR UPDATE внутри транзакции создания сообщения — тот же приём, что
 * chatRepo.lockOwnedUnattachedAttachments (race на attachment ownership). */
export async function lockOwnedUnattachedAttachments(
  ids: string[],
  orgId: string,
  uploaderCorporateAccountId: number,
  q: typeof query
): Promise<MessengerAttachmentRow[]> {
  if (!ids.length) return [];
  const res = await q(
    `SELECT id, org_id, message_id, uploader_corporate_account_id, storage_key, original_filename, mime_type, size_bytes, created_at, expires_at
     FROM messenger_attachments
     WHERE id = ANY($1) AND org_id = $2 AND uploader_corporate_account_id = $3
       AND message_id IS NULL AND expires_at > now()
     FOR UPDATE`,
    [ids, orgId, uploaderCorporateAccountId]
  );
  return res.rows;
}

export async function attachToMessage(attachmentIds: string[], messageId: string, q: typeof query): Promise<void> {
  if (!attachmentIds.length) return;
  await q(`UPDATE messenger_attachments SET message_id = $1, expires_at = NULL WHERE id = ANY($2)`, [messageId, attachmentIds]);
}

export interface AttachmentDownloadRow extends MessengerAttachmentRow {
  message_deleted_at: string | null;
  conversation_id: string | null;
}

export async function getAttachmentForDownload(attachmentId: string, orgId: string): Promise<AttachmentDownloadRow | null> {
  const res = await query(
    `SELECT a.id, a.org_id, a.message_id, a.uploader_corporate_account_id, a.storage_key, a.original_filename,
            a.mime_type, a.size_bytes, a.created_at, a.expires_at, m.deleted_at AS message_deleted_at, m.conversation_id
     FROM messenger_attachments a
     LEFT JOIN messenger_messages m ON m.id = a.message_id
     WHERE a.id = $1 AND a.org_id = $2`,
    [attachmentId, orgId]
  );
  return res.rows[0] || null;
}

export async function listExpiredOrphanAttachments(limit = 200): Promise<{ id: string; storage_key: string }[]> {
  const res = await query(
    `SELECT id, storage_key FROM messenger_attachments
     WHERE message_id IS NULL AND expires_at IS NOT NULL AND expires_at < now()
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function deleteAttachmentRow(id: string): Promise<void> {
  await query(`DELETE FROM messenger_attachments WHERE id = $1`, [id]);
}

export async function putBlob(storageKey: string, data: Buffer): Promise<void> {
  await query(`INSERT INTO messenger_attachment_blobs (storage_key, data) VALUES ($1, $2)`, [storageKey, data]);
}

export async function getBlob(storageKey: string): Promise<Buffer | null> {
  const res = await query(`SELECT data FROM messenger_attachment_blobs WHERE storage_key = $1`, [storageKey]);
  return res.rows[0]?.data ?? null;
}

export async function deleteBlob(storageKey: string): Promise<void> {
  await query(`DELETE FROM messenger_attachment_blobs WHERE storage_key = $1`, [storageKey]);
}

/** Лочим диалог (не всю организацию, как у org-wide чата) — сериализует
 * конкурентные отправки в ОДИН диалог, не блокирует отправки в другие. */
export async function lockConversation(conversationId: string, q: typeof query): Promise<void> {
  await q('SELECT id FROM messenger_conversations WHERE id = $1 FOR UPDATE', [conversationId]);
}

export async function publishMessengerChanged(orgId: string, conversationId: string, messageId: string): Promise<void> {
  await query("SELECT pg_notify('t2_messenger_changed', $1)", [JSON.stringify({ orgId, conversationId, messageId })]);
}
