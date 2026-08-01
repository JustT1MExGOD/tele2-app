import { query } from '../db/index.js';
import { notifyChat, notifyUser } from '../bot/index.js';
import { microReport, finalReport, shiftReminder } from '../bot/messages.js';
import { todayMoscow } from '../utils/date.js';
import { computeStoreDailyPlans } from '../services/plans.js';

const FACT_SQL = `
  SELECT
    COALESCE(SUM(sim),0) as sim,
    COALESCE(SUM(mnp),0) as mnp,
    COALESCE(SUM(pa),0) as pa,
    COALESCE(SUM(combo),0) as combo,
    COALESCE(SUM(phones),0) as phones,
    COALESCE(SUM(accessories),0) as accessories,
    COALESCE(SUM(settings),0) as settings,
    COALESCE(SUM(insurance),0) as insurance,
    COALESCE(SUM(wink),0) as wink,
    COALESCE(SUM(shpd),0) as shpd,
    COALESCE(SUM(focus),0) as focus,
    COALESCE(SUM(credit_request),0) as credit_request,
    COALESCE(SUM(credit_issued),0) as credit_issued,
    COALESCE(SUM(plotter),0) as plotter,
    COALESCE(SUM(hb),0) as hb
  FROM sales
  WHERE sale_date::date = $1::date AND store_id = $2
`;

function n(v: any) {
  return Number(v) || 0;
}

function planOf(p: any, key: string) {
  if (key === 'credit_issued') return n(p.credit_issued ?? p.credit);
  if (key === 'credit_request') return n(p.credit_request ?? 0);
  return n(p[key]);
}

function microLines(f: any, p: any) {
  return [
    { label: 'SIM', fact: n(f.sim), plan: planOf(p, 'sim'), key: 'sim' },
    { label: 'MNP', fact: n(f.mnp), plan: planOf(p, 'mnp'), key: 'mnp' },
    { label: 'ПА', fact: n(f.pa), plan: planOf(p, 'pa'), key: 'pa' },
    { label: 'Комбо', fact: n(f.combo), plan: planOf(p, 'combo'), key: 'combo' },
    { label: 'Телефоны', fact: n(f.phones), plan: planOf(p, 'phones'), key: 'phones' },
    { label: 'Аксы', fact: n(f.accessories), plan: planOf(p, 'accessories'), key: 'accessories' },
    { label: 'Wink', fact: n(f.wink), plan: planOf(p, 'wink'), key: 'wink' },
    { label: 'ШПД', fact: n(f.shpd), plan: planOf(p, 'shpd'), key: 'shpd' }
  ];
}

function finalLines(f: any, p: any) {
  return [
    { label: 'Симкарты', fact: n(f.sim), plan: planOf(p, 'sim') },
    { label: 'MNP', fact: n(f.mnp), plan: planOf(p, 'mnp') },
    { label: 'Абики / золото', fact: n(f.pa), plan: planOf(p, 'pa') },
    { label: 'Комбо', fact: n(f.combo), plan: planOf(p, 'combo') },
    { label: 'Настройки', fact: n(f.settings), plan: planOf(p, 'settings') },
    { label: 'Аксессуары', fact: n(f.accessories), plan: planOf(p, 'accessories') },
    { label: 'Страховки', fact: n(f.insurance), plan: planOf(p, 'insurance') },
    { label: 'Смартфоны', fact: n(f.phones), plan: planOf(p, 'phones') },
    { label: 'WINK', fact: n(f.wink), plan: planOf(p, 'wink') },
    { label: 'Заявка ШПД', fact: n(f.shpd), plan: planOf(p, 'shpd') },
    { label: 'Фокусное об-ние', fact: n(f.focus), plan: planOf(p, 'focus') },
    { label: 'Кредит · заявка', fact: n(f.credit_request), plan: planOf(p, 'credit_request') },
    { label: 'Кредит · выдан', fact: n(f.credit_issued), plan: planOf(p, 'credit_issued') },
    { label: 'Плоттер', fact: n(f.plotter), plan: planOf(p, 'plotter') },
    { label: 'HB', fact: n(f.hb), plan: planOf(p, 'hb') }
  ];
}

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
      const fact = await query(FACT_SQL, [date, st.store_id]);
      const f = fact.rows[0] || {};
      const p = st.plan || {};
      const text = microReport({
        storeName: st.name,
        storeCode: st.code || st.store_id,
        date: `${date} · ${String(hour).padStart(2, '0')}:00`,
        staff: staff.rows.map((x: any) => x.full_name),
        lines: microLines(f, p)
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
      const fact = await query(FACT_SQL, [date, st.store_id]);
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
      console.log('Итоговый отчёт:', st.name);
    }
  } catch (e: any) {
    console.error('final report', e?.message || e);
  }
}
