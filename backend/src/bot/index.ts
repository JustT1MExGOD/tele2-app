import { Bot } from 'grammy';
import dotenv from 'dotenv';
import { query } from '../db/index.js';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('BOT_TOKEN не указан в .env');

export const bot = new Bot(token);

const userState = new Map<number, any>();

bot.command('start', async (ctx) => {
  await ctx.reply(
    '🍉 Привет! Я бот Tele2.\n\n' +
    'Команды:\n' +
    '/stores — точки\n' +
    '/employees — сотрудники\n' +
    '/schedule — график\n' +
    '/plan — дневной план\n' +
    '/sales — продажи\n' +
    '/add — добавить продажу\n' +
    '/stats — статистика за месяц\n' +
    '/app — открыть приложение'
  );
});

bot.command('stores', async (ctx) => {
  const res = await query('SELECT code, name, work_time FROM stores ORDER BY hours');
  const text = res.rows.map((s: any) => `• ${s.name} (${s.code}) — ${s.work_time}`).join('\n');
  await ctx.reply(text || 'Точек нет');
});

bot.command('employees', async (ctx) => {
  const res = await query('SELECT id, full_name, short_name FROM employees ORDER BY id');
  const text = res.rows.map((e: any) => `${e.id}. ${e.full_name}`).join('\n');
  await ctx.reply(text || 'Сотрудников нет');
});

bot.command('schedule', async (ctx) => {
  const today = new Date().toISOString().slice(0, 10);
  const res = await query(
    `SELECT e.full_name, st.name as store_name, sch.shift_text, sch.hours
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date = $1
     ORDER BY st.hours, e.full_name`,
    [today]
  );
  if (res.rows.length === 0) {
    await ctx.reply('На сегодня никого в графике нет');
    return;
  }
  const text = res.rows
    .map((r: any) => `${r.full_name}\n📍 ${r.store_name} — ${r.shift_text} (${r.hours}ч)`)
    .join('\n\n');
  await ctx.reply(`📅 График на ${today}:\n\n${text}`);
});

bot.command('plan', async (ctx) => {
  const today = new Date().toISOString().slice(0, 10);
  const storesRes = await query('SELECT * FROM stores ORDER BY hours');
  let result = `📋 Дневной план на ${today}\n\n`;

  for (const store of storesRes.rows) {
    const empRes = await query(
      `SELECT e.full_name, sch.shift_text
       FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       WHERE sch.work_date = $1 AND sch.store_id = $2`,
      [today, store.id]
    );
    const planRes = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
      [store.id]
    );
    const plan = planRes.rows[0] || {};
    const factRes = await query(
      `SELECT 
         COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
         COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
         COALESCE(SUM(phones),0) as phones
       FROM sales WHERE sale_date = $1 AND store_id = $2`,
      [today, store.id]
    );
    const fact = factRes.rows[0];

    result += `📍 ${store.name}\n`;
    if (empRes.rows.length === 0) {
      result += 'Нет сотрудников\n\n';
      continue;
    }
    result += empRes.rows.map((e: any) => `• ${e.full_name} — ${e.shift_text}`).join('\n');
    result += `\n\nSIM: ${fact.sim}/${plan.sim || 0}`;
    result += `\nMNP: ${fact.mnp}/${plan.mnp || 0}`;
    result += `\nПА: ${fact.pa}/${plan.pa || 0}`;
    result += `\nКомбо: ${fact.combo}/${plan.combo || 0}`;
    result += `\nТелефоны: ${fact.phones}/${plan.phones || 0}\n\n`;
  }
  await ctx.reply(result);
});

bot.command('sales', async (ctx) => {
  const today = new Date().toISOString().slice(0, 10);
  const res = await query(
    `SELECT e.full_name, st.name as store_name, s.sim, s.mnp, s.pa, s.combo, s.phones
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     JOIN stores st ON st.id = s.store_id
     WHERE s.sale_date = $1`,
    [today]
  );
  if (res.rows.length === 0) {
    await ctx.reply('За сегодня продаж пока нет');
    return;
  }
  const text = res.rows
    .map((r: any) => 
      `${r.full_name} (${r.store_name})\n` +
      `SIM: ${r.sim} | MNP: ${r.mnp} | ПА: ${r.pa} | Комбо: ${r.combo} | Тел: ${r.phones}`
    )
    .join('\n\n');
  await ctx.reply(`📊 Продажи за ${today}:\n\n${text}`);
});



bot.command('stats', async (ctx) => {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  
  const res = await query(
    `SELECT 
       e.full_name,
       SUM(s.sim) as sim,
       SUM(s.mnp) as mnp,
       SUM(s.pa) as pa,
       SUM(s.combo) as combo,
       SUM(s.phones) as phones
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.sale_date >= $1
     GROUP BY e.id, e.full_name
     ORDER BY e.full_name`,
    [`${month}-01`]
  );
  
  if (res.rows.length === 0) {
    await ctx.reply(`За ${month} продаж пока нет`);
    return;
  }
  
  const text = res.rows
    .map((r: any) => 
      `${r.full_name}\n` +
      `SIM: ${r.sim} | MNP: ${r.mnp} | ПА: ${r.pa} | Комбо: ${r.combo} | Тел: ${r.phones}`
    )
    .join('\n\n');
  
  await ctx.reply(`📊 Статистика за ${month}:\n\n${text}`);
});

// ===== КОМАНДА /app — ОТКРЫТЬ MINI APP =====
bot.command('app', async (ctx) => {
    const url = 'https://tele2-app-production.up.railway.app/'; // Ваш новый адрес

    await ctx.reply(
        '🍉 Открой Tele2 Mini App прямо в Telegram!\n\n' +
        'Нажми на кнопку ниже 👇',
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🚀 Открыть Mini App',
                            web_app: { url: url }
                        }
                    ]
                ]
            }
        }
    );
});

// ===== ДОБАВЛЕНИЕ ПРОДАЖИ =====
bot.command('add', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const res = await query('SELECT id, full_name FROM employees ORDER BY id');
  const text = res.rows.map((e: any) => `${e.id}. ${e.full_name}`).join('\n');

  userState.set(userId, { step: 'employee' });
  await ctx.reply(`👤 Выбери сотрудника (напиши номер):\n\n${text}`);
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const state = userState.get(userId);
  if (!state) return;

  const text = ctx.message.text.trim();

  // Шаг 1: выбор сотрудника
  if (state.step === 'employee') {
    const empId = Number(text);
    if (!empId) {
      await ctx.reply('Напиши номер сотрудника');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const sch = await query(
      `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2`,
      [empId, today]
    );

    if (sch.rows.length === 0) {
      await ctx.reply('❌ Этот сотрудник сегодня не в графике');
      userState.delete(userId);
      return;
    }

    state.employee_id = empId;
    state.store_id = sch.rows[0].store_id;
    state.step = 'metric';
    userState.set(userId, state);

    await ctx.reply(
      '📦 Что добавляем?\n\n' +
      '1. SIM\n2. MNP\n3. ПА\n4. Комбо\n5. Телефон\n6. Аксессуары\n7. Страховки\n8. Wink\n9. ШПД\n10. ФО\n11. Плоттер\n12. HB'
    );
    return;
  }

  // Шаг 2: выбор метрики
  if (state.step === 'metric') {
    const map: Record<string, string> = {
      '1': 'sim', '2': 'mnp', '3': 'pa', '4': 'combo',
      '5': 'phones', '6': 'accessories', '7': 'insurance',
      '8': 'wink', '9': 'shpd', '10': 'focus',
      '11': 'plotter', '12': 'hb'
    };

    const metric = map[text];
    if (!metric) {
      await ctx.reply('Напиши номер от 1 до 12');
      return;
    }

    state.metric = metric;
    state.step = 'value';
    userState.set(userId, state);
    await ctx.reply('🔢 Введи количество:');
    return;
  }

  // Шаг 3: значение
  if (state.step === 'value') {
    const value = Number(text.replace(',', '.'));
    if (!value || value < 0) {
      await ctx.reply('Введи положительное число');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, ${state.metric})
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, store_id, sale_date)
       DO UPDATE SET ${state.metric} = sales.${state.metric} + $4, updated_at = now()`,
      [state.employee_id, state.store_id, today, value]
    );

    const info = await query(
      `SELECT e.full_name, st.name as store_name
       FROM employees e, stores st
       WHERE e.id = $1 AND st.id = $2`,
      [state.employee_id, state.store_id]
    );

    const employeeName = info.rows[0]?.full_name || 'Сотрудник';
    const storeName = info.rows[0]?.store_name || '';

    const metricNames: Record<string, string> = {
      sim: 'SIM',
      mnp: 'MNP',
      pa: 'ПА',
      combo: 'Комбо',
      phones: 'Телефон',
      accessories: 'Аксессуары',
      insurance: 'Страховки',
      wink: 'Wink',
      shpd: 'ШПД',
      focus: 'ФО',
      plotter: 'Плоттер',
      hb: 'HB'
    };

    const metricLabel = metricNames[state.metric] || state.metric;

    const chatId = process.env.CHAT_ID;
    if (chatId) {
      const msg = `✅ ${employeeName} ➜ ${value} ${metricLabel} (${storeName})`;
      try {
        await bot.api.sendMessage(chatId, msg);
      } catch (err) {
        console.error('Не удалось отправить в чат:', err);
      }
    }

    userState.delete(userId);
    await ctx.reply(`✅ Готово! Добавлено ${value} в ${metricLabel}`);
  }
});



export async function startBot() {
  await bot.start();
  console.log('🤖 Telegram бот запущен');
}