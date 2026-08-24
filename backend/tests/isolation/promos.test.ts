import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { fireConcurrent, countStatus } from '../helpers/concurrency.js';
import { query } from '../../src/data/db/index.js';

describe('Изоляция промокодов (/promos)', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let managerA: { id: number; telegramId: number };
  let managerB: { id: number; telegramId: number };
  let promoId: number;

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    managerB = await fx.createEmployee(orgB, { role: 'manager' });
  });

  afterAll(async () => {
    if (promoId) await query('DELETE FROM rtk_promocodes WHERE id = $1', [promoId]);
    await fx.cleanup();
  });

  it('POST /promos создаёт код в сети создающего', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/promos',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { code: 'TEST-CODE-17-0', note: 'isolation test' }
    });
    expect(res.statusCode).toBe(200);
    promoId = res.json().item.id;
  });

  it('GET /promos — чужая сеть не видит код', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/promos', headers: authAs(managerB.telegramId) });
    const body = res.json();
    expect(body.items.find((i: any) => i.id === promoId)).toBeUndefined();
  });

  it('GET /promos — своя сеть видит код', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/promos', headers: authAs(managerA.telegramId) });
    const body = res.json();
    expect(body.items.find((i: any) => i.id === promoId)).toBeDefined();
  });

  it('POST /promos/:id/use — чужая сеть не может забрать код (404)', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/promos/${promoId}/use`, headers: authAs(managerB.telegramId) });
    expect(res.statusCode).toBe(404);
  });

  it('POST /promos/:id/use — своя сеть может использовать код', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: `/promos/${promoId}/use`, headers: authAs(managerA.telegramId) });
    expect(res.statusCode).toBe(200);
  });

  // 20.16.0 (adversarial race-condition suite): markUsed() — реальный CAS
  // (UPDATE ... WHERE is_used=false), но до сих пор ни разу не проверен
  // настоящим конкурентным запросом — только последовательно (тест выше).
  // Промокод, использованный дважды — не абстрактный риск, а прямая потеря
  // (код реально применён у клиента дважды).
  it('race: 5 параллельных попыток забрать один код — побеждает ровно одна', async () => {
    const app = await getApp();
    const raceCreate = await app.inject({
      method: 'POST',
      url: '/promos',
      headers: { ...authAs(managerA.telegramId), 'content-type': 'application/json' },
      payload: { code: 'TEST-CODE-17-RACE', note: 'race test' }
    });
    const racePromoId = raceCreate.json().item.id;

    const results = await fireConcurrent(app, () => ({
      method: 'POST',
      url: `/promos/${racePromoId}/use`,
      headers: authAs(managerA.telegramId)
    }), 5);

    expect(countStatus(results, [200])).toBe(1);
    expect(countStatus(results, [404])).toBe(4);

    const row = await query('SELECT is_used FROM rtk_promocodes WHERE id = $1', [racePromoId]);
    expect(row.rows[0].is_used).toBe(true);
    await query('DELETE FROM rtk_promocodes WHERE id = $1', [racePromoId]);
  });
});
