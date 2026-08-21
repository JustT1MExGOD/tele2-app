/**
 * Concurrency & Workflow Integrity (19.24.0) — shift_sessions уже защищена
 * partial UNIQUE INDEX (миграция 0004, эпоха 17.0), но до сих пор не было
 * ни одного теста, реально стреляющего ДВУМЯ запросами ОДНОВРЕМЕННО (только
 * последовательные сценарии). Adversarial race-condition тест на уже
 * существующую защиту — то, чего явно просил roadmap.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';

describe('POST /shifts/open — конкурентные запросы не заводят два open', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let storeId: string;
  let employee: { id: number; telegramId: number };

  beforeAll(async () => {
    orgId = await fx.createOrg('Shift Race Org');
    storeId = await fx.createStore(orgId, 'Shift Race Store');
    employee = await fx.createEmployee(orgId, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM shift_sessions WHERE employee_id = $1`, [employee.id]);
    await fx.cleanup();
  });

  it('два параллельных POST /shifts/open от одного сотрудника — ровно одна open-сессия', async () => {
    const app = await getApp();
    const headers = { ...authAs(employee.telegramId), 'content-type': 'application/json' };
    const payload = { store_id: storeId };

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/shifts/open', headers, payload }),
      app.inject({ method: 'POST', url: '/shifts/open', headers, payload })
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const openRows = await query(
      `SELECT * FROM shift_sessions WHERE employee_id = $1 AND status = 'open'`,
      [employee.id]
    );
    expect(openRows.rows.length).toBe(1);
  });
});
