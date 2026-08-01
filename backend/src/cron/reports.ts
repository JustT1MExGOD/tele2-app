/**
 * T2 Sales — отчёты + напоминания о сменах
 * Замени src/cron/reports.ts на этот файл (или смержи)
 */

import cron from 'node-cron';
import { query } from '../db/index.js';
import { bot, notifyChat } from '../bot/index.js';
import { todayMoscow, nowTimeMoscow } from '../utils/date.js';
import { microReport, finalReport, shiftReminder } from '../bot-messages.js';

async function wasSent(key: string) {
  const res = await query('SELECT 1 FROM report_flags WHERE id = $1', [key]);
  return res.rows.length > 0;
}

async function markSent(key: string) {
  await query(
    'INSERT INTO report_flags (id) VALUES ($1) ON CONFLICT DO NOTHING',
    [key]
  );
}

async function buildLines(storeId: string, date: string) {
  const planRes = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
    [storeId]
  );
  const plan = planRes.rows[0] || {};
  const factRes = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(insurance),0) as insurance, COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(shpd),0) as shpd, COALESCE(SUM(focus),0) as focus
     FROM sales WHERE sale_date = $1 AND store_id = $2`,
    [date, storeId]
  );
  const fact = factRes.rows[0] || {};
  return [
    { label: 'SIM', fact: Number(fact.sim), plan: Number(plan.sim) || 0 },
    { label: 'MNP', fact: Number(fact.mnp), plan: Number(plan.mnp) || 0 },
    { label: 'ПА', fact: Number(fact.pa), plan: Number(plan.pa) || 0 },
    { label: 'Комбо', fact: Number(fact.combo), plan: Number(plan.combo) || 0 },
    { label: 'Телефоны', fact: Number(fact.phones), plan: Number(plan.phones) || 0 },
    { label: 'Аксы', fact: Number(fact.accessories), plan: Number(plan.accessories) || 0 },
    { label: 'Wink', fact: Number(fact.wink), plan: Number(plan.wink) || 0 },
    { label: 'ШПД', fact: Number(fact.shpd), plan: Number(plan.shpd) || 0 }
  ];
}

async function checkReports() {
  const now = nowTimeMoscow();
  const date = todayMoscow();
  if (!process.env.CHAT_ID) return;

  const storesRes = await query(
    `SELECT * FROM stores WHERE is_active = true OR is_active IS NULL`
  );

  for (const store of storesRes.rows) {
    const empRes = await query(
      `SELECT e.full_name FROM schedules sch
       JOIN employees e ON e.id = sch.employee_id
       WHERE sch.work_date = $1 AND sch.store_id = $2`,
      [date, store.id]
    );
    const staff = empRes.rows.map((r: any) => r.full_name);
    const lines = await buildLines(store.id, date);

    const times: string[] = store.micro_report_times || [];
    for (const time of times) {
      if (String(time).slice(0, 5) === now) {
        const key = `micro_${store.id}_${date}_${time}`;
        if (!(await wasSent(key))) {
          const text = microReport({
            storeName: store.name,
            storeCode: store.code,
            date,
            staff,
            lines
          });
          await notifyChat(text);
          await markSent(key);
          console.log('Микро-отчёт T2:', store.name, time);
        }
      }
    }

    const closeTime = String(store.close_time_weekday || '21:00').slice(0, 5);
    if (closeTime === now) {
      const key = `final_${store.id}_${date}`;
      if (!(await wasSent(key))) {
        const text = finalReport({
          storeName: store.name,
          storeCode: store.code,
          date,
          staff,
          lines
        });
        await notifyChat(text);
        await markSent(key);
        console.log('Итоговый T2:', store.name);
      }
    }
  }
}

/** Напоминание о смене завтра — в 20:00 МСК */
async function checkShiftReminders() {
  const now = nowTimeMoscow();
  if (now !== '20:00') return;
  if (!bot) return;

  const today = todayMoscow();
  const d = new Date(today + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  const dateLabel = tomorrow.slice(8, 10) + '.' + tomorrow.slice(5, 7);

  const res = await query(
    `SELECT sch.*, e.full_name, e.telegram_id, st.name as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date = $1 AND sch.hours > 0
       AND e.telegram_id IS NOT NULL AND e.is_active = true`,
    [tomorrow]
  );

  for (const row of res.rows) {
    const key = `remind_${row.employee_id}_${tomorrow}`;
    if (await wasSent(key)) continue;
    try {
      const text = shiftReminder({
        employeeName: row.full_name,
        storeName: row.store_name,
        shiftText: row.shift_text || '',
        hours: row.hours,
        dateLabel
      });
      await bot.api.sendMessage(row.telegram_id, text, { parse_mode: 'HTML' });
      await markSent(key);
      console.log('Напоминание смены:', row.full_name);
    } catch (e) {
      console.error('remind fail', e);
    }
  }
}

export function startReportCron() {
  cron.schedule('* * * * *', () => {
    checkReports().catch(console.error);
    checkShiftReminders().catch(console.error);
  });
  console.log('📅 Cron T2: отчёты + напоминания смен');
}
