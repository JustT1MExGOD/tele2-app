/**
 * 20.9.0 — Telegram-адаптер: единственное место, которое знает про
 * initData/X-Telegram-Id/HMAC. Всё остальное (middleware-auth.ts,
 * requireAuth/requireActive/…, роуты) видит только Identity/AuthUser и не
 * подозревает, что источник — Telegram; это и есть граница, которую 20.9.0
 * готовит под будущий Web/Mobile-provider.
 *
 * Перенесено дословно из middleware-auth.ts::resolveTelegramId — тот же
 * side-effect (request.authError на просроченной/невалидной initData),
 * та же приоритетность initData > заголовок X-Telegram-Id, то же
 * dev-условие (initData доверяем только при наличии BOT_TOKEN; голый
 * заголовок — только без BOT_TOKEN или при явном ALLOW_INSECURE_AUTH).
 */
import { FastifyRequest } from 'fastify';
import { verifyTelegramInitData } from './telegram-verify.js';
import type { Identity } from '../identity.js';

export function resolveTelegramIdentity(request: FastifyRequest): Identity | null {
  const botToken = process.env.BOT_TOKEN || '';
  const insecureDev = process.env.ALLOW_INSECURE_AUTH === 'true';
  const initData =
    (request.headers['x-telegram-init-data'] as string) ||
    (request.headers['x-telegram-initdata'] as string) ||
    '';

  if (initData && botToken) {
    const verified = verifyTelegramInitData(initData, botToken);
    if (verified.ok && verified.user?.id) {
      return { provider: 'telegram', providerId: String(verified.user.id) };
    }
    // initData присутствует, но не проходит проверку — не откатываемся
    // на голый заголовок, иначе проверка теряет смысл. reason прокидываем
    // на request, чтобы requireAuth/requireActive могли ответить понятнее
    // голого 401 — особенно для 'expired' (переоткрыть Mini App чинит это).
    request.authError = verified.reason || 'invalid';
    return null;
  }

  if (!botToken || insecureDev) {
    const raw =
      (request.headers['x-telegram-id'] as string) ||
      (request.headers['x-telegram-user-id'] as string) ||
      '';
    // Голый Number(raw) пропускал дробные ("123.456") и переполняющие
    // bigint значения ("1e+29" в экспоненциальной записи) как "валидные" —
    // они падали только позже, на ::bigint в SQL, необработанным
    // исключением (500) на любом роуте, читающем request.user. Реальные
    // Telegram id — целые положительные числа, максимум ~15 цифр с
    // огромным запасом.
    if (raw && /^\d{1,15}$/.test(raw)) return { provider: 'telegram', providerId: raw };
    return null;
  }

  return null;
}
