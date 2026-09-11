/**
 * Не-Telegram вход (20.35, план) — хеширование пароля через встроенный
 * `crypto.scrypt`, не отдельная зависимость (bcrypt/argon2). Формат хранения
 * `scrypt$<salt-hex>$<hash-hex>` — версионирован на будущее (параметры
 * scrypt можно будет ужесточить, не роняя уже сохранённые хеши: verify
 * читает N/r/p из самой строки, если формат когда-нибудь расширится).
 */
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== KEY_LENGTH) return false;
  const derived = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return timingSafeEqual(derived, expected);
}

/**
 * A fixed-format, fixed-salt scrypt hash of no real password — security
 * audit hotfix. `POST /auth/login`'s short-circuit (`!e || !e.password_hash
 * || !(await verifyPassword(...))`) never ran the scrypt derivation at all
 * for an unknown phone number (short-circuits on `!e` before reaching
 * `verifyPassword`), while a known phone always paid the full scrypt cost
 * — a real, measurable timing side-channel letting an attacker distinguish
 * "this phone isn't registered" from "this phone exists, wrong password"
 * purely from response latency, without ever seeing a different status
 * code or message. `login()` in session.ts now always calls
 * `verifyPassword(plain, employee?.password_hash || DUMMY_PASSWORD_HASH)`
 * regardless of whether the account exists, so the same scrypt work
 * happens on every call — the boolean result is then additionally ANDed
 * with "the account actually exists and has a password set" before being
 * treated as a real match, so this constant never authenticates anyone.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
