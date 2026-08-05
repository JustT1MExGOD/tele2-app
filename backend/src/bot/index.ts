import { Bot, InputFile } from 'grammy';
import {
  saleNotificationMulti,
  microReport,
  finalReport,
  shiftReminder
} from './messages.js';

const token = process.env.BOT_TOKEN || '';
export const bot = token ? new Bot(token) : (null as any);

const CHAT_ID = process.env.CHAT_ID || process.env.REPORT_CHAT_ID || '';
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_CHAT_ID || '';

export async function notifyChat(text: string, chatId?: string) {
  const id = chatId || CHAT_ID;
  if (!bot) {
    console.error('notifyChat: bot disabled (no BOT_TOKEN)');
    return;
  }
  if (!id) {
    console.error('notifyChat: no CHAT_ID / REPORT_CHAT_ID');
    return;
  }
  try {
    await bot.api.sendMessage(id, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    } as any);
  } catch (e: any) {
    console.error('notifyChat failed:', e?.message || e, 'chat=', id);
  }
}

/** Картинка-отчёт в чат (PNG). Fallback: SVG-документ */
export async function notifyChatPhoto(
  pngOrSvg: Buffer | string,
  opts: {
    caption?: string;
    filename?: string;
    chatId?: string;
    asDocument?: boolean;
  } = {}
) {
  const id = opts.chatId || CHAT_ID;
  if (!bot) {
    console.error('notifyChatPhoto: no bot');
    return { ok: false, error: 'no_bot' };
  }
  if (!id) {
    console.error('notifyChatPhoto: no CHAT_ID');
    return { ok: false, error: 'no_chat_id' };
  }

  const caption = (opts.caption || 'T2 Sales').slice(0, 1024);

  try {
    if (Buffer.isBuffer(pngOrSvg) && !opts.asDocument) {
      await bot.api.sendPhoto(id, new InputFile(pngOrSvg, opts.filename || 'report.png'), {
        caption
      });
      return { ok: true, type: 'photo' };
    }
    // SVG / document fallback
    const buf = Buffer.isBuffer(pngOrSvg)
      ? pngOrSvg
      : Buffer.from(String(pngOrSvg), 'utf8');
    const name = opts.filename || (Buffer.isBuffer(pngOrSvg) ? 'report.png' : 'report.svg');
    await bot.api.sendDocument(id, new InputFile(buf, name), { caption });
    return { ok: true, type: 'document' };
  } catch (e: any) {
    console.error('notifyChatPhoto failed:', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Несколько фото одним альбомом (Telegram media group) — для story-отчётов */
export async function notifyChatMediaGroup(
  items: { buffer: Buffer; filename: string; caption?: string }[],
  opts: { chatId?: string } = {}
) {
  const id = opts.chatId || CHAT_ID;
  if (!bot) {
    console.error('notifyChatMediaGroup: no bot');
    return { ok: false, error: 'no_bot' };
  }
  if (!id) {
    console.error('notifyChatMediaGroup: no CHAT_ID');
    return { ok: false, error: 'no_chat_id' };
  }
  if (!items.length) return { ok: false, error: 'no_items' };
  try {
    const media = items.map((it) => ({
      type: 'photo' as const,
      media: new InputFile(it.buffer, it.filename),
      caption: it.caption?.slice(0, 1024)
    }));
    await bot.api.sendMediaGroup(id, media);
    return { ok: true, type: 'media_group' };
  } catch (e: any) {
    console.error('notifyChatMediaGroup failed:', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function notifyAdmin(text: string) {
  if (!ADMIN_ID) return notifyChat(text);
  return notifyChat(text, ADMIN_ID);
}

export async function notifyUser(telegramId: number | string, text: string) {
  if (!bot || !telegramId) return;
  try {
    await bot.api.sendMessage(Number(telegramId), text, { parse_mode: 'HTML' });
  } catch (e: any) {
    console.error('notifyUser failed:', e?.message || e);
  }
}

export async function startBot() {
  if (!bot) {
    console.warn('BOT_TOKEN missing — bot disabled');
    return;
  }
  bot.command('start', async (ctx) => {
    await ctx.reply('👋 <b>T2 Sales</b>\nОткрой Mini App из меню бота.', {
      parse_mode: 'HTML'
    });
  });
  // /chatid — узнать chat_id группы и message_thread_id текущей темы (для
  // подключения новой сети: свой чат/тема "продажи"/тема "отчёты" в organizations).
  bot.command('chatid', async (ctx) => {
    const chatId = ctx.chat?.id;
    const threadId = (ctx.message as any)?.message_thread_id;
    const lines = [
      `chat_id: <code>${chatId}</code>`,
      threadId ? `message_thread_id (эта тема): <code>${threadId}</code>` : 'Это не тема форума (или тема "General")'
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });
  bot.catch((err) => console.error('Bot error:', err));
  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
  } catch (_) {}
  if (process.env.BOT_POLLING === 'false') {
    console.log('🤖 Bot API ready (polling off)');
    return;
  }
  try {
    await bot.start({
      onStart: () => console.log('🤖 Bot polling started')
    });
  } catch (e: any) {
    console.error('Ошибка бота:', e?.message || e);
    if (String(e?.message || e).includes('409')) {
      console.error('→ Другой инстанс уже polling.');
    }
  }
}

export { saleNotificationMulti, microReport, finalReport, shiftReminder };
