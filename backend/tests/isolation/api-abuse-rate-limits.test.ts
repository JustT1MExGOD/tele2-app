/**
 * 20.50.0 (Web Security & Trust Layer, часть 3, API Abuse Protection) —
 * показательные тесты на новые per-route лимиты (не все 16 роутов по
 * отдельности — механизм @fastify/rate-limit уже покрыт существующими
 * тестами на других роутах, эти два — самые ценные находки прохода:
 * AI-роут без лимита вообще, и единственный реально неограниченный export.
 */
import { describe, it, expect } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('Новые rate-limit на дорогих роутах (API Abuse Protection)', () => {
  it('GET /forecast/:storeId — лимит 20/мин, 21-й запрос 429', async () => {
    const app = await getApp();
    const fx = new TestFixtures();
    try {
      const org = await fx.createOrg('Rate Limit Forecast Org');
      const store = await fx.createStore(org);
      const manager = await fx.createEmployee(org, { role: 'manager' });

      let last;
      for (let i = 0; i < 21; i++) {
        last = await app.inject({ method: 'GET', url: `/forecast/${store}`, headers: authAs(manager.telegramId) });
      }
      expect(last!.statusCode).toBe(429);
    } finally {
      await fx.cleanup();
    }
  });

  it('GET /export/sales.csv — лимит 10/мин, 11-й запрос 429', async () => {
    const app = await getApp();
    const fx = new TestFixtures();
    try {
      const org = await fx.createOrg('Rate Limit Export Org');
      const manager = await fx.createEmployee(org, { role: 'manager' });

      let last;
      for (let i = 0; i < 11; i++) {
        last = await app.inject({
          method: 'GET',
          url: '/export/sales.csv?from=2026-06-01&to=2026-06-19',
          headers: authAs(manager.telegramId)
        });
      }
      expect(last!.statusCode).toBe(429);
    } finally {
      await fx.cleanup();
    }
  });
});
