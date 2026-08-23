/**
 * Concurrency & Workflow Integrity (19.24.0) — claimIdempotencyKey()
 * (services/sales-write.ts) + UNIQUE(client_id) на offline_sync_log уже
 * защищают POST /sales от двойного тапа, но не было теста, реально
 * стреляющего ДВУМЯ одновременными запросами с одним client_id — только
 * последовательные "отправили, потом повторили".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('POST /sales — конкурентные запросы с одним client_id применяются один раз', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let storeId: string;
  let employee: { id: number; telegramId: number };

  beforeAll(async () => {
    orgId = await fx.createOrg('Sales Race Org');
    storeId = await fx.createStore(orgId, 'Sales Race Store');
    employee = await fx.createEmployee(orgId, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM offline_sync_log WHERE employee_id = $1`, [employee.id]);
    await query(`DELETE FROM sales_events WHERE employee_id = $1`, [employee.id]);
    await fx.cleanup();
  });

  it('два параллельных POST /sales с одним client_id — метрика применяется ровно один раз', async () => {
    const app = await getApp();
    const headers = { ...authAs(employee.telegramId), 'content-type': 'application/json' };
    const clientId = `race_test_${Date.now()}`;
    const payload = { employee_id: employee.id, store_id: storeId, sim: 5, client_id: clientId };

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/sales', headers, payload }),
      app.inject({ method: 'POST', url: '/sales', headers, payload })
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const row = await query(
      `SELECT sim FROM sales WHERE employee_id = $1 AND store_id = $2`,
      [employee.id, storeId]
    );
    expect(Number(row.rows[0].sim)).toBe(5);
  });
});
