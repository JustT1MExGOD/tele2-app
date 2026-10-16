/**
 * Загрузка/скачивание вложений мессенджера — структурно идентично
 * routes/chat/attachments.ts, но uploader/авторизация — corporate_account_id
 * (активный на сессии), а скачивание проверяет членство в диалоге
 * вложения, а не просто org_id (диалоги не org-wide, в отличие от чата).
 */
import { FastifyInstance } from 'fastify';
import * as messengerRepo from '../../../data/repositories/messenger.js';
import * as messengerService from '../../../core/messenger/service.js';
import { resolveMirandaPrincipal } from '../../../core/miranda-accounts/service.js';
import { employeeAwareKeyGenerator } from '../../../security/rate-limit.js';
import { messengerStorage } from '../../../core/messenger/storage.js';
import {
  validateAttachment,
  generateStorageKey,
  contentDispositionHeader,
  MAX_ATTACHMENT_BYTES,
  PREPARED_ATTACHMENT_TTL_MS
} from '../../../core/chat/attachment-validation.js';

export async function registerMirandaAttachmentRoutes(app: FastifyInstance) {
  app.post(
    '/miranda/attachments',
    {
      config: {
        rateLimit: { max: 15, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: employeeAwareKeyGenerator('miranda_attach_upload') }
      }
    },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const accountId = principal.corporateAccountId;
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

      const orgId = principal.orgId;
      const storageKey = generateStorageKey();
      const expiresAt = new Date(Date.now() + PREPARED_ATTACHMENT_TTL_MS).toISOString();
      const row = await messengerRepo.createPreparedAttachment(
        orgId,
        accountId,
        storageKey,
        validation.safeFilename,
        validation.realMime,
        buffer.length,
        expiresAt
      );
      await messengerStorage.put(storageKey, buffer);
      return {
        id: row.id,
        originalFilename: row.original_filename,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        expiresAt: row.expires_at
      };
    }
  );

  app.get(
    '/miranda/attachments/:id',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: employeeAwareKeyGenerator('miranda_attach_download') }
      }
    },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const accountId = principal.corporateAccountId;
      const { id } = request.params as { id: string };
      const orgId = principal.orgId;
      const row = await messengerRepo.getAttachmentForDownload(id, orgId);
      if (!row) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (row.message_deleted_at) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (!row.message_id) {
        // Не привязано ни к одному сообщению — видит только сам загрузивший
        // (тот же принцип, что chat/attachments.ts: черновик до отправки).
        if (Number(row.uploader_corporate_account_id) !== accountId) {
          return reply.code(404).send({ error: 'not_found' });
        }
      } else if (!(await messengerService.isMember(row.conversation_id!, accountId))) {
        // Привязано — доступ только участникам того диалога, не всей org
        // (мессенджер не org-wide, в отличие от общего чата).
        return reply.code(404).send({ error: 'not_found' });
      }
      const data = await messengerStorage.get(row.storage_key);
      if (!data) {
        return reply.code(404).send({ error: 'not_found' });
      }
      reply.header('Content-Disposition', contentDispositionHeader(row.original_filename));
      reply.header('Cache-Control', 'private, max-age=300');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.type(row.mime_type).send(data);
    }
  );
}
