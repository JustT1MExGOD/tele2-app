/**
 * Один общий FastifyInstance на весь тестовый прогон (fileParallelism:false
 * в vitest.config.ts — файлы и так последовательно, пересоздавать app под
 * каждый файл незачем). app.inject() — без реального порта/сети.
 */
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

let appPromise: Promise<FastifyInstance> | null = null;

export function getApp(): Promise<FastifyInstance> {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}

/** Заголовки авторизации для теста — ALLOW_INSECURE_AUTH=true (выставлен в
 * tests/setup.ts) заставляет authPlugin доверять голому X-Telegram-Id.
 *
 * `telegramGrantToken` (20.53.0, optional) — для privileged (admin/
 * supervisor) фикстур, которым нужно пройти requireActive()'s AAL2-гейт
 * на ОБЫЧНОМ (не step-up-gated) роуте: TestFixtures.createEmployee()
 * уже провижионит грант при auto-enrollment TOTP и возвращает его как
 * `telegramGrantToken` на фикстуре — передайте его сюда вторым
 * аргументом. Не нужен для не-privileged ролей (гейт на них не действует)
 * и для тестов через setupTotpAndStepUp() (тот сам собирает нужные
 * заголовки, включая этот cookie, для своего step-up-запроса). */
export function authAs(telegramId: number | string, telegramGrantToken?: string) {
  const headers: Record<string, string> = { 'x-telegram-id': String(telegramId) };
  if (telegramGrantToken) headers.cookie = `t2_tg_aal2=${telegramGrantToken}`;
  return headers;
}

/**
 * Не-Telegram вход (20.35) — cookie-сессия для phone-provider'а (см.
 * auth/providers/phone.ts, COOKIE_NAME='t2_session'). 20.48.0 — вместе с
 * t2_session всегда несёт САМОГО СЕБЯ же как t2_csrf + X-CSRF-Token
 * (requireCsrf, auth/csrf.ts, проверяет только header===cookie, не что
 * значение server-issued — тест волен придумать любую совпадающую пару),
 * чтобы мутирующие запросы через этот хелпер проходили CSRF по умолчанию;
 * тесты, которые специально проверяют CSRF-отказ, собирают заголовки вручную.
 */
export function authAsSession(sessionToken: string, csrfToken = 'test-csrf-token') {
  return {
    cookie: `t2_session=${sessionToken}; t2_csrf=${csrfToken}`,
    'x-csrf-token': csrfToken
  };
}

/**
 * 20.52.0 (MFA) — enrolls a confirmed TOTP factor directly (bypassing
 * the HTTP enrollment ceremony, which needs its own test coverage
 * elsewhere) and mints a step-up ticket, for tests that just need to
 * get PAST a step-up-gated route to exercise the route's own logic —
 * not re-testing MFA enrollment/step-up itself in every such test.
 *
 * 20.53.0 — Telegram-authenticated fixtures (`authAs` headers, carrying
 * `x-telegram-id`) now ALSO need a Telegram AAL2 grant before
 * requireActive() lets them reach /auth/mfa/step-up (or any other
 * privileged route) at all — browser-session fixtures (`authAsSession`
 * headers) already carry `mfa_verified_at` from session creation and
 * skip this extra round trip. Uses epoch offsets -30/0/+30 (not
 * 0/+30/+60) for confirm/grant/step-up — otplib's ±30s epochTolerance
 * only accepts codes within 30s of ACTUAL verification time (not "30s
 * relative to the LAST code"), and this whole sequence executes in a
 * few ms of real wall-clock time — the third code needs its own
 * distinct-but-still-in-window time-step, not a fourth outside it.
 */
export async function setupTotpAndStepUp(employeeId: number, authHeaders: Record<string, string>, getApp2 = getApp) {
  const { generate } = await import('otplib');
  const totp = await import('../../src/auth/mfa/totp.js');
  const enrollment = await totp.startTotpEnrollment(employeeId, `test-${employeeId}`);
  const now = Math.floor(Date.now() / 1000);
  const confirmCode = await generate({ secret: enrollment.secret, epoch: now - 30 });
  await totp.confirmTotpEnrollment(employeeId, confirmCode);

  const app = await getApp2();
  let stepUpHeaders = authHeaders;
  const extraHeaders: Record<string, string> = {};

  if ('x-telegram-id' in authHeaders) {
    const grantCode = await generate({ secret: enrollment.secret, epoch: now });
    const grantRes = await app.inject({
      method: 'POST',
      url: '/auth/mfa/telegram/verify',
      headers: authHeaders,
      payload: { method: 'totp', code: grantCode }
    });
    if (grantRes.statusCode !== 200) {
      throw new Error(`setupTotpAndStepUp: telegram grant verify failed with ${grantRes.statusCode}: ${grantRes.body}`);
    }
    // app.inject() responses carry Set-Cookie but there's no client-side
    // jar auto-attaching it to subsequent injects — forward it explicitly,
    // both for the step-up call below AND for the caller's own
    // subsequent request (returned alongside the step-up token — the
    // grant cookie satisfies BOTH requireActive()'s AAL2 check on the
    // dangerous-action route itself and assertStepUp()'s ticket-binding
    // check, see auth/step-up.ts).
    const setCookie = grantRes.cookies.find((c: any) => c.name === 't2_tg_aal2');
    if (setCookie) {
      extraHeaders.cookie = `t2_tg_aal2=${setCookie.value}`;
      stepUpHeaders = { ...authHeaders, ...extraHeaders };
    }
  }

  const stepUpCode = await generate({ secret: enrollment.secret, epoch: now + 30 });
  const res = await app.inject({
    method: 'POST',
    url: '/auth/mfa/step-up',
    headers: stepUpHeaders,
    payload: { method: 'totp', code: stepUpCode }
  });
  if (res.statusCode !== 200) {
    throw new Error(`setupTotpAndStepUp: step-up failed with ${res.statusCode}: ${res.body}`);
  }
  return { 'x-step-up-token': res.json().step_up_token as string, ...extraHeaders };
}
