import { Bot } from 'grammy';
import { saleNotificationMulti, microReport, finalReport, shiftReminder } from './messages.js';

const token = process.env.BOT_TOKEN || '';
export const bot = token ? new Bot(token) : (null as any);

const CHAT_ID = process.env.CHAT_ID || process.env.REPORT_CHAT_ID || '';
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID || process.env.ADMIN_CHAT_ID || '';

export async function notifyChat(text: string, chatId?: string) {
  const id = chatId || CHAT_ID;
  if (!bot || !id) return;
  try {
    await bot.api.sendMessage(id, text, { parse_mode: 'HTML' });
  } catch (e: any) {
    console.error('notifyChat failed:', e?.message || e);
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
      '👋 <b>T2 Sales</b>\nОткрой Mini App из меню бота, чтобы работать с продажами и графиком.',
      { parse_mode: 'HTML' }
    );
  });
  bot.catch((err) => console.error('Bot error:', err));
  // polling only if no webhook
  if (!process.env.WEBHOOK_URL) {
    try {
      await bot.start({
        onStart: () => console.log('🤖 Bot polling started')
      });
    } catch (e: any) {
      console.error('Ошибка бота:', e?.message || e);
    }
  }
}

export { saleNotificationMulti, microReport, finalReport, shiftReminder };
