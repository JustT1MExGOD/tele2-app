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
