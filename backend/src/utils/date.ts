/** Даты в часовом поясе Москвы */

export function todayMoscow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function currentMonthMoscow(): string {
  return todayMoscow().slice(0, 7);
}

export function monthStart(month: string): string {
  return month.length === 7 ? `${month}-01` : month.slice(0, 10);
}

export function nowTimeMoscow(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

/**
 * Нормализация любого значения из pg/JS в YYYY-MM-DD.
 * ВАЖНО: нельзя String(date).slice(0,10) — для Date это "Tue Aug 04", не дата.
 */
export function toDateISO(v: any): string {
  if (v == null || v === '') return todayMoscow();
  if (v instanceof Date && !isNaN(v.getTime())) {
    // node-postgres парсит колонку типа date в полночь ПО ЛОКАЛЬНОМУ
    // времени процесса (не UTC) — поэтому нужны локальные геттеры. С
    // getUTC*() тут был скрытый баг: на проде (Railway-контейнер в UTC)
    // локальное = UTC, поэтому не проявлялось, а на машине разработчика
    // в Europe/Moscow (UTC+3) сдвигало дату на день назад
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // уже ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // timestamp with space
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) return s.slice(0, 10);
  // fallback parse
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return todayMoscow();
}
