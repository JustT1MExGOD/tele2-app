/**
 * Cron: микро-отчёты 10/12/14/16/18/20 МСК, итог 21:05, напоминания 20:00
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';
import { notifyChat, notifyUser } from '../bot/index.js';
import {
  microReport,
  finalReport,
  shiftReminder,
  microLines,
  finalLines
} from '../bot/messages.js';

const FACT_SQL = `
  SELECT
    COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
    COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones,
    COALESCE(SUM(accessories),0) accessories, COALESCE(SUM(settings),0) settings,
    COALESCE(SUM(insurance),0) insurance, COALESCE(SUM(wink),0) wink,
    COALESCE(SUM(shpd),0) shpd, COALESCE(SUM(focus),0) focus,
    COALESCE(SUM(credit_request),0) credit_request,
    COALESCE(SUM(credit_issued),0) credit_issued,
    COALESCE(SUM(plotter),0) plotter, COALESCE(SUM(hb),0) hb
  FROM sales
  WHERE sale_date::date = $1::date AND store_id = $2
`;

async function loadStorePlans(date: string) {
  // dated plans
  let plans = await query(
    `SELECT sp.*, st.name, st.code, st.id as store_id
     FROM stores st
     LEFT JOIN store_plans sp ON sp.store_id = st.id AND sp.plan_date::date = $1::date
     ORDER BY st.name`,
    [date]
  ).catch(() => ({ rows: [] as any[] }));

  // fill missing from template
  const out = [];
  for (const row of plans.rows) {
    let plan = row;
    if (row.sim == null && row.mnp == null) {
      const tpl = await query(
        `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
        [row.store_id || row.id]
      ).catch(() => ({ rows: [] as any[] }));
      plan = { ...row, ...(tpl.rows[0] || {}) };
    }
    out.push({
      store_id: row.store_id || row.id,
      name: row.name,
      code: row.code,
      plan
    });
  }
  // if stores join empty — fallback stores list
  if (!out.length) {
    const stores = await query(`SELECT id, name, code FROM stores ORDER BY name`);
    for (const st of stores.rows) {
      const tpl = await query(
        `SELECT * FROM store_plans WHERE store_id = $1 AND (plan_date::date = $2::date OR plan_date IS NULL)
         ORDER BY plan_date NULLS LAST LIMIT 1`,
        [st.id, date]
      ).catch(() => ({ rows: [] as any[] }));
      out.push({ store_id: st.id, name: st.name, code: st.code, plan: tpl.rows[0] || {} });
    }
  }
  return out;
}

export function startReportCron() {
  console.log('📅 Cron T2: микро 10–20 · итог 21:05 · смены 20:00 (МСК)');
  setInterval(() => {
    tick().catch((e) => console.error('cron tick', e?.message || e));
  }, 60_000);
}

async function tick() {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
  );
  const hh = now.getHours();
  const mm = now.getMinutes();
  const date = todayMoscow();

  if (hh === 20 && mm === 0) await sendTomorrowReminders(date);

  const microHours = [10, 12, 14, 16, 18, 20];
  if (mm === 0 && microHours.includes(hh)) await sendMicroReports(date, hh);

  if (hh === 21 && mm === 5) await sendFinalReports(date);
}

async function sendTomorrowReminders(today: string) {
  const res = await query(
    `SELECT sch.*, e.full_name, e.telegram_id, st.name as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date::date = ($1::date + interval '1 day')
       AND COALESCE(sch.hours,0) > 0
       AND e.telegram_id IS NOT NULL`,
    [today]
  );
  for (const r of res.rows) {
    await notifyUser(
      r.telegram_id,
      shiftReminder({
        employeeName: r.full_name,
        storeName: r.store_name || r.store_id,
        shiftText: r.shift_text || '',
        hours: r.hours,
        dateLabel: 'завтра'
      })
    );
  }
}

export async function sendMicroReports(date: string, hour?: number) {
  const chat = process.env.REPORT_CHAT_ID || process.env.CHAT_ID;
  if (!chat) {
    console.error('Микро-отчёт: нет REPORT_CHAT_ID / CHAT_ID — некуда слать');
    return { ok: false, error: 'no_chat_id' };
  }
  try {
    const stores = await loadStorePlans(date);
    let sent = 0;
    for (const st of stores) {
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(FACT_SQL, [date, st.store_id]).catch(() => ({ rows: [{}] }));
      const f = fact.rows[0] || {};
      const p = st.plan || {};
      const h = hour ?? new Date().getHours();
      const text = microReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date: `${date} · ${String(h).padStart(2, '0')}:00`,
        staff: staff.rows.map((x: any) => x.full_name),
        lines: microLines(f, p)
      });
      await notifyChat(text);
      sent++;
      console.log('Микро-отчёт отправлен:', st.name, h + ':00');
    }
    return { ok: true, sent };
  } catch (e: any) {
    console.error('micro report', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function sendFinalReports(date: string) {
  const chat = process.env.REPORT_CHAT_ID || process.env.CHAT_ID;
  if (!chat) {
    console.error('Итог: нет REPORT_CHAT_ID / CHAT_ID — некуда слать');
    return { ok: false, error: 'no_chat_id' };
  }
  try {
    const stores = await loadStorePlans(date);
    let sent = 0;
    for (const st of stores) {
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(FACT_SQL, [date, st.store_id]).catch(() => ({ rows: [{}] }));
      const f = fact.rows[0] || {};
      const p = st.plan || {};
      const text = finalReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date,
        staff: staff.rows.map((x: any) => x.full_name),
        lines: finalLines(f, p)
      });
      await notifyChat(text);
      sent++;
      console.log('Итоговый отчёт отправлен:', st.name);
    }
    return { ok: true, sent };
  } catch (e: any) {
    console.error('final report', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}
