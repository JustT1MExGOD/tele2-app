/**
 * Тексты отчётов T2 — метрики подтягиваются динамически
 */
import { getMetricDefs, metricLabelMap, MICRO_KEYS, groupForMetric } from '../services/metrics-catalog.js';

const EMOJI_POOL: Record<string, string[]> = {
  sim: ['📱', '✨'], mnp: ['🔄', '📡'], pa: ['🥇', '⭐'], combo: ['📦', '🎁'],
  phones: ['📱', '💥'], accessories: ['🎧', '⌚'], settings: ['⚙️', '🛠️'],
  insurance: ['🛡️', '✅'], wink: ['📺', '🎬'], shpd: ['🌐', '📶'], focus: ['🎯', '🔥'],
  credit_request: ['💳', '📝'], credit_issued: ['💰', '💵'], plotter: ['🖨️', '📐'],
  hb: ['❤️', '💖'], default: ['✨', '⚡']
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function esc(s: any) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function bar(pct: number, width = 10): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}
function pctOf(fact: number, plan: number) {
  if (plan <= 0) return fact > 0 ? 100 : 0;
  return Math.round((fact / plan) * 100);
}
function statusMark(pct: number) {
  if (pct >= 100) return '✅';
  if (pct >= 70) return '🟡';
  if (pct > 0) return '🟠';
  return '⚪';
}
function fmtNum(n: number) {
  if (Math.abs(n) >= 1000) return Number(n).toLocaleString('ru-RU');
  return String(n);
}

export function lineRow(label: string, fact: number, plan: number) {
  const pct = pctOf(fact, plan);
  return `${statusMark(pct)} <b>${esc(label)}</b>\n<code>${bar(pct)}</code>  <b>${fmtNum(fact)}</b> / ${fmtNum(plan)} · ${pct}%`;
}

export async function saleNotification(opts: {
  employeeName: string;
  storeName: string;
  metric: string;
  value: number | string;
}) {
  const labels = await metricLabelMap();
  const emoji = pick(EMOJI_POOL[opts.metric] || EMOJI_POOL.default);
  const label = labels[opts.metric] || opts.metric;
  return (
    `${emoji} <b>ПРОДАЖА</b>\n━━━━━━━━━━━━━━━━\n` +
    `👤 <b>${esc(opts.employeeName)}</b>\n📍 ${esc(opts.storeName)}\n\n` +
    `${emoji}  <b>+${esc(opts.value)}</b>  ${esc(label)}\n━━━━━━━━━━━━━━━━\n<i>T2 Sales</i>`
  );
}

export async function saleNotificationMulti(opts: {
  employeeName: string;
  storeName: string;
  items: { metric: string; value: number | string }[];
}) {
  if (!opts.items?.length) {
    return saleNotification({
      employeeName: opts.employeeName,
      storeName: opts.storeName,
      metric: 'sim',
      value: 0
    });
  }
  if (opts.items.length === 1) {
    return saleNotification({
      employeeName: opts.employeeName,
      storeName: opts.storeName,
      metric: opts.items[0].metric,
      value: opts.items[0].value
    });
  }
  const labels = await metricLabelMap();
  const rows = opts.items
    .map((it) => {
      const emoji = pick(EMOJI_POOL[it.metric] || EMOJI_POOL.default);
      const label = labels[it.metric] || it.metric;
      return `${emoji}  <b>+${esc(it.value)}</b>  ${esc(label)}`;
    })
    .join('\n');
  return (
    `✨ <b>ПРОДАЖИ</b>\n━━━━━━━━━━━━━━━━\n` +
    `👤 <b>${esc(opts.employeeName)}</b>\n📍 ${esc(opts.storeName)}\n\n` +
    `${rows}\n━━━━━━━━━━━━━━━━\n<i>T2 Sales · ${opts.items.length} метрик</i>`
  );
}

export function microReport(opts: {
  storeName: string;
  storeCode: string;
  date: string;
  staff: string[];
  lines: { label: string; fact: number; plan: number; key?: string }[];
}) {
  const staffBlock = opts.staff.length
    ? opts.staff.map((n) => `  · ${esc(n)}`).join('\n')
    : '  · никто на смене';
  const metrics = opts.lines
    .map((l) => lineRow(l.label, Number(l.fact) || 0, Number(l.plan) || 0))
    .join('\n\n');
  let totalFact = 0, totalPlan = 0;
  for (const l of opts.lines) {
    const key = (l.key || l.label).toLowerCase();
    if (['sim', 'mnp', 'pa', 'combo'].some((x) => key.includes(x))) {
      totalFact += Number(l.fact) || 0;
      totalPlan += Number(l.plan) || 0;
    }
  }
  const totalPct = pctOf(totalFact, totalPlan);
  return (
    `📊 <b>ПРОМЕЖУТОЧНЫЙ ОТЧЁТ</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 <b>${esc(opts.storeName)}</b>\n🏷 <code>${esc(opts.storeCode)}</code>\n🕐 ${esc(opts.date)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n<b>👥 Смена</b>\n${staffBlock}\n\n` +
    `<b>📈 Факт / план</b>\n\n${metrics}\n\n━━━━━━━━━━━━━━━━━━━━\n` +
    `Итого (ключ): <b>${totalPct}%</b>  <code>${bar(totalPct, 12)}</code>\n<i>T2 Sales · live</i>`
  );
}

export function finalReport(opts: {
  storeName: string;
  storeCode: string;
  date: string;
  staff: string[];
  lines: { label: string; fact: number; plan: number; group?: string; key?: string }[];
}) {
  const staffBlock = opts.staff.length
    ? opts.staff.map((n) => `  · ${esc(n)}`).join('\n')
    : '  · —';
  const groups: Record<string, { label: string; fact: number; plan: number }[]> = {
    gi: [], top: [], rt: [], credit: [], other: []
  };
  for (const l of opts.lines) {
    const row = { label: l.label, fact: Number(l.fact) || 0, plan: Number(l.plan) || 0 };
    const g = (l.group as any) || groupForMetric(l.key || '', l.label);
    (groups[g] || groups.other).push(row);
  }
  const block = (title: string, rows: { label: string; fact: number; plan: number }[]) => {
    if (!rows.length) return '';
    return `\n${title}\n${'─'.repeat(16)}\n${rows.map((r) => lineRow(r.label, r.fact, r.plan)).join('\n\n')}\n`;
  };
  const metricsBlock =
    block('💎 <b>Блок GI</b>', groups.gi) +
    block('📦 <b>Топ-ап и товарка</b>', groups.top) +
    block('📺 <b>Ростелеком</b>', groups.rt) +
    block('💳 <b>Кредиты</b>', groups.credit) +
    block('✨ <b>Прочее</b>', groups.other);
  return (
    `🏁 <b>ИТОГОВЫЙ ОТЧЁТ</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 ${esc(opts.date)}\n🏪 <b>${esc(opts.storeName)}</b>\n🏷 <code>${esc(opts.storeCode)}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n<b>👥 Команда дня</b>\n${staffBlock}\n${metricsBlock}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n<i>T2 Sales · конец дня</i>`
  );
}

/** 18.9 Reports — недельная/месячная сводка по сети (не по точке), первая
 * периодическая сетевая сводка в проекте: раньше в чат уходили только
 * ежедневные фото-отчёты по каждой точке отдельно. */
export function networkDigest(opts: {
  orgName: string;
  periodLabel: string;
  days: number;
  overallPlanPct: number;
  paceDelta: number;
  topStores: { name: string; pct: number }[];
  bottomStores: { name: string; pct: number }[];
}) {
  const storeLine = (s: { name: string; pct: number }) => `${statusMark(s.pct)} ${esc(s.name)} — <b>${s.pct}%</b>`;
  const topBlock = opts.topStores.length
    ? `\n<b>🏆 Лучшие точки</b>\n${opts.topStores.map(storeLine).join('\n')}\n`
    : '';
  const bottomBlock = opts.bottomStores.length
    ? `\n<b>⚠️ Требуют внимания</b>\n${opts.bottomStores.map(storeLine).join('\n')}\n`
    : '';
  const paceSign = opts.paceDelta > 0 ? '+' : '';
  return (
    `📋 <b>СВОДКА ПО СЕТИ · ${esc(opts.periodLabel.toUpperCase())}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🏢 <b>${esc(opts.orgName)}</b> · ${opts.days} дн.\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${lineRow('План по сети', opts.overallPlanPct, 100)}\n` +
    `📈 Темп: <b>${paceSign}${opts.paceDelta}%</b> к среднему\n` +
    `${topBlock}${bottomBlock}` +
    `\n━━━━━━━━━━━━━━━━━━━━\n<i>T2 Sales</i>`
  );
}

export function shiftReminder(opts: {
  employeeName: string; storeName: string; shiftText: string; hours: number; dateLabel: string;
}) {
  return (
    `⏰ <b>СМЕНА ЗАВТРА</b>\n━━━━━━━━━━━━━━━━\n` +
    `Привет, <b>${esc(opts.employeeName)}</b>\n\n📍 <b>${esc(opts.storeName)}</b>\n` +
    `🕐 ${esc(opts.shiftText)} · ${opts.hours}ч\n📅 ${esc(opts.dateLabel)}\n` +
    `━━━━━━━━━━━━━━━━\nУдачной смены ✨\n<i>T2 Sales</i>`
  );
}

export function privateWelcome(name?: string) {
  return `👋 <b>T2 Sales</b>\n` + (name ? `Привет, ${esc(name)}!\n\n` : '') +
    `Открой Mini App из меню бота.`;
}

export function supportTicketAdmin(opts: {
  from: string; category: string; message: string; ticketId: number;
}) {
  return `🆘 <b>Тикет #${opts.ticketId}</b>\nОт: ${esc(opts.from)}\nТема: ${esc(opts.category)}\n\n${esc(opts.message)}`;
}

function n(v: any) { return Number(v) || 0; }
function planOf(p: any, k: string) { return n(p?.[k]); }

/** Микро-строки: ключи + все ненулевые кастомные */
export async function microLines(f: any, p: any) {
  const defs = await getMetricDefs();
  const lines: { key: string; label: string; fact: number; plan: number }[] = [];
  const seen = new Set<string>();
  for (const id of MICRO_KEYS) {
    const def = defs.find((d) => d.id === id);
    if (!def) continue;
    lines.push({ key: id, label: def.label, fact: n(f[id]), plan: planOf(p, id) });
    seen.add(id);
  }
  for (const def of defs) {
    if (seen.has(def.id)) continue;
    const fact = n(f[def.id]);
    const plan = planOf(p, def.id);
    if (fact || plan) {
      lines.push({ key: def.id, label: def.label, fact, plan });
    }
  }
  return lines;
}

/** Полный итог — все метрики из каталога */
export async function finalLines(f: any, p: any) {
  const defs = await getMetricDefs();
  return defs.map((def) => ({
    key: def.id,
    label: def.label,
    fact: n(f[def.id]),
    plan: planOf(p, def.id),
    group: groupForMetric(def.id, def.label)
  }));
}
