/**
 * Алерты v6 — подключи в startReportCron или отдельный cron
 * - 14:00 МСК: сотрудники на смене с 0 продаж
 * - отставание точки от дневного плана
 */

import cron from 'node-cron';
import { bot, notifyChat } from '../integrations/telegram/bot.js';
import { todayMoscow, nowTimeMoscow } from '../utils/date.js';
import { computeStoreDailyPlans } from '../core/plans/service.js';
import { getOrgNotifyTarget } from '../core/shared/tenant.js';
import * as cronRepo from '../data/repositories/cron.js';
import * as orgsRepo from '../data/repositories/organizations.js';
import { runJob, jobLogger } from './job-logger.js';

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
  return cronRepo.alertWasSent(key);
}
async function mark(key: string) {
  await cronRepo.markAlertSent(key);
}

export async function checkZeroSalesAlert() {
  const now = nowTimeMoscow();
  if (now !== '14:00') return;
  const date = todayMoscow();
  const key = `zero_sales_${date}`;
  if (await wasSent(key)) return;

  await runJob('alerts.zero_sales', async () => {
    const rows0 = await cronRepo.findZeroSalesOnShift(date);

    if (!rows0.length) {
      await mark(key);
      return;
    }

    // Одна сеть — одно сообщение в её чат (в тему "отчёты", если настроена).
    for (const [orgId, rows] of groupByOrg(rows0)) {
      const lines = rows.map((r: any) => `• ${r.full_name} — ${r.store_name}`).join('\n');
      const target = await getOrgNotifyTarget(orgId, 'reports');
      await notifyChat(
        `⚡ <b>Контроль 14:00</b>\nНа смене без продаж:\n${lines}\n\n<i>T2 Sales</i>`,
        target.chatId,
        target.threadId
      );
    }

    for (const r of rows0) {
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
    console.log('Alert zero sales:', rows0.length);
  });
}

export async function checkStoreLagAlert() {
  const now = nowTimeMoscow();
  // 16:00 check
  if (now !== '16:00') return;
  const date = todayMoscow();
  const key = `store_lag_${date}`;
  if (await wasSent(key)) return;

  await runJob('alerts.store_lag', async () => {
    const orgIds0 = await orgsRepo.listIds();
    const orgIds = orgIds0.length ? orgIds0 : ['default'];

    const lagging: { org_id: string; line: string }[] = [];
    for (const orgId of orgIds) {
      let plans: any;
      try {
        plans = await computeStoreDailyPlans(date, orgId);
      } catch {
        continue;
      }
      for (const st of plans.stores || []) {
        const f = await cronRepo.sumKeyMetricsForStoreDate(st.store_id, date);
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
  });
}

export function startAlertCron() {
  cron.schedule('* * * * *', () => {
    // Основная работа уже обёрнута в runJob() внутри каждой функции — этот
    // catch остаётся защитой только на код ДО runJob (time-gate/wasSent),
    // который практически никогда не падает, но не должен ронять процесс
    // необработанным rejection'ом, если всё же упадёт (напр. БД недоступна).
    checkZeroSalesAlert().catch((e) => jobLogger.error({ job: 'alerts.zero_sales', err: e?.message || String(e) }, 'pre-gate failed'));
    checkStoreLagAlert().catch((e) => jobLogger.error({ job: 'alerts.store_lag', err: e?.message || String(e) }, 'pre-gate failed'));
  });
  console.log('🚨 Alert cron v6 started');
}
