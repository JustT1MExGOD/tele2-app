/**
 * Оркестрация чата (§5/§6/§7 брифа) — единственное место, где REST/WS роуты
 * трогают бизнес-логику. Ничего здесь не читает org_id/senderId откуда-то
 * кроме параметров, которые сами routes/chat/*.ts обязаны брать
 * исключительно из request.user (authenticated principal), никогда из тела
 * запроса — это инвариант проверяется тестами tests/isolation/chat-*.ts,
 * не этим файлом.
 */
import { withTransaction } from '../../data/db/index.js';
import * as chatRepo from '../../data/repositories/chat.js';
import { MAX_ATTACHMENTS_PER_MESSAGE } from './attachment-validation.js';

export interface CanonicalSender {
  id: number;
  displayName: string;
  role: string;
}

export interface CanonicalAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CanonicalMessage {
  id: string;
  clientMessageId: string;
  body: string | null;
  createdAt: string;
  sender: CanonicalSender;
  attachments: CanonicalAttachment[];
}

function toCanonicalSender(row: chatRepo.ChatMessageWithAuthor): CanonicalSender {
  // employees.id — bigint; pg возвращает bigint как string по умолчанию
  // (нет глобального type parser'а, см. db/index.ts) — тот же явный
  // Number(), которым это уже решено в auth/principal.ts::principalFromRow.
  const id = Number(row.sender_employee_id);
  return {
    id,
    displayName: row.sender_short_name || row.sender_full_name || `#${id}`,
    role: row.sender_role
  };
}

function toCanonicalAttachment(row: chatRepo.ChatAttachmentRow): CanonicalAttachment {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes)
  };
}

async function attachmentsForMessages(messageIds: string[], orgId: string): Promise<Map<string, CanonicalAttachment[]>> {
  const rows = await chatRepo.listAttachmentsForMessages(messageIds, orgId);
  const map = new Map<string, CanonicalAttachment[]>();
  for (const row of rows) {
    if (!row.message_id) continue;
    const list = map.get(row.message_id) || [];
    list.push(toCanonicalAttachment(row));
    map.set(row.message_id, list);
  }
  return map;
}

export type CreateMessageResult =
  | { ok: true; message: CanonicalMessage; deduplicated: boolean }
  | { ok: false; error: string; message: string };

/**
 * body != '' OR attachments.length > 0 — проверяется ПОСЛЕ реального
 * лока+фильтрации вложений (lockOwnedUnattachedAttachments), не до: клиент
 * мог прислать attachmentId, который уже истёк/чужой/уже привязан, а тело
 * пустое — без перепроверки ПОСЛЕ фильтрации получилось бы пустое
 * сообщение без единого настоящего вложения.
 */
export async function createMessage(
  orgId: string,
  senderEmployeeId: number,
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
    const inserted = await chatRepo.insertMessageIfAbsent(orgId, senderEmployeeId, clientMessageId, normalizedBody, q);

    if (!inserted) {
      // Конфликт по UNIQUE(sender_employee_id, client_message_id) — это
      // либо честный retry (та же сеть), либо гонка двух конкурентных
      // POST с одним clientMessageId. В обоих случаях правильный ответ —
      // канонический уже созданный ряд, не вторая попытка вставки.
      const existing = await chatRepo.findByClientMessageId(senderEmployeeId, clientMessageId, q);
      return { kind: 'duplicate' as const, id: existing?.id ?? null };
    }

    const lockedAttachments = attachmentIds.length
      ? await chatRepo.lockOwnedUnattachedAttachments(attachmentIds, orgId, senderEmployeeId, q)
      : [];

    // Fail-closed, не best-effort (hotfix 20.57.1 PASS 2, finding #3):
    // раньше несовпадающее число (просрочено/чужая сеть/чужой uploader/уже
    // привязано/дубликат id в запросе — lockOwnedUnattachedAttachments молча
    // не возвращает такую строку) приводило к тому, что сообщение всё равно
    // создавалось с ТОЛЬКО валидным подмножеством вложений — отправитель не
    // мог узнать, что часть вложений отвалилась. ANY($1) не размножает
    // строку на дубликаты id во входном массиве, так что дубликат тоже ловится
    // этой же проверкой (2 id в запросе, 1 совпавшая строка).
    if (attachmentIds.length && lockedAttachments.length !== attachmentIds.length) {
      throw Object.assign(new Error('invalid_attachment'), { chatValidation: true, chatError: 'invalid_attachment' });
    }

    if (!normalizedBody && lockedAttachments.length === 0) {
      // Откатываем — withTransaction ловит throw и делает ROLLBACK.
      throw Object.assign(new Error('empty_message'), { chatValidation: true });
    }

    if (lockedAttachments.length) {
      await chatRepo.attachToMessage(lockedAttachments.map((a) => a.id), inserted.id, q);
    }

    return { kind: 'created' as const, id: inserted.id };
  }).catch((e: any) => {
    if (e?.chatValidation) return { kind: 'invalid' as const, id: null, error: e.chatError as string | undefined };
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

  const row = await chatRepo.getMessageWithAuthor(result.id, orgId);
  if (!row) {
    return { ok: false, error: 'internal_error', message: 'Сообщение не найдено после создания' };
  }
  const attachmentsMap = await attachmentsForMessages([result.id], orgId);
  const message: CanonicalMessage = {
    id: row.id,
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

function toCanonicalMessages(rows: chatRepo.ChatMessageWithAuthor[], attachmentsMap: Map<string, CanonicalAttachment[]>): CanonicalMessage[] {
  return rows.map((row) => ({
    id: row.id,
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: row.created_at,
    sender: toCanonicalSender(row),
    attachments: attachmentsMap.get(row.id) || []
  }));
}

export async function listMessages(orgId: string, limit: number, beforeId?: string): Promise<ListMessagesResult> {
  const rows = await chatRepo.listMessages(orgId, limit, beforeId);
  const attachmentsMap = await attachmentsForMessages(rows.map((r) => r.id), orgId);
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
  return { items: toCanonicalMessages(rows, attachmentsMap), nextCursor };
}

/** Polling fallback / WS-reconnect catch-up (§8/§9 брифа) — см.
 * chatRepo.listMessagesAfter. ASC порядок, готов вставляться в конец ленты
 * как есть. */
export async function listMessagesAfter(orgId: string, afterId: string, limit: number): Promise<CanonicalMessage[]> {
  const rows = await chatRepo.listMessagesAfter(orgId, afterId, limit);
  const attachmentsMap = await attachmentsForMessages(rows.map((r) => r.id), orgId);
  return toCanonicalMessages(rows, attachmentsMap);
}
