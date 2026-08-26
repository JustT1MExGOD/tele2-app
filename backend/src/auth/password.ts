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
