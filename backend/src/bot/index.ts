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

  // выключить polling переменной на Railway
  if (process.env.BOT_POLLING === 'false') {
    console.log('🤖 Bot polling disabled (BOT_POLLING=false)');
    return;
  }

  try {
    // всегда снимаем webhook перед polling
    await bot.api.deleteWebhook({ drop_pending_updates: true });
  } catch (e: any) {
    console.warn('deleteWebhook:', e?.message || e);
  }

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '👋 <b>T2 Sales</b>\nОткрой Mini App из меню бота.',
      { parse_mode: 'HTML' }
    );
  });

  bot.catch((err) => {
    const msg = err?.error?.description || err?.message || String(err);
    console.error('Bot error:', msg);
    // 409 не роняем процесс
  });

  try {
    await bot.start({
      onStart: () => console.log('🤖 Bot polling started'),
      drop_pending_updates: true
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('Ошибка бота:', msg);
    if (String(msg).includes('409') || String(msg).includes('Conflict')) {
      console.error('→ Другой инстанс уже polling. Оставь один деплой / выключи локальный bot.');
    }
  }
}

export { saleNotificationMulti, microReport, finalReport, shiftReminder };
