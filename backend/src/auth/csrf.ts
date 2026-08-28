/**
 * 20.48.0 (Web Security & Trust Layer, Auth & Session Security) — CSRF-
 * защита мутирующих browser-запросов, аутентифицированных cookie-сессией
 * (`t2_session`). Telegram-запросы (initData/заголовок, без этой cookie)
 * не затрагиваются вообще — срабатывает от НАЛИЧИЯ cookie. /auth/login,
 * /auth/register, /auth/reset/:token — явно исключены (EXEMPT_PATHS,
 * см. ниже): в браузере уже МОЖЕТ лежать старая/подставная cookie
 * (session fixation), без явного исключения честный вход падал бы в
 * CSRF-отказ раньше, чем дошёл бы до своей логики.
 *
 * Два независимых слоя:
 *   1. Sec-Fetch-Site — современные браузеры сами говорят "cross-site",
 *      отклоняем сразу, до проверки токена. Origin — тот же принцип для
 *      браузеров без Sec-Fetch-Site, сверяется с уже существующим
 *      MINI_APP_URL (канонический origin бота/Mini App), не
 *      реконструируется из Host/X-Forwarded-Host запроса.
 *   2. Double-submit cookie (t2_csrf, см. api/routes/auth/session.ts::
 *      setSessionCookie) — не httpOnly специально, фронтенд читает
 *      значение и отправляет его же заголовком X-CSRF-Token.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { COOKIE_NAME } from './providers/phone.js';

export const CSRF_COOKIE_NAME = 't2_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Логин/регистрация/сброс не полагаются на ambient cookie authority для
// авторизации самого действия (берут явные credentials в теле) — в
// отличие от исходного предположения "cookie ещё не существует до
// успешного входа", СТАРАЯ/подставная t2_session cookie может быть уже
// в браузере (session fixation, протухшая сессия после рестарта БД и
// т.п.); без явного исключения такой запрос падал бы в CSRF-отказ ДО
// того, как дошёл бы до собственной логики логина, блокируя честный вход.
const EXEMPT_PATHS = new Set(['/auth/login', '/auth/register']);
function isExemptReset(url: string): boolean {
  return /^\/auth\/reset\/[^/]+$/.test(url.split('?')[0]);
}

function expectedOrigin(): string {
  return (process.env.MINI_APP_URL || '').replace(/\/$/, '');
}

export async function requireCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.cookies?.[COOKIE_NAME]) return;
  if (SAFE_METHODS.has(request.method)) return;
  if (EXEMPT_PATHS.has(request.url.split('?')[0]) || isExemptReset(request.url)) return;

  const secFetchSite = request.headers['sec-fetch-site'] as string | undefined;
  if (secFetchSite === 'cross-site') {
    reply.code(403).send({ error: 'csrf_rejected', message: 'Межсайтовый запрос отклонён' });
    return;
  }
  if (!secFetchSite) {
    const origin = request.headers.origin as string | undefined;
    const expected = expectedOrigin();
    if (origin && expected && origin.replace(/\/$/, '') !== expected) {
      reply.code(403).send({ error: 'csrf_rejected', message: 'Межсайтовый запрос отклонён' });
      return;
    }
  }

  const headerToken = request.headers['x-csrf-token'] as string | undefined;
  const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    reply.code(403).send({ error: 'csrf_mismatch', message: 'CSRF-токен отсутствует или неверен' });
  }
}
