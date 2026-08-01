/**
 * T2 Sales — премиум-тексты бота (HTML parse_mode)
 */

const EMOJI_POOL: Record<string, string[]> = {
  sim: ['📱', '✨', '📶', '🟢'],
  mnp: ['🔄', '📡', '➡️', '🔀'],
  pa: ['🥇', '💎', '⭐', '👑'],
  combo: ['📦', '🎁', '🔥', '💫'],
  phones: ['📲', '📳', '📞'],
  accessories: ['🎧', '⌚', '🔌', '🛡️'],
  insurance: ['🛡️', '✅', '🔒'],
  wink: ['📺', '🎬', '▶️'],
  shpd: ['🌐', '🚀', '💻'],
  focus: ['🎯', '⚡', '📌'],
  settings: ['⚙️', '🛠️'],
  plotter: ['🖨️', '🖼️'],
  hb: ['❤️', '💗', '💝'],
  credit_request: ['📝', '💳'],
  credit_issued: ['💸', '✅'],
  default: ['✨', '🎉', '💪', '🌟']
};

const METRIC_LABEL: Record<string, string> = {
  sim: 'SIM',
  mnp: 'MNP',
  pa: 'ПА / Золото',
  combo: 'Комбо',
  phones: 'Смартфоны',
  accessories: 'Аксессуары',
  insurance: 'Страховки',
  wink: 'WINK',
  shpd: 'ШПД',
  focus: 'Фокусное об-ние',
  settings: 'Настройки',
  plotter: 'Плоттер',
  hb: 'HB',
  credit_request: 'Кредит · заявка',
  credit_issued: 'Кредит · выдан'
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  if (Math.abs(n) >= 1000) return n.toLocaleString('ru-RU');
  return String(n);
}

function lineRow(label: string, fact: number, plan: number) {
  const pct = pctOf(fact, plan);
  return `${statusMark(pct)} <b>${esc(label)}</b>\n<code>${bar(pct)}</code>  <b>${fmtNum(fact)}</b> / ${fmtNum(plan)} · ${pct}%`;
}

export function saleNotification(opts: {
  employeeName: string;
  storeName: string;
  metric: string;
  value: number | string;
}) {
  const metric = opts.metric;
  const emoji = pick(EMOJI_POOL[metric] || EMOJI_POOL.default);
  const label = METRIC_LABEL[metric] || metric;
  const val = opts.value;

  const variants = [
    () =>
      `${emoji} <b>ПРОДАЖА</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `👤 <b>${esc(opts.employeeName)}</b>\n` +
      `📍 ${esc(opts.storeName)}\n\n` +
      `${emoji}  <b>+${esc(val)}</b>  ${esc(label)}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<i>T2 Sales</i>`,
    () =>
      `┏━━━━━━━━━━━━━━┓\n` +
      `┃  ${emoji}  <b>+${esc(val)} ${esc(label)}</b>\n` +
      `┗━━━━━━━━━━━━━━┛\n\n` +
      `👤 ${esc(opts.employeeName)}\n` +
      `🏪 ${esc(opts.storeName)}\n\n` +
      `<i>зафиксировано · T2</i>`,
    () =>
      `✦ <b>${esc(label)}</b> × <b>${esc(val)}</b>\n` +
      `───\n` +
      `${esc(opts.employeeName)}\n` +
      `${esc(opts.storeName)} ${emoji}`
  ];
  return pick(variants)();
}

export function saleNotificationMulti(opts: {
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

  const rows = opts.items
    .map((it) => {
      const emoji = pick(EMOJI_POOL[it.metric] || EMOJI_POOL.default);
      const label = METRIC_LABEL[it.metric] || it.metric;
      return `${emoji}  <b>+${esc(it.value)}</b>  ${esc(label)}`;
    })
    .join('\n');

  return (
    `✨ <b>ПАКЕТ ПРОДАЖ</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👤 <b>${esc(opts.employeeName)}</b>\n` +
    `📍 ${esc(opts.storeName)}\n\n` +
    `${rows}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<i>T2 Sales · ${opts.items.length} метрик</i>`
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

  let totalFact = 0;
  let totalPlan = 0;
  for (const l of opts.lines) {
    if (['SIM', 'MNP', 'ПА', 'Комбо'].includes(l.label) || l.key === 'sim') {
      totalFact += Number(l.fact) || 0;
      totalPlan += Number(l.plan) || 0;
    }
  }
  if (totalPlan === 0) {
    for (const l of opts.lines) {
      totalFact += Number(l.fact) || 0;
      totalPlan += Number(l.plan) || 0;
    }
  }
  const totalPct = pctOf(totalFact, totalPlan);

  return (
    `📊 <b>ПРОМЕЖУТОЧНЫЙ ОТЧЁТ</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 <b>${esc(opts.storeName)}</b>\n` +
    `🏷 <code>${esc(opts.storeCode)}</code>\n` +
    `🕐 ${esc(opts.date)}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>👥 Смена</b>\n${staffBlock}\n\n` +
    `<b>📈 Факт / план</b>\n\n${metrics}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Итого (ключ): <b>${totalPct}%</b>  <code>${bar(totalPct, 12)}</code>\n` +
    `<i>T2 Sales · live</i>`
  );
}

export function finalReport(opts: {
  storeName: string;
  storeCode: string;
  date: string;
  staff: string[];
  lines: { label: string; fact: number; plan: number; group?: string }[];
}) {
  const staffBlock = opts.staff.length
    ? opts.staff.map((n) => `  · ${esc(n)}`).join('\n')
    : '  · —';

  const groups: Record<string, { label: string; fact: number; plan: number }[]> = {
    gi: [], top: [], rt: [], credit: [], other: []
  };

  for (const l of opts.lines) {
    const L = l.label.toLowerCase();
    const row = { label: l.label, fact: Number(l.fact) || 0, plan: Number(l.plan) || 0 };
    if (['sim', 'сим', 'mnp', 'па', 'золот', 'абик'].some((x) => L.includes(x))) groups.gi.push(row);
    else if (['комбо', 'combo', 'настрой', 'акс', 'страх', 'смарт', 'телефон'].some((x) => L.includes(x))) groups.top.push(row);
    else if (['wink', 'винк', 'шпд', 'фокус'].some((x) => L.includes(x))) groups.rt.push(row);
    else if (L.includes('кредит') || L.includes('credit')) groups.credit.push(row);
    else groups.other.push(row);
  }

  const block = (title: string, rows: { label: string; fact: number; plan: number }[]) => {
    if (!rows.length) return '';
    const body = rows.map((r) => lineRow(r.label, r.fact, r.plan)).join('\n\n');
    return `\n${title}\n${'─'.repeat(16)}\n${body}\n`;
  };

  const metricsBlock =
    block('💎 <b>Блок GI</b>', groups.gi) +
    block('📦 <b>Топ-ап и товарка</b>', groups.top) +
    block('📺 <b>Ростелеком</b>', groups.rt) +
    block('💳 <b>Кредиты</b>', groups.credit) +
    block('✨ <b>Прочее</b>', groups.other);

  return (
    `🏁 <b>ИТОГОВЫЙ ОТЧЁТ</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 ${esc(opts.date)}\n` +
    `🏪 <b>${esc(opts.storeName)}</b>\n` +
    `🏷 <code>${esc(opts.storeCode)}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>👥 Команда дня</b>\n${staffBlock}\n` +
    `${metricsBlock}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>T2 Sales · конец дня</i>`
  );
}

export function shiftReminder(opts: {
  employeeName: string;
  storeName: string;
  shiftText: string;
  hours: number;
  dateLabel: string;
}) {
  return (
    `⏰ <b>СМЕНА ЗАВТРА</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Привет, <b>${esc(opts.employeeName)}</b>\n\n` +
    `📍 <b>${esc(opts.storeName)}</b>\n` +
    `🕐 ${esc(opts.shiftText)} · ${opts.hours}ч\n` +
    `📅 ${esc(opts.dateLabel)}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Удачной смены ✨\n` +
    `<i>T2 Sales</i>`
  );
}

export function privateWelcome(name?: string) {
  const who = name ? `, ${esc(name)}` : '';
  return (
    `🍉 <b>T2 Sales</b>\n\n` +
    `Привет${who}!\n` +
    `Продажи, план, график и BFQ — в одном приложении.\n\n` +
    `Открой Mini App кнопкой ниже 👇`
  );
}

export function supportTicketAdmin(opts: {
  from: string;
  category: string;
  message: string;
  ticketId: number;
}) {
  return (
    `🆘 <b>Тикет #${opts.ticketId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `От: <b>${esc(opts.from)}</b>\n` +
    `Тема: ${esc(opts.category)}\n\n` +
    `${esc(opts.message)}\n` +
    `━━━━━━━━━━━━━━━━`
  );
}
