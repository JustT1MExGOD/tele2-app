import { Bot } from 'grammy';
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
    await ctx.reply(
      '👋 <b>T2 Sales</b>\nОткрой Mini App из меню бота.',
      { parse_mode: 'HTML' }
    );
  });
  bot.catch((err) => console.error('Bot error:', err));

  // сброс webhook чтобы polling не конфликтовал
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
      console.error('→ Другой инстанс уже polling. Оставь один деплой / выключи локальный bot.');
    }
  }
}

export { saleNotificationMulti, microReport, finalReport, shiftReminder };
