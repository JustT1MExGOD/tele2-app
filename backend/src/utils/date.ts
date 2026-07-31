/** Сегодняшняя дата в Europe/Moscow, формат YYYY-MM-DD */
export function todayMoscow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA → YYYY-MM-DD
}

/** Текущее время HH:mm в Москве */
export function nowTimeMoscow(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()); // HH:mm
}