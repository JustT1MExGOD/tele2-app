/**
 * Красивые тексты бота T2 Sales
 * HTML parse_mode для Telegram
 */

const EMOJI_POOL = {
  sim: ['📱', '✨', '🟢', '📶'],
  mnp: ['🔄', '➡️', '📡', '🔀'],
  pa: ['🥇', '💎', '⭐', '👑'],
  combo: ['📦', '🎁', '🔥', '💫'],
  phones: ['📲', '☎️', '📳', '📞'],
  accessories: ['🎧', '⌚', '🔌', '🛡️'],
  insurance: ['🛡️', '✅', '📋', '🔒'],
  wink: ['📺', '🎬', '▶️', '🎞️'],
  shpd: ['🌐', '🚀', '📡', '💻'],
  focus: ['🎯', '📌', '⚡', '🔍'],
  plotter: ['🖨️', '🖼️', '✂️'],
  hb: ['❤️', '💗', '💝'],
  default: ['✅', '🎉', '💪', '🌟']
};

const METRIC_LABEL: Record<string, string> = {
  sim: 'SIM',
  mnp: 'MNP',
  pa: 'ПА / Золото',
  combo: 'Комбо',
  phones: 'Телефон',
  accessories: 'Аксессуары',
  insurance: 'Страховки',
  wink: 'Wink',
  shpd: 'ШПД',
  focus: 'ФО',
  plotter: 'Плоттер',
  hb: 'HB',
  settings: 'Настройки',
  credit_request: 'Кредит (заявка)',
  credit_issued: 'Кредит (выдан)'
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

export function saleNotification(opts: {
  employeeName: string;
  storeName: string;
  metric: string;
  value: number | string;
}) {
  const metric = opts.metric;
  const pool = EMOJI_POOL[metric as keyof typeof EMOJI_POOL] || EMOJI_POOL.default;
  const emoji = pick(pool);
  const label = METRIC_LABEL[metric] || metric;
  const styles = [
    () =>
      `${emoji} <b>${esc(opts.employeeName)}</b>\n` +
      `<b>+${esc(opts.value)}</b> ${esc(label)}\n` +
      `📍 ${esc(opts.storeName)}`,
    () =>
      `━━━━━━━━━━━━━━\n` +
      `${emoji}  <b>Продажа</b>\n` +
      `👤 ${esc(opts.employeeName)}\n` +
      `📦 ${esc(label)}: <b>${esc(opts.value)}</b>\n` +
      `🏪 ${esc(opts.storeName)}\n` +
      `━━━━━━━━━━━━━━`,
    () =>
      `${emoji} ${esc(opts.employeeName)} закрыл <b>${esc(opts.value)} ${esc(label)}</b>\n` +
      `на точке <i>${esc(opts.storeName)}</i>`,
    () =>
      `🎯 <b>${esc(label)}</b> × ${esc(opts.value)}\n` +
      `${esc(opts.employeeName)} · ${esc(opts.storeName)} ${emoji}`
  ];
  return pick(styles)();
}

export function microReport(opts: {
  storeName: string;
  storeCode: string;
  date: string;
  staff: string[];
  lines: { label: string; fact: number; plan: number }[];
}) {
  const staffBlock = opts.staff.length
    ? opts.staff.map((n) => `  • ${esc(n)}`).join('\n')
    : '  • нет на смене';

  const metrics = opts.lines
    .map((l) => {
      const pct = l.plan > 0 ? Math.round((l.fact / l.plan) * 100) : 0;
      const bar = progressBar(pct);
      return `${esc(l.label)}  <b>${l.fact}</b>/<b>${l.plan}</b>  ${bar} ${pct}%`;
    })
    .join('\n');

  return (
    `📊 <b>Промежуточный отчёт</b>\n` +
    `🏪 <b>${esc(opts.storeName)}</b> · <code>${esc(opts.storeCode)}</code>\n` +
    `📅 ${esc(opts.date)}\n\n` +
    `<b>Смена</b>\n${staffBlock}\n\n` +
    `<b>Факт / план</b>\n${metrics}`
  );
}

export function finalReport(opts: {
  storeName: string;
  storeCode: string;
  date: string;
  staff: string[];
  lines: { label: string; fact: number; plan: number }[];
}) {
  const staffBlock = opts.staff.length
    ? opts.staff.map((n) => `  • ${esc(n)}`).join('\n')
    : '  • —';

  const metrics = opts.lines
    .map((l) => {
      const pct = l.plan > 0 ? Math.round((l.fact / l.plan) * 100) : 0;
      const mark = pct >= 100 ? '✅' : pct >= 70 ? '🟡' : '🔴';
      return `${mark} ${esc(l.label)}  <b>${l.fact}</b> / ${l.plan}  (${pct}%)`;
    })
    .join('\n');

  return (
    `🏁 <b>Итоговый отчёт</b>\n` +
    `🏪 <b>${esc(opts.storeName)}</b>\n` +
    `<code>${esc(opts.storeCode)}</code> · ${esc(opts.date)}\n\n` +
    `<b>Команда дня</b>\n${staffBlock}\n\n` +
    `${metrics}\n\n` +
    `<i>T2 Sales · конец смены</i>`
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
    `⏰ <b>Напоминание о смене</b>\n\n` +
    `Привет, <b>${esc(opts.employeeName)}</b>!\n` +
    `Завтра (${esc(opts.dateLabel)}) у тебя смена:\n\n` +
    `📍 <b>${esc(opts.storeName)}</b>\n` +
    `🕐 ${esc(opts.shiftText)} · ${opts.hours}ч\n\n` +
    `Удачного дня 💪\n` +
    `<i>T2 Sales</i>`
  );
}

export function privateWelcome(name?: string) {
  const who = name ? `, ${esc(name)}` : '';
  return (
    `🍉 <b>T2 Sales</b>\n\n` +
    `Привет${who}!\n` +
    `Здесь продажи, план, график и BFQ — всё в одном месте.\n\n` +
    `Открой приложение кнопкой ниже 👇`
  );
}

export function supportTicketAdmin(opts: {
  from: string;
  category: string;
  message: string;
  ticketId: number;
}) {
  return (
    `🆘 <b>Поддержка #${opts.ticketId}</b>\n` +
    `От: ${esc(opts.from)}\n` +
    `Тема: ${esc(opts.category)}\n\n` +
    `${esc(opts.message)}`
  );
}

function progressBar(pct: number) {
  const n = Math.min(10, Math.max(0, Math.round(pct / 10)));
  return '▓'.repeat(n) + '░'.repeat(10 - n);
}

export { METRIC_LABEL };

/** Несколько метрик в одном уведомлении */
export function saleNotificationMulti(opts: {
  employeeName: string;
  storeName: string;
  items: { metric: string; value: number | string }[];
}) {
  if (!opts.items.length) return saleNotification({
    employeeName: opts.employeeName,
    storeName: opts.storeName,
    metric: 'sim',
    value: 0
  });
  if (opts.items.length === 1) {
    return saleNotification({
      employeeName: opts.employeeName,
      storeName: opts.storeName,
      metric: opts.items[0].metric,
      value: opts.items[0].value
    });
  }
  const lines = opts.items
    .map((it) => {
      const label = METRIC_LABEL[it.metric] || it.metric;
      const pool = EMOJI_POOL[it.metric as keyof typeof EMOJI_POOL] || EMOJI_POOL.default;
      return `  ${pick(pool)} <b>+${esc(it.value)}</b> ${esc(label)}`;
    })
    .join('\n');
  return (
    `✨ <b>Продажа</b>\n` +
    `👤 ${esc(opts.employeeName)}\n` +
    `📍 ${esc(opts.storeName)}\n` +
    `${lines}`
  );
}
