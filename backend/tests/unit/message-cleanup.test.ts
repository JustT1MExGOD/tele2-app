import { describe, it, expect, afterAll } from 'vitest';
import { recordSentGroupMessage, listSentGroupMessagesOlderThan, deleteSentGroupMessageLogRow } from '../../src/data/repositories/cron.js';
import { sweepOldGroupMessages } from '../../src/cron/message-cleanup.js';
import { trackGroupMessage } from '../../src/integrations/telegram/bot.js';
import { query } from '../../src/data/db/index.js';

// Владелец продукта выдал боту admin-права и доступ к сообщениям и
// попросил автоудаление сообщений, отправленных ботом в группы/каналы,
// через 2+ дня. BOT_TOKEN не задан в CI/.env.test → bot === null →
// bot.api.deleteMessage физически не вызывается (тот же null-guard, что
// везде в bot.ts) — эти тесты проверяют только поведение таблицы
// bot_sent_messages, не живой Telegram API.
describe('bot_sent_messages — журнал для автоудаления через 2+ дня', () => {
  const testChatId = 'test19-chat-' + Date.now();

  afterAll(async () => {
    await query(`DELETE FROM bot_sent_messages WHERE chat_id = $1`, [testChatId]);
  });

  it('recordSentGroupMessage — запись появляется в таблице', async () => {
    await recordSentGroupMessage(testChatId, 111);
    const res = await query(`SELECT * FROM bot_sent_messages WHERE chat_id = $1 AND message_id = 111`, [testChatId]);
    expect(res.rows.length).toBe(1);
  });

  it('listSentGroupMessagesOlderThan — возвращает только записи старше cutoff, не свежие', async () => {
    await query(
      `INSERT INTO bot_sent_messages (chat_id, message_id, sent_at) VALUES ($1, 222, now() - interval '3 days')`,
      [testChatId]
    );
    await query(
      `INSERT INTO bot_sent_messages (chat_id, message_id, sent_at) VALUES ($1, 333, now() - interval '1 hour')`,
      [testChatId]
    );
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await listSentGroupMessagesOlderThan(cutoff);
    const ids = rows.filter((r) => r.chat_id === testChatId).map((r) => r.message_id);
    expect(ids).toContain(222);
    expect(ids).not.toContain(333);
  });

  it('deleteSentGroupMessageLogRow — реально удаляет строку', async () => {
    await recordSentGroupMessage(testChatId, 444);
    const before = await query(`SELECT id FROM bot_sent_messages WHERE chat_id = $1 AND message_id = 444`, [testChatId]);
    expect(before.rows.length).toBe(1);
    await deleteSentGroupMessageLogRow(before.rows[0].id);
    const after = await query(`SELECT id FROM bot_sent_messages WHERE chat_id = $1 AND message_id = 444`, [testChatId]);
    expect(after.rows.length).toBe(0);
  });

  it('sweepOldGroupMessages — старая запись (3 дня) пропадает, свежая (1 час) остаётся', async () => {
    const chatId = 'test19-sweep-' + Date.now();
    await query(`INSERT INTO bot_sent_messages (chat_id, message_id, sent_at) VALUES ($1, 555, now() - interval '3 days')`, [chatId]);
    await query(`INSERT INTO bot_sent_messages (chat_id, message_id, sent_at) VALUES ($1, 666, now() - interval '1 hour')`, [chatId]);

    await sweepOldGroupMessages();

    const remaining = await query(`SELECT message_id FROM bot_sent_messages WHERE chat_id = $1`, [chatId]);
    const remainingIds = remaining.rows.map((r: any) => r.message_id);
    expect(remainingIds).not.toContain(555);
    expect(remainingIds).toContain(666);

    await query(`DELETE FROM bot_sent_messages WHERE chat_id = $1`, [chatId]);
  });

  it('trackGroupMessage — обычный chat_id пишет строку в журнал', async () => {
    const chatId = 'test19-track-normal-' + Date.now();
    await trackGroupMessage(chatId, 777);
    const res = await query(`SELECT * FROM bot_sent_messages WHERE chat_id = $1 AND message_id = 777`, [chatId]);
    expect(res.rows.length).toBe(1);
    await query(`DELETE FROM bot_sent_messages WHERE chat_id = $1`, [chatId]);
  });

  it('trackGroupMessage — RELEASE_CHANNEL_ID исключён из журнала (анонсы версий остаются архивом навсегда)', async () => {
    const channelId = 'test19-release-channel-' + Date.now();
    const prev = process.env.RELEASE_CHANNEL_ID;
    process.env.RELEASE_CHANNEL_ID = channelId;
    try {
      await trackGroupMessage(channelId, 888);
    } finally {
      if (prev === undefined) delete process.env.RELEASE_CHANNEL_ID;
      else process.env.RELEASE_CHANNEL_ID = prev;
    }
    const res = await query(`SELECT * FROM bot_sent_messages WHERE chat_id = $1 AND message_id = 888`, [channelId]);
    expect(res.rows.length).toBe(0);
  });
});
