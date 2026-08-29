/**
 * 20.50.0 (Web Security & Trust Layer, часть 3, API Abuse Protection) —
 * во время аудита один из research-агентов сообщил, что двойной сабмит
 * POST /stores (тот же id дважды) даёт необработанный 500. Перепроверено
 * чтением app.ts напрямую — глобальный setErrorHandler уже мапит Postgres
 * 23505 в чистый 409 {error:'conflict'} для ЛЮБОГО роута; store.id —
 * primary key, коллизия уже ловится этим существующим механизмом.
 * Ложная находка агента — фикс не потребовался, этот тест фиксирует уже
 * корректное поведение, чтобы вопрос не переоткрывался позже.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('POST /stores — двойной сабмит одного id', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('повторный POST /stores с тем же id — чистый 409, не 500', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Store Idempotency Org');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const payload = { id: `dup_store_${Date.now()}`, name: 'Duplicate Store' };

    const first = await app.inject({
      method: 'POST',
      url: '/stores',
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(first.statusCode).toBe(200);
    fx.storeIds.push(first.json().id);

    const second = await app.inject({
      method: 'POST',
      url: '/stores',
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('conflict');
  });
});
