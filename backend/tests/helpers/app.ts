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
 * tests/setup.ts) заставляет authPlugin доверять голому X-Telegram-Id. */
export function authAs(telegramId: number | string) {
  return { 'x-telegram-id': String(telegramId) };
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
 */
export async function setupTotpAndStepUp(employeeId: number, authHeaders: Record<string, string>, getApp2 = getApp) {
  const { generate } = await import('otplib');
  const totp = await import('../../src/auth/mfa/totp.js');
  const enrollment = await totp.startTotpEnrollment(employeeId, `test-${employeeId}`);
  const now = Math.floor(Date.now() / 1000);
  const confirmCode = await generate({ secret: enrollment.secret, epoch: now });
  await totp.confirmTotpEnrollment(employeeId, confirmCode);

  // Replay-защита (afterTimeStep) отвергла бы тот же timeStep, что уже
  // принят confirm'ом выше — код для СЛЕДУЮЩЕГО 30-секундного окна.
  const stepUpCode = await generate({ secret: enrollment.secret, epoch: now + 30 });
  const app = await getApp2();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/mfa/step-up',
    headers: authHeaders,
    payload: { method: 'totp', code: stepUpCode }
  });
  if (res.statusCode !== 200) {
    throw new Error(`setupTotpAndStepUp: step-up failed with ${res.statusCode}: ${res.body}`);
  }
  return { 'x-step-up-token': res.json().step_up_token as string };
}
