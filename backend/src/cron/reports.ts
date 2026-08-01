import { query } from '../db/index.js';
import { notifyChat, notifyUser } from '../bot/index.js';
import { microReport, finalReport, shiftReminder } from '../bot/messages.js';
import { todayMoscow } from '../utils/date.js';
import { computeStoreDailyPlans } from '../services/plans.js';

/** Простой cron без node-cron dependency — setInterval проверки минут */
export function startReportCron() {
  console.log('📅 Cron T2: отчёты + напоминания смен');
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

  // напоминание о завтрашней смене в 20:00
  if (hh === 20 && mm === 0) {
    await sendTomorrowReminders(date);
  }

  // микро-отчёты в :00 типовых часов
  const microHours = [10, 12, 14, 16, 18, 20];
  if (mm === 0 && microHours.includes(hh)) {
    await sendMicroReports(date, hh);
  }

  // итог в 21:05
  if (hh === 21 && mm === 5) {
    await sendFinalReports(date);
  }
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
    const text = shiftReminder({
      employeeName: r.full_name,
      storeName: r.store_name || r.store_id,
      shiftText: r.shift_text || '',
      hours: r.hours,
      dateLabel: 'завтра'
    });
    await notifyUser(r.telegram_id, text);
  }
}

async function sendMicroReports(date: string, hour: number) {
  try {
    const plans = await computeStoreDailyPlans(date);
    for (const st of plans.stores || []) {
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(
        `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
                COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones
         FROM sales WHERE sale_date::date = $1::date AND store_id = $2`,
        [date, st.store_id]
      );
      const f = fact.rows[0] || {};
      const p = st.plan || {};
      const text = microReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date: `${date} ${String(hour).padStart(2, '0')}:00`,
        staff: staff.rows.map((x: any) => x.full_name),
        lines: [
          { label: 'SIM', fact: Number(f.sim), plan: Number(p.sim) || 0 },
          { label: 'MNP', fact: Number(f.mnp), plan: Number(p.mnp) || 0 },
          { label: 'ПА', fact: Number(f.pa), plan: Number(p.pa) || 0 },
          { label: 'Комбо', fact: Number(f.combo), plan: Number(p.combo) || 0 },
          { label: 'Тел', fact: Number(f.phones), plan: Number(p.phones) || 0 }
        ]
      });
      await notifyChat(text);
      console.log('Микро-отчёт:', st.name, hour + ':00');
    }
  } catch (e: any) {
    console.error('micro report', e?.message || e);
  }
}

async function sendFinalReports(date: string) {
  try {
    const plans = await computeStoreDailyPlans(date);
    for (const st of plans.stores || []) {
      const staff = await query(
        `SELECT e.full_name FROM schedules sch
         JOIN employees e ON e.id = sch.employee_id
         WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
        [date, st.store_id]
      );
      const fact = await query(
        `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
                COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones
         FROM sales WHERE sale_date::date = $1::date AND store_id = $2`,
        [date, st.store_id]
      );
      const f = fact.rows[0] || {};
      const p = st.plan || {};
      const text = finalReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date,
        staff: staff.rows.map((x: any) => x.full_name),
        lines: [
          { label: 'SIM', fact: Number(f.sim), plan: Number(p.sim) || 0 },
          { label: 'MNP', fact: Number(f.mnp), plan: Number(p.mnp) || 0 },
          { label: 'ПА', fact: Number(f.pa), plan: Number(p.pa) || 0 },
          { label: 'Комбо', fact: Number(f.combo), plan: Number(p.combo) || 0 },
          { label: 'Тел', fact: Number(f.phones), plan: Number(p.phones) || 0 }
        ]
      });
      await notifyChat(text);
      console.log('Итоговый отчёт:', st.name);
    }
  } catch (e: any) {
    console.error('final report', e?.message || e);
  }
}
