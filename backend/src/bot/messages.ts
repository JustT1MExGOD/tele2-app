/**
 * Тексты отчётов T2 Sales (HTML для Telegram)
 * Единый формат: микро + итог + продажи
 */
const EMOJI_POOL: Record<string, string[]> = {
  sim: ['📱', '✨', '🔷'],
  mnp: ['🔄', '📡', '♻️'],
  pa: ['🥇', '💛', '⭐'],
  combo: ['📦', '🎁', '🧩'],
  phones: ['📱', '💥', '🛍️'],
  accessories: ['🎧', '⌚', '🔌'],
  settings: ['⚙️', '🛠️', '🔧'],
  insurance: ['🛡️', '📋', '✅'],
  wink: ['📺', '🎬', '▶️'],
  shpd: ['🌐', '📶', '🏠'],
  focus: ['🎯', '🔥', '📌'],
  credit_request: ['💳', '📝', '✍️'],
  credit_issued: ['💰', '💵', '✅'],
  plotter: ['🖨️', '📐', '✂️'],
  hb: ['❤️', '💖', '♥️'],
  default: ['✨', '⚡', '🌟']
};

const METRIC_LABEL: Record<string, string> = {
  sim: 'SIM',
  mnp: 'MNP',
  pa: 'ПА / золото',
  combo: 'Комбо',
  phones: 'Смартфоны',
  accessories: 'Аксессуары',
  settings: 'Настройки',
  insurance: 'Страховки',
  wink: 'WINK',
  shpd: 'Заявка ШПД',
  focus: 'Фокусное об-ние',
  credit_request: 'Кредит · заявка',
  credit_issued: 'Кредит · выдан',
  plotter: 'Плоттер',
  hb: 'HB'
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
  if (Math.abs(n) >= 1000) return Number(n).toLocaleString('ru-RU');
  return String(n);
}

/** Одна строка метрики — общий стиль для микро и итога */
export function lineRow(label: string, fact: number, plan: number) {
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
  return (
    `${emoji} <b>ПРОДАЖА</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👤 <b>${esc(opts.employeeName)}</b>\n` +
    `📍 ${esc(opts.storeName)}\n\n` +
    `${emoji}  <b>+${esc(opts.value)}</b>  ${esc(label)}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<i>T2 Sales</i>`
  );
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
    `✨ <b>ПРОДАЖИ</b>\n` +
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
    const key = (l.key || l.label).toLowerCase();
    if (['sim', 'mnp', 'pa', 'па', 'комбо', 'combo'].some((x) => key.includes(x) || l.label.includes(x))) {
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
    gi: [],
    top: [],
    rt: [],
    credit: [],
    other: []
  };

  for (const l of opts.lines) {
    const L = l.label.toLowerCase();
    const row = { label: l.label, fact: Number(l.fact) || 0, plan: Number(l.plan) || 0 };
    if (l.group === 'gi' || ['sim', 'сим', 'mnp', 'па', 'золот', 'абик'].some((x) => L.includes(x)))
      groups.gi.push(row);
    else if (
      l.group === 'top' ||
      ['комбо', 'combo', 'настрой', 'акс', 'страх', 'смарт', 'телефон'].some((x) => L.includes(x))
    )
      groups.top.push(row);
    else if (l.group === 'rt' || ['wink', 'винк', 'шпд', 'фокус'].some((x) => L.includes(x)))
      groups.rt.push(row);
    else if (l.group === 'credit' || L.includes('кредит') || L.includes('credit'))
      groups.credit.push(row);
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
  return (
    `👋 <b>T2 Sales</b>\n` +
    (name ? `Привет, ${esc(name)}!\n\n` : '') +
    `Открой Mini App из меню бота — продажи, график, план.`
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
    `От: ${esc(opts.from)}\n` +
    `Тема: ${esc(opts.category)}\n\n` +
    `${esc(opts.message)}`
  );
}

/** Единый список метрик для микро (короче) */
export function microLines(f: any, p: any) {
  const n = (v: any) => Number(v) || 0;
  const planOf = (obj: any, k: string) => n(obj?.[k]);
  return [
    { key: 'sim', label: 'SIM', fact: n(f.sim), plan: planOf(p, 'sim') },
    { key: 'mnp', label: 'MNP', fact: n(f.mnp), plan: planOf(p, 'mnp') },
    { key: 'pa', label: 'ПА', fact: n(f.pa), plan: planOf(p, 'pa') },
    { key: 'combo', label: 'Комбо', fact: n(f.combo), plan: planOf(p, 'combo') },
    { key: 'phones', label: 'Телефоны', fact: n(f.phones), plan: planOf(p, 'phones') },
    { key: 'accessories', label: 'Аксы', fact: n(f.accessories), plan: planOf(p, 'accessories') },
    { key: 'wink', label: 'Wink', fact: n(f.wink), plan: planOf(p, 'wink') },
    { key: 'shpd', label: 'ШПД', fact: n(f.shpd), plan: planOf(p, 'shpd') }
  ];
}

/** Полный список для итога — как в чате */
export function finalLines(f: any, p: any) {
  const n = (v: any) => Number(v) || 0;
  const planOf = (obj: any, k: string) => n(obj?.[k]);
  return [
    { group: 'gi', label: 'Симкарты', fact: n(f.sim), plan: planOf(p, 'sim') },
    { group: 'gi', label: 'MNP', fact: n(f.mnp), plan: planOf(p, 'mnp') },
    { group: 'gi', label: 'Абики / золото', fact: n(f.pa), plan: planOf(p, 'pa') },
    { group: 'top', label: 'Комбо', fact: n(f.combo), plan: planOf(p, 'combo') },
    { group: 'top', label: 'Настройки', fact: n(f.settings), plan: planOf(p, 'settings') },
    { group: 'top', label: 'Аксессуары', fact: n(f.accessories), plan: planOf(p, 'accessories') },
    { group: 'top', label: 'Страховки', fact: n(f.insurance), plan: planOf(p, 'insurance') },
    { group: 'top', label: 'Смартфоны', fact: n(f.phones), plan: planOf(p, 'phones') },
    { group: 'rt', label: 'WINK', fact: n(f.wink), plan: planOf(p, 'wink') },
    { group: 'rt', label: 'Заявка ШПД', fact: n(f.shpd), plan: planOf(p, 'shpd') },
    { group: 'rt', label: 'Фокусное об-ние', fact: n(f.focus), plan: planOf(p, 'focus') },
    { group: 'credit', label: 'Кредит · заявка', fact: n(f.credit_request), plan: planOf(p, 'credit_request') },
    { group: 'credit', label: 'Кредит · выдан', fact: n(f.credit_issued), plan: planOf(p, 'credit_issued') },
    { group: 'other', label: 'Плоттер', fact: n(f.plotter), plan: planOf(p, 'plotter') },
    { group: 'other', label: 'HB', fact: n(f.hb), plan: planOf(p, 'hb') }
  ];
}
