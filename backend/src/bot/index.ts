import { Bot } from 'grammy';
import dotenv from 'dotenv';
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { saleNotification, privateWelcome } from '../bot-messages.js';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  console.warn('BOT_TOKEN не задан');
}

export const bot = token ? new Bot(token) : null;

const userState = new Map<number, any>();

function webAppUrl() {
  return process.env.WEBAPP_URL || process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN || ''}`
    : '';
}

if (bot) {
  bot.command('start', async (ctx) => {
  const url = process.env.WEBAPP_URL || '';
  await ctx.reply(privateWelcome(ctx.from?.first_name), {
    parse_mode: 'HTML',
    reply_markup: url
      ? { inline_keyboard: [[{ text: '🍉 Открыть T2 Sales', web_app: { url } }]] }
      : undefined,
  });
});

  bot.command('stores', async (ctx) => {
    const res = await query('SELECT code, name, work_time FROM stores ORDER BY hours');
    const text = res.rows.map((s: any) => `• ${s.name} (${s.code}) — ${s.work_time}`).join('\n');
    await ctx.reply(text || 'Точек нет');
  });

  bot.command('employees', async (ctx) => {
    const res = await query('SELECT id, full_name FROM employees WHERE is_active = true ORDER BY id');
    const text = res.rows.map((e: any) => `${e.id}. ${e.full_name}`).join('\n');
    await ctx.reply(text || 'Пусто');
  });

  bot.command('schedule', async (ctx) => {
    const today = todayMoscow();
    const res = await query(
      `SELECT e.full_name, st.name as store_name, sch.shift_text, sch.hours
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       JOIN stores st ON st.id = sch.store_id
       WHERE sch.work_date = $1
       ORDER BY st.hours, e.full_name`,
      [today]
    );
    if (!res.rows.length) {
      await ctx.reply('На сегодня никого нет');
      return;
    }
    const text = res.rows
      .map((r: any) => `${r.full_name}\n${r.store_name} — ${r.shift_text} (${r.hours}ч)`)
      .join('\n\n');
    await ctx.reply(`График на ${today}:\n\n${text}`);
  });

  bot.command('sales', async (ctx) => {
    const today = todayMoscow();
    const res = await query(
      `SELECT e.full_name, st.name as store_name, s.sim, s.mnp, s.pa, s.phones
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.sale_date = $1`,
      [today]
    );
    if (!res.rows.length) {
      await ctx.reply('За сегодня продаж нет');
      return;
    }
    const text = res.rows
      .map(
        (r: any) =>
          `${r.full_name} (${r.store_name})\nSIM: ${r.sim} | MNP: ${r.mnp} | ПА: ${r.pa} | Тел: ${r.phones}`
      )
      .join('\n\n');
    await ctx.reply(text);
  });
}

export async function startBot() {
  if (!bot) {
    console.warn('Бот не запущен — нет BOT_TOKEN');
    return;
  }
  try {
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
    } catch (e: any) {
      console.warn('deleteWebhook:', e.message || e);
    }
    await bot.start();
    console.log('Telegram бот запущен');
  } catch (err: any) {
    console.error('Ошибка бота:', err.message || err);
  }
}

export async function notifyAdmin(text: string) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!bot || !adminId) {
    console.warn('ADMIN_TELEGRAM_ID не задан');
    return;
  }
  try {
    await bot.api.sendMessage(adminId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('notifyAdmin error', e);
    try {
      await bot.api.sendMessage(adminId, text.replace(/<[^>]+>/g, ''));
    } catch (_) {}
  }
}

export async function notifyChat(text: string) {
  const chatId = process.env.CHAT_ID;
  if (!bot || !chatId) return;
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('notifyChat error', e);
    try {
      await bot.api.sendMessage(chatId, text.replace(/<[^>]+>/g, ''));
    } catch (_) {}
  }
}