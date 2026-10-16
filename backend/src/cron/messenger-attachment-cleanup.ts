/**
 * Orphan cleanup для prepared-вложений мессенджера — структурно идентично
 * cron/chat-attachment-cleanup.ts.
 */
import cron, { type ScheduledTask } from 'node-cron';
import * as messengerRepo from '../data/repositories/messenger.js';
import { messengerStorage } from '../core/messenger/storage.js';
import { runJob, jobLogger } from './job-logger.js';

export async function sweepExpiredMessengerAttachments(): Promise<void> {
  await runJob('messenger_attachment_cleanup.sweep', async () => {
    const rows = await messengerRepo.listExpiredOrphanAttachments();
    for (const row of rows) {
      await messengerStorage.delete(row.storage_key).catch((e: any) => {
        jobLogger.warn(
          { job: 'messenger_attachment_cleanup.sweep', attachment_id: row.id, err: e?.message || String(e) },
          'blob delete failed, dropping metadata row anyway'
        );
      });
      await messengerRepo.deleteAttachmentRow(row.id);
    }
    jobLogger.info({ job: 'messenger_attachment_cleanup.sweep', deleted: rows.length }, 'sweep finished');
  });
}

export function startMessengerAttachmentCleanupCron(): ScheduledTask {
  const task = cron.schedule('* * * * *', () => {
    const minute = new Date().getUTCMinutes();
    if (minute !== 30) return; // раз в час, на полчаса смещено от chat-cleanup
    sweepExpiredMessengerAttachments().catch((e) =>
      jobLogger.error({ job: 'messenger_attachment_cleanup.sweep', err: e?.message || String(e) }, 'pre-gate failed')
    );
  });
  console.log('🧹 Messenger attachment cleanup cron started (раз в час)');
  return task;
}
