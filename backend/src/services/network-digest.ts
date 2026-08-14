/**
 * Reports (18.9) — недельная/месячная сводка по сети. Не новый расчётный
 * движок: buildSupervisorDashboard() уже даёт план/факт/тренд по сети и по
 * точкам (используется Command Center/Store Profile/кабинетом
 * супервайзера), здесь только форматирование в текст и рассылка.
 */
import { query } from '../db/index.js';
import { buildSupervisorDashboard } from './supervisor-analytics.js';
import { getOrg, getOrgNotifyTarget } from './tenant.js';
import { notifyChat } from '../bot/index.js';
import { networkDigest } from '../bot/messages.js';
import { todayMoscow } from '../utils/date.js';
import { claimCronSend } from '../cron/reports.js';

export async function buildNetworkDigestText(orgId: string, days: number, periodLabel: string): Promise<string | null> {
  const storesRes = await query(
    `SELECT id FROM stores WHERE COALESCE(org_id,'default') = $1 AND COALESCE(is_active,true) = true`,
    [orgId]
  );
  const storeIds = storesRes.rows.map((r: any) => String(r.id));
  if (!storeIds.length) return null;

  const dash = await buildSupervisorDashboard({ scope: storeIds, date: todayMoscow(), days });
  const org = await getOrg(orgId);

  const ranked = (dash.stores || [])
    .map((s: any) => ({ name: s.name as string, pct: Math.round(s.today?.overall ?? 0) }))
    .sort((a: any, b: any) => b.pct - a.pct);
  const topStores = ranked.slice(0, 3);
  const bottomStores = ranked.length > 3 ? ranked.slice(-3).reverse() : [];

  return networkDigest({
    orgName: org.name,
    periodLabel,
    days,
    overallPlanPct: Math.round(dash.network?.overall_pct ?? 0),
    paceDelta: Math.round(dash.network?.pace_delta ?? 0),
    topStores,
    bottomStores
  });
}

function isoWeekKey(date: Date): string {
  // ISO week number — стабильный ключ на claim, не зависит от того, в
  // какой день недели реально сработал тик (важно на границе года).
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function sendNetworkDigest(
  kind: 'weekly' | 'monthly',
  opts: { orgId?: string; bypassClaim?: boolean } = {}
): Promise<void> {
  const days = kind === 'weekly' ? 7 : 30;
  const periodLabel = kind === 'weekly' ? 'неделя' : 'месяц';
  const date = todayMoscow();
  const periodKey = kind === 'weekly' ? isoWeekKey(new Date(date + 'T12:00:00')) : date.slice(0, 7);

  let orgIds: string[];
  if (opts.orgId) {
    orgIds = [opts.orgId];
  } else {
    const orgsRes = await query(`SELECT id FROM organizations`);
    orgIds = orgsRes.rows.length ? orgsRes.rows.map((r: any) => r.id) : ['default'];
  }

  for (const orgId of orgIds) {
    if (!opts.bypassClaim) {
      const claimed = await claimCronSend(`digest:${kind}:${orgId}:${periodKey}`);
      if (!claimed) continue;
    }
    try {
      const text = await buildNetworkDigestText(orgId, days, periodLabel);
      if (!text) continue;
      const target = await getOrgNotifyTarget(orgId, 'reports');
      await notifyChat(text, target.chatId, target.threadId);
    } catch (e: any) {
      console.error('sendNetworkDigest failed for org', orgId, e?.message || e);
    }
  }
}
