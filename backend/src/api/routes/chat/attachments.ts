/**
 * Загрузка/скачивание вложений чата (§10/§11/§12/§13 брифа). Upload flow:
 * POST /chat/attachments → prepared attachment (TTL, привязан к uploader+
 * org, ещё ни к какому сообщению) → фронтенд шлёт его id в POST /chat/
 * messages → core/chat/service.ts::createMessage() связывает атомарно.
 */
import { FastifyInstance } from 'fastify';
import * as chatRepo from '../../../data/repositories/chat.js';
import { requireActive } from '../../../auth/guards.js';
import { chatStorage } from '../../../core/chat/storage.js';
import {
  validateAttachment,
  generateStorageKey,
  contentDispositionHeader,
  MAX_ATTACHMENT_BYTES,
  PREPARED_ATTACHMENT_TTL_MS
} from '../../../core/chat/attachment-validation.js';

export async function registerChatAttachmentRoutes(app: FastifyInstance) {
  app.post(
    '/chat/attachments',
    // Загрузка дороже отправки текста (диск/БД-нагрузка) — жёстче лимит,
    // тем же принципом, что me/avatar.ts (10/мин против 30/мин на чтение).
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const data = await request.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES } }).catch(() => null);
      if (!data) {
        return reply.code(400).send({ error: 'no_file', message: 'Файл не получен' });
      }
      const buffer = await data.toBuffer().catch(() => null);
      if (!buffer) {
        return reply.code(400).send({ error: 'read_failed', message: 'Не удалось прочитать файл' });
      }
      const validation = validateAttachment(data.filename || 'file', buffer);
      if (validation.ok !== true) {
        return reply.code(400).send({ error: validation.error, message: validation.message });
      }

      const orgId = request.user!.org_id;
      const uploaderId = request.user!.employee_id!;
      const storageKey = generateStorageKey();
      const expiresAt = new Date(Date.now() + PREPARED_ATTACHMENT_TTL_MS).toISOString();
      // Метаданные ПЕРЕД блобом — chat_attachment_blobs.storage_key несёт
      // FK на chat_attachments.storage_key, обратный порядок нарушает
      // constraint (найдено при первом реальном прогоне тестов).
      const row = await chatRepo.createPreparedAttachment(
        orgId,
        uploaderId,
        storageKey,
        validation.safeFilename,
        validation.realMime,
        buffer.length,
        expiresAt
      );
      await chatStorage.put(storageKey, buffer);
      return {
        id: row.id,
        originalFilename: row.original_filename,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        expiresAt: row.expires_at
      };
    }
  );

  // IDOR-граница (§12 брифа): единственная проверка — org_id вложения ==
  // org_id принципала. storage_key НИКОГДА не используется как токен
  // авторизации (не передаётся клиенту вообще, GET идёт по id вложения).
  app.get(
    '/chat/attachments/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const { id } = request.params as { id: string };
      const orgId = request.user!.org_id;
      const row = await chatRepo.getAttachmentForDownload(id, orgId);
      if (!row) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (row.message_deleted_at) {
        return reply.code(404).send({ error: 'not_found' });
      }
      // Пока вложение не привязано к реально отправленному сообщению
      // (prepared, ещё не часть переписки), его видит только сам
      // загрузивший — иначе любой сотрудник сети мог бы скачать чужой
      // черновик по угаданному/перебранному id раньше, чем автор вообще
      // нажал "отправить" (или вовсе передумал).
      if (!row.message_id && row.uploader_employee_id !== request.user!.employee_id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const data = await chatStorage.get(row.storage_key);
      if (!data) {
        return reply.code(404).send({ error: 'not_found' });
      }
      // Content-Disposition: attachment всегда — потенциально активные
      // документы (DOCX и т.п.) никогда не отдаются inline (§12 брифа).
      // SVG/HTML в allowlist вообще нет (attachment-validation.ts), так
      // что "не показывать inline" здесь уже применяется ко всему набору.
      reply.header('Content-Disposition', contentDispositionHeader(row.original_filename));
      reply.header('Cache-Control', 'private, max-age=300');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.type(row.mime_type).send(data);
    }
  );
}
