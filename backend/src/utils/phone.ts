/**
 * 20.48.0 (Web Security & Trust Layer, Auth & Session Security) — строго
 * RU-профиль намеренно: проект целиком русскоязычный (Europe/Moscow),
 * международные номера вне объёма — не тянем libphonenumber ради узкой
 * задачи. Правила ЗЕРКАЛЯТ SQL-нормализацию в migrations/0020_identities.sql
 * (regexp_replace + '8XXXXXXXXXX'→'+7XXXXXXXXXX') — если один алгоритм
 * меняется, менять оба.
 */
const CANONICAL_RE = /^\+7\d{10}$/;

function stripFormatting(raw: string): string {
  return raw.replace(/[^0-9+]/g, '');
}

/** null — нераспознанный формат, не гадаем дальше. */
export function normalizePhone(raw: string): string | null {
  let s = stripFormatting(String(raw || ''));
  if (/^8\d{10}$/.test(s)) s = '+7' + s.slice(1);
  else if (/^\d{10}$/.test(s)) s = '+7' + s;
  else if (/^7\d{10}$/.test(s)) s = '+' + s;
  return CANONICAL_RE.test(s) ? s : null;
}

export function validatePhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}
