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
