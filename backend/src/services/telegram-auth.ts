/**
 * Проверка подлинности Telegram WebApp initData.
 *
 * Клиент (Mini App) обязан присылать сырой tg.WebApp.initData в заголовке
 * X-Telegram-Init-Data. Мы пересчитываем HMAC по алгоритму Telegram и
 * сравниваем с присланным hash. Только так telegram_id можно доверять —
 * заголовок X-Telegram-Id сам по себе легко подделать.
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from 'crypto';

export interface TelegramInitUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface VerifiedInitData {
  ok: boolean;
  user?: TelegramInitUser;
  authDate?: number;
  reason?: string;
}

/** Максимальный возраст initData, после которого просим переоткрыть Mini App. */
const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC
): VerifiedInitData {
  if (!initData) return { ok: false, reason: 'empty' };
  if (!botToken) return { ok: false, reason: 'no_bot_token' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'unparsable' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // timing-safe compare
  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_hash' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec > 0 && authDate > 0) {
    const ageSec = Math.floor(Date.now() / 1000) - authDate;
    if (ageSec > maxAgeSec) return { ok: false, reason: 'expired' };
  }

  let user: TelegramInitUser | undefined;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      const parsed = JSON.parse(userRaw);
      if (parsed && typeof parsed.id !== 'undefined') {
        user = {
          id: Number(parsed.id),
          first_name: parsed.first_name,
          last_name: parsed.last_name,
          username: parsed.username
        };
      }
    } catch {
      return { ok: false, reason: 'bad_user_json' };
    }
  }

  if (!user?.id) return { ok: false, reason: 'no_user' };
  return { ok: true, user, authDate };
}
