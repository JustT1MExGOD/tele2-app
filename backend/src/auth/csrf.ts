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
import { generateToken } from '../data/repositories/sessions.js';

export const CSRF_COOKIE_NAME = 't2_csrf';
const isProd = () => process.env.RAILWAY_ENVIRONMENT === 'production';

/**
 * 20.48.1 — вынесено из session.ts::setSessionCookie(), чтобы использовать
 * ещё и для backfill'а (me/index.ts::GET /me): сотрудники, залогиненные
 * ДО 20.48.0, несут валидную t2_session, но никогда не получали t2_csrf
 * (она ставится только в момент логина) — без backfill'а «Выйти»/
 * «Завершить сессию» у них падает в csrf_mismatch до следующего релогина.
 */
export function setCsrfCookie(reply: FastifyReply): void {
  reply.setCookie(CSRF_COOKIE_NAME, generateToken(), {
    httpOnly: false,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60
  });
}
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Логин/регистрация/сброс не полагаются на ambient cookie authority для
// авторизации самого действия (берут явные credentials в теле) — в
// отличие от исходного предположения "cookie ещё не существует до
// успешного входа", СТАРАЯ/подставная t2_session cookie может быть уже
// в браузере (session fixation, протухшая сессия после рестарта БД и
// т.п.); без явного исключения такой запрос падал бы в CSRF-отказ ДО
// того, как дошёл бы до собственной логики логина, блокируя честный вход.
//
// 20.57.6 (Desktop MFA release-gate finding): /auth/login/mfa и
// /auth/login/mfa/webauthn/options — тот же случай, пропущенный при
// введении MFA-шага логина (20.52.1). Сессионная cookie на этом этапе
// ещё НЕ выставлена (setSessionCookie вызывается только при успехе
// внутри самого /auth/login/mfa), поэтому t2_csrf никогда не существует
// в момент этого запроса — но если в браузере/Electron-профиле уже
// лежит СТАРАЯ t2_session (протухшая сессия, предыдущий вход на этом же
// устройстве — на Desktop это особенно вероятно из-за постоянного
// persist:t2-sales профиля, переживающего перезапуск приложения), gate
// на строке ниже (`if (!request.cookies?.[COOKIE_NAME]) return`) НЕ
// срабатывает как no-op, и запрос без t2_csrf падает в 403
// csrf_mismatch ДО проверки самого MFA-кода — валидный код введён, но
// вход не завершается. Оба MFA-login эндпоинта сами несут одноразовый
// mfa_token как явный credential (см. комментарий выше про /auth/login),
// то же обоснование применимо один в один.
const EXEMPT_PATHS = new Set(['/auth/login', '/auth/register', '/auth/login/mfa', '/auth/login/mfa/webauthn/options']);
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
