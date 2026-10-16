/**
 * Оркестрация мессенджера (§4/§5/§6 плана) — единственное место, где
 * REST/WS роуты трогают бизнес-логику. org_id/employee_id ВСЕГДА приходят
 * из request.user (как и core/chat/service.ts); активный corporate_account_id
 * вызывающего ВСЕГДА резолвится на каждый запрос через
 * mirandaRepo.getActiveCorporateAccountForSession(hashToken(sessionToken))
 * в самих routes/messenger/*.ts — никогда не принимается от клиента как
 * значение, которому можно доверять напрямую (инвариант §6 плана,
 * проверяется isolation-тестами, не этим файлом).
 */
import { withTransaction } from '../../data/db/index.js';
import * as messengerRepo from '../../data/repositories/messenger.js';
import * as mirandaRepo from '../../data/repositories/miranda-accounts.js';
import * as auditRepo from '../../data/repositories/audit.js';
import { hashToken } from '../../data/repositories/sessions.js';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../chat/attachment-validation.js';

/** §3.3 плана, применённое к мессенджеру — "какой corporate_account_id
 * активен на ЭТОЙ сессии прямо сейчас" перечитывается с сервера на каждый
 * чувствительный запрос, никогда не принимается от клиента напрямую. */
export async function resolveActiveCorporateAccount(sessionToken: string): Promise<number | null> {
  return mirandaRepo.getActiveCorporateAccountForSession(hashToken(sessionToken));
}

export interface CanonicalSender {
  corporateAccountId: number;
  employeeId: number | null;
  displayName: string;
}

export interface CanonicalAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CanonicalMessage {
  id: string;
  conversationId: string;
  clientMessageId: string;
  body: string | null;
  createdAt: string;
  sender: CanonicalSender;
  attachments: CanonicalAttachment[];
}

function toCanonicalSender(row: messengerRepo.MessengerMessageWithSender): CanonicalSender {
  return {
    corporateAccountId: Number(row.sender_corporate_account_id),
    employeeId: row.sender_employee_id === null ? null : Number(row.sender_employee_id),
    displayName: row.sender_display_label || row.sender_full_name || `#${row.sender_corporate_account_id}`
  };
}

function toCanonicalAttachment(row: messengerRepo.MessengerAttachmentRow): CanonicalAttachment {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes)
  };
}

async function attachmentsForMessages(messageIds: string[], orgId: string): Promise<Map<string, CanonicalAttachment[]>> {
  const rows = await messengerRepo.listAttachmentsForMessages(messageIds, orgId);
  const map = new Map<string, CanonicalAttachment[]>();
  for (const row of rows) {
    if (!row.message_id) continue;
    const list = map.get(row.message_id) || [];
    list.push(toCanonicalAttachment(row));
    map.set(row.message_id, list);
  }
  return map;
}

export type FindOrCreateDirectResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: 'self_conversation' | 'not_active' };

/** Начать (или получить уже существующий) 1:1-диалог с другим корпоративным
 * аккаунтом. targetCorporateAccountId должен принадлежать активному и
 * существующему аккаунту — чужой org недостижим, т.к. corporate_account_id
 * не передаётся в SQL без org-скоупа ниже. */
export async function findOrCreateDirectConversation(
  orgId: string,
  requesterCorporateAccountId: number,
  targetCorporateAccountId: number
): Promise<FindOrCreateDirectResult> {
  if (requesterCorporateAccountId === targetCorporateAccountId) {
    return { ok: false, error: 'self_conversation' };
  }
  const target = await mirandaRepo.getCorporateAccount(targetCorporateAccountId);
  if (!target || !target.is_active || target.org_id !== orgId) {
    return { ok: false, error: 'not_active' };
  }
  const existing = await messengerRepo.findDirectConversationBetween(orgId, requesterCorporateAccountId, targetCorporateAccountId);
  if (existing) return { ok: true, conversationId: existing.id };

  const conversation = await withTransaction(async (q) => {
    return messengerRepo.createConversation(orgId, 'direct', null, requesterCorporateAccountId, [requesterCorporateAccountId, targetCorporateAccountId], q);
  });
  return { ok: true, conversationId: conversation.id };
}

export type CreateGroupResult = { ok: true; conversationId: string } | { ok: false; error: 'invalid_member' };

export async function createGroupConversation(
  orgId: string,
  requesterCorporateAccountId: number,
  title: string,
  memberCorporateAccountIds: number[]
): Promise<CreateGroupResult> {
  const allMembers = Array.from(new Set([requesterCorporateAccountId, ...memberCorporateAccountIds]));
  for (const accountId of allMembers) {
    if (accountId === requesterCorporateAccountId) continue;
    const account = await mirandaRepo.getCorporateAccount(accountId);
    if (!account || !account.is_active || account.org_id !== orgId) {
      return { ok: false, error: 'invalid_member' };
    }
  }
  const conversation = await withTransaction(async (q) => {
    return messengerRepo.createConversation(orgId, 'group', title, requesterCorporateAccountId, allMembers, q);
  });
  return { ok: true, conversationId: conversation.id };
}

export async function listConversations(corporateAccountId: number) {
  return messengerRepo.listConversationsForAccount(corporateAccountId);
}

export async function listMembers(conversationId: string) {
  return messengerRepo.listMembers(conversationId);
}

export async function isMember(conversationId: string, corporateAccountId: number): Promise<boolean> {
  return messengerRepo.isMember(conversationId, corporateAccountId);
}

export type CreateMessageResult =
  | { ok: true; message: CanonicalMessage; deduplicated: boolean }
  | { ok: false; error: string; message: string };

/**
 * Тот же fail-closed / идемпотентный / транзакционный паттерн, что
 * core/chat/service.ts::createMessage — лочим диалог (не всю организацию,
 * см. messengerRepo.lockConversation), вставляем ON CONFLICT DO NOTHING,
 * на конфликт перечитываем канонический ряд, вложения лочим и привязываем
 * внутри той же транзакции, пустое сообщение откатывается.
 */
export async function createMessage(
  orgId: string,
  conversationId: string,
  senderCorporateAccountId: number,
  senderEmployeeId: number | null,
  clientMessageId: string,
  rawBody: string | null | undefined,
  attachmentIds: string[]
): Promise<CreateMessageResult> {
  const body = typeof rawBody === 'string' ? rawBody.trim() : null;
  const normalizedBody = body && body.length > 0 ? body : null;

  if (normalizedBody && normalizedBody.length > 5000) {
    return { ok: false, error: 'body_too_long', message: 'Сообщение длиннее 5000 символов' };
  }
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: 'too_many_attachments', message: `Максимум ${MAX_ATTACHMENTS_PER_MESSAGE} вложений на сообщение` };
  }

  const result = await withTransaction(async (q) => {
    await messengerRepo.lockConversation(conversationId, q);
    const inserted = await messengerRepo.insertMessageIfAbsent(
      conversationId,
      orgId,
      senderCorporateAccountId,
      senderEmployeeId,
      clientMessageId,
      normalizedBody,
      q
    );

    if (!inserted) {
      const existing = await messengerRepo.findByClientMessageId(senderCorporateAccountId, clientMessageId, q);
      return { kind: 'duplicate' as const, id: existing?.id ?? null };
    }

    const lockedAttachments = attachmentIds.length
      ? await messengerRepo.lockOwnedUnattachedAttachments(attachmentIds, orgId, senderCorporateAccountId, q)
      : [];

    if (attachmentIds.length && lockedAttachments.length !== attachmentIds.length) {
      throw Object.assign(new Error('invalid_attachment'), { messengerValidation: true, messengerError: 'invalid_attachment' });
    }

    if (!normalizedBody && lockedAttachments.length === 0) {
      throw Object.assign(new Error('empty_message'), { messengerValidation: true });
    }

    if (lockedAttachments.length) {
      await messengerRepo.attachToMessage(lockedAttachments.map((a) => a.id), inserted.id, q);
    }

    return { kind: 'created' as const, id: inserted.id };
  }).catch((e: any) => {
    if (e?.messengerValidation) return { kind: 'invalid' as const, id: null, error: e.messengerError as string | undefined };
    throw e;
  });

  if (result.kind === 'invalid') {
    if (result.error === 'invalid_attachment') {
      return {
        ok: false,
        error: 'invalid_attachment',
        message: 'Одно или несколько вложений недоступны (истекли, не найдены или принадлежат другому пользователю/сети)'
      };
    }
    return { ok: false, error: 'empty_message', message: 'Сообщение не может быть пустым' };
  }
  if (!result.id) {
    return { ok: false, error: 'internal_error', message: 'Не удалось получить каноническое сообщение' };
  }

  const row = await messengerRepo.getMessageWithSender(result.id, conversationId);
  if (!row) {
    return { ok: false, error: 'internal_error', message: 'Сообщение не найдено после создания' };
  }
  const attachmentsMap = await attachmentsForMessages([result.id], orgId);
  const message: CanonicalMessage = {
    id: row.id,
    conversationId: row.conversation_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
    sender: toCanonicalSender(row),
    attachments: attachmentsMap.get(row.id) || []
  };
  return { ok: true, message, deduplicated: result.kind === 'duplicate' };
}

export interface ListMessagesResult {
  items: CanonicalMessage[];
  nextCursor: string | null;
}

function toCanonicalMessages(rows: messengerRepo.MessengerMessageWithSender[], attachmentsMap: Map<string, CanonicalAttachment[]>): CanonicalMessage[] {
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
    sender: toCanonicalSender(row),
    attachments: attachmentsMap.get(row.id) || []
  }));
}

export async function listMessages(conversationId: string, orgId: string, limit: number, beforeId?: string): Promise<ListMessagesResult> {
  const rows = await messengerRepo.listMessages(conversationId, limit, beforeId);
  const attachmentsMap = await attachmentsForMessages(rows.map((r) => r.id), orgId);
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
  return { items: toCanonicalMessages(rows, attachmentsMap), nextCursor };
}

export async function listMessagesAfter(conversationId: string, orgId: string, afterId: string, limit: number): Promise<CanonicalMessage[]> {
  const rows = await messengerRepo.listMessagesAfter(conversationId, afterId, limit);
  const attachmentsMap = await attachmentsForMessages(rows.map((r) => r.id), orgId);
  return toCanonicalMessages(rows, attachmentsMap);
}

export async function getRealtimeMessage(id: string, conversationId: string, orgId: string): Promise<CanonicalMessage | null> {
  const row = await messengerRepo.getMessageWithSender(id, conversationId);
  if (!row) return null;
  const attachments = await attachmentsForMessages([id], orgId);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
    sender: toCanonicalSender(row),
    attachments: attachments.get(row.id) || []
  };
}

export async function markRead(
  conversationId: string,
  orgId: string,
  corporateAccountId: number,
  actorEmployeeId: number | null,
  messageId: string
): Promise<void> {
  await messengerRepo.updateLastRead(conversationId, corporateAccountId, messageId);
  await auditRepo.record({
    orgId,
    actorEmployeeId,
    actorTelegramId: null,
    action: 'MIRANDA_MESSAGE_READ',
    targetType: 'messenger_conversation',
    targetId: conversationId,
    after: { corporateAccountId, messageId }
  });
}
