/**
 * Алерты v6 — подключи в startReportCron или отдельный cron
 * - 14:00 МСК: сотрудники на смене с 0 продаж
 * - отставание точки от дневного плана
 */

import cron from 'node-cron';
import { query } from '../db/index.js';
import { bot, notifyChat } from '../bot/index.js';
import { todayMoscow, nowTimeMoscow } from '../utils/date.js';
import { computeStoreDailyPlans } from '../services/plans.js';
import { getOrgNotifyTarget } from '../services/tenant.js';

/** Группировка произвольных строк с полем org_id по сети — каждая сеть получает своё сообщение в свой чат. */
function groupByOrg<T extends { org_id: string }>(rows: T[]): Map<string, T[]> {
  const byOrg = new Map<string, T[]>();
  for (const r of rows) {
    if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []);
    byOrg.get(r.org_id)!.push(r);
  }
  return byOrg;
}

async function wasSent(key: string) {
  const r = await query('SELECT 1 FROM alert_flags WHERE id = $1', [key]);
  return r.rows.length > 0;
}
async function mark(key: string) {
  await query('INSERT INTO alert_flags (id) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
}

export async function checkZeroSalesAlert() {
  const now = nowTimeMoscow();
  if (now !== '14:00') return;
  const date = todayMoscow();
  const key = `zero_sales_${date}`;
  if (await wasSent(key)) return;

  const res = await query(
    `SELECT e.full_name, e.telegram_id, st.name as store_name, sch.shift_text,
            COALESCE(st.org_id, 'default') as org_id
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date = $1 AND sch.hours > 0 AND e.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM sales s
         WHERE s.employee_id = e.id AND s.sale_date = $1
           AND (s.sim+s.mnp+s.pa+s.combo+s.phones) > 0
       )`,
    [date]
  );

  if (!res.rows.length) {
    await mark(key);
    return;
  }

  // Одна сеть — одно сообщение в её чат (в тему "отчёты", если настроена).
  for (const [orgId, rows] of groupByOrg(res.rows)) {
    const lines = rows.map((r: any) => `• ${r.full_name} — ${r.store_name}`).join('\n');
    const target = await getOrgNotifyTarget(orgId, 'reports');
    await notifyChat(
      `⚡ <b>Контроль 14:00</b>\nНа смене без продаж:\n${lines}\n\n<i>T2 Sales</i>`,
      target.chatId,
      target.threadId
    );
  }

  for (const r of res.rows) {
    if (bot && r.telegram_id) {
      try {
        await bot.api.sendMessage(
          r.telegram_id,
          `⚡ Привет! До 14:00 по тебе ещё нет продаж на смене (${r.store_name}).\nЕсли уже внёс — ок. Если нет — не забудь 💪\n\n<i>T2 Sales</i>`,
          { parse_mode: 'HTML' }
        );
      } catch (_) {}
    }
  }
  await mark(key);
  console.log('Alert zero sales:', res.rows.length);
}

export async function checkStoreLagAlert() {
  const now = nowTimeMoscow();
  // 16:00 check
  if (now !== '16:00') return;
  const date = todayMoscow();
  const key = `store_lag_${date}`;
  if (await wasSent(key)) return;

  const orgsRes = await query(`SELECT id FROM organizations`);
  const orgIds = orgsRes.rows.length ? orgsRes.rows.map((r: any) => r.id) : ['default'];

  const lagging: { org_id: string; line: string }[] = [];
  for (const orgId of orgIds) {
    let plans: any;
    try {
      plans = await computeStoreDailyPlans(date, orgId);
    } catch {
      continue;
    }
    for (const st of plans.stores || []) {
      const fact = await query(
        `SELECT COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
                COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo
         FROM sales WHERE store_id = $1 AND sale_date = $2`,
        [st.store_id, date]
      );
      const f = fact.rows[0];
      const planSim = Number(st.plan?.sim) || 0;
      const factSim = Number(f.sim) || 0;
      if (planSim > 0 && factSim / planSim < 0.4) {
        lagging.push({
          org_id: orgId,
          line: `• ${st.name}: SIM ${factSim}/${planSim} (${Math.round((factSim / planSim) * 100)}%)`
        });
      }
    }
  }

  // Одна сеть — одно сообщение в её чат (в тему "отчёты", если настроена).
  for (const [orgId, rows] of groupByOrg(lagging)) {
    const target = await getOrgNotifyTarget(orgId, 'reports');
    await notifyChat(
      `📉 <b>Отставание точек 16:00</b>\n${rows.map((r) => r.line).join('\n')}\n\n<i>T2 Sales</i>`,
      target.chatId,
      target.threadId
    );
  }
  await mark(key);
}

export function startAlertCron() {
  cron.schedule('* * * * *', () => {
    checkZeroSalesAlert().catch(console.error);
    checkStoreLagAlert().catch(console.error);
  });
  console.log('🚨 Alert cron v6 started');
}
