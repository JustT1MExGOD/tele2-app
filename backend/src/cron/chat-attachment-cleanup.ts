/**
 * Orphan cleanup для prepared-вложений чата (§13 брифа: "не оставлять
 * бесконечно мусорные uploads"). Раз в час — тот же приём, что
 * message-cleanup.ts: cron.schedule('* * * * *', ...) + ручной гейт по
 * минутам, без опции timezone у node-cron (паттерн проекта).
 */
import cron, { type ScheduledTask } from 'node-cron';
import * as chatRepo from '../data/repositories/chat.js';
import { chatStorage } from '../core/chat/storage.js';
import { runJob, jobLogger } from './job-logger.js';

export async function sweepExpiredChatAttachments(): Promise<void> {
  await runJob('chat_attachment_cleanup.sweep', async () => {
    const rows = await chatRepo.listExpiredOrphanAttachments();
    for (const row of rows) {
      await chatStorage.delete(row.storage_key).catch((e: any) => {
        jobLogger.warn(
          { job: 'chat_attachment_cleanup.sweep', attachment_id: row.id, err: e?.message || String(e) },
          'blob delete failed, dropping metadata row anyway'
        );
      });
      await chatRepo.deleteAttachmentRow(row.id);
    }
    jobLogger.info({ job: 'chat_attachment_cleanup.sweep', deleted: rows.length }, 'sweep finished');
  });
}

export function startChatAttachmentCleanupCron(): ScheduledTask {
  const task = cron.schedule('* * * * *', () => {
    const minute = new Date().getUTCMinutes();
    if (minute !== 0) return; // раз в час, в начале часа
    sweepExpiredChatAttachments().catch((e) =>
      jobLogger.error({ job: 'chat_attachment_cleanup.sweep', err: e?.message || String(e) }, 'pre-gate failed')
    );
  });
  console.log('🧹 Chat attachment cleanup cron started (раз в час)');
  return task;
}
