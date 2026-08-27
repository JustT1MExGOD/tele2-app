/**
 * Владелец продукта выдал боту admin-права и доступ к сообщениям и
 * попросил: подчищать за собой сообщения 2+ дня спустя — везде, где бот
 * пишет в группы/каналы (отчёты/алерты/дайджесты/продажи), кроме
 * релиз-канала (тот исключён на уровне записи, см.
 * integrations/telegram/bot.ts::trackGroupMessage).
 *
 * Раз в день, 03:00 МСК — тот же приём, что digest.ts/alerts.ts:
 * cron.schedule('* * * * *', ...) + ручной гейт по nowTimeMoscow(), без
 * опции timezone у node-cron (сознательный паттерн проекта). При
 * гранулярности "2 дня" ежедневного прохода достаточно — сообщение
 * реально удалится где-то между 2 и 3 днями жизни в зависимости от
 * времени отправки.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { bot } from '../integrations/telegram/bot.js';
import { nowTimeMoscow } from '../utils/date.js';
import * as cronRepo from '../data/repositories/cron.js';
import { runJob, jobLogger } from './job-logger.js';

const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

export async function sweepOldGroupMessages(): Promise<void> {
  await runJob('message_cleanup.sweep', async () => {
    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
    const rows = await cronRepo.listSentGroupMessagesOlderThan(cutoff);
    let deleted = 0;
    let skipped = 0;
    // Последовательно, не Promise.all — та же осторожность к Telegram
    // rate-limit, что неявно соблюдена во всех остальных местах, где бот
    // шлёт много сообщений подряд.
    for (const row of rows) {
      try {
        if (bot) await bot.api.deleteMessage(row.chat_id, row.message_id);
        deleted++;
      } catch (e: any) {
        // Уже удалено вручную / чат недоступен — не повод хранить
        // мёртвую запись вечно, просто не засчитываем как "удалили мы".
        skipped++;
        jobLogger.warn(
          { job: 'message_cleanup.sweep', chat_id: row.chat_id, message_id: row.message_id, err: e?.message || String(e) },
          'delete failed, dropping tracking row anyway'
        );
      }
      await cronRepo.deleteSentGroupMessageLogRow(row.id);
    }
    jobLogger.info({ job: 'message_cleanup.sweep', deleted, skipped, total: rows.length }, 'sweep finished');
  });
}

/** Возвращает handle — graceful shutdown (index.ts) должен уметь снять таймер. */
export function startMessageCleanupCron(): ScheduledTask {
  const task = cron.schedule('* * * * *', () => {
    if (nowTimeMoscow() !== '03:00') return;
    sweepOldGroupMessages().catch((e) =>
      jobLogger.error({ job: 'message_cleanup.sweep', err: e?.message || String(e) }, 'pre-gate failed')
    );
  });
  console.log('🧹 Message cleanup cron started (2 дня, 03:00 МСК)');
  return task;
}
