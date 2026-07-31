import cron from 'node-cron';
import { query } from '../db/index.js';
import { notifyChat } from '../bot/index.js';
import { todayMoscow, nowTimeMoscow } from '../utils/date.js';

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

async function buildStoreReport(store: any, isFinal = false) {
  const date = todayMoscow();

  const empRes = await query(
    `SELECT e.full_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.work_date = $1 AND sch.store_id = $2`,
    [date, store.id]
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
       COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories,
       COALESCE(SUM(insurance),0) as insurance, COALESCE(SUM(wink),0) as wink,
       COALESCE(SUM(shpd),0) as shpd, COALESCE(SUM(focus),0) as focus
     FROM sales WHERE sale_date = $1 AND store_id = $2`,
    [date, store.id]
  );
  const fact = factRes.rows[0];

  const title = isFinal ? '🏁 Итоговый отчёт' : '📊 Промежуточный отчёт';
  let text = `${title}\n${store.name} (${store.code})\n${date}\n\n`;

  if (empRes.rows.length) {
    text += empRes.rows.map((e: any) => `• ${e.full_name}`).join('\n') + '\n\n';
  }

  text += `SIM: ${fact.sim}/${plan.sim || 0}\n`;
  text += `MNP: ${fact.mnp}/${plan.mnp || 0}\n`;
  text += `ПА: ${fact.pa}/${plan.pa || 0}\n`;
  text += `Комбо: ${fact.combo}/${plan.combo || 0}\n`;
  text += `Телефоны: ${fact.phones}/${plan.phones || 0}\n`;
  text += `Аксы: ${fact.accessories}/${plan.accessories || 0}\n`;
  text += `Wink: ${fact.wink}/${plan.wink || 0}\n`;
  text += `ШПД: ${fact.shpd}/${plan.shpd || 0}`;

  return text;
}

async function checkReports() {
  const now = nowTimeMoscow();
  const date = todayMoscow();
  if (!process.env.CHAT_ID) return;

  const storesRes = await query('SELECT * FROM stores WHERE is_active = true');

  for (const store of storesRes.rows) {
    const times: string[] = store.micro_report_times || [];
    for (const time of times) {
      if (String(time).slice(0, 5) === now) {
        const key = `micro_${store.id}_${date}_${time}`;
        if (!(await wasSent(key))) {
          const text = await buildStoreReport(store, false);
          await notifyChat(text);
          await markSent(key);
          console.log('Микро-отчёт:', store.name, time);
        }
      }
    }

    const closeTime = String(store.close_time_weekday || '').slice(0, 5);
    if (closeTime && closeTime === now) {
      const key = `final_${store.id}_${date}`;
      if (!(await wasSent(key))) {
        const text = await buildStoreReport(store, true);
        await notifyChat(text);
        await markSent(key);
        console.log('Итоговый:', store.name);
      }
    }
  }
}

export function startReportCron() {
  cron.schedule('* * * * *', () => {
    checkReports().catch(console.error);
  });
  console.log('📅 Cron отчётов запущен');
}