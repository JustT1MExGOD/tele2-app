/**
 * Concurrency & Workflow Integrity (19.24.0) — materializeStoreDailyPlans()
 * раньше делала DELETE FROM store_plans WHERE plan_date=$1, затем голые
 * INSERT в цикле без ON CONFLICT и без UNIQUE(store_id, plan_date) —
 * конкурентный вызов (крон + правка плана одновременно) мог оставить
 * дубликаты строк. Теперь per-store UPSERT (миграция 0013).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query } from '../../src/db/index.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { materializeStoreDailyPlans } from '../../src/services/plans.js';

describe('materializeStoreDailyPlans — конкурентные вызовы не дублируют строки', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let storeId: string;
  const WORK_DATE = '2026-09-01';

  beforeAll(async () => {
    orgId = await fx.createOrg('Materialize Race Org');
    storeId = await fx.createStore(orgId, 'Materialize Race Store');
    await query(
      `INSERT INTO store_month_plans (store_id, month, sim, mnp, pa, combo)
       VALUES ($1, $2::date, 100, 50, 30, 20)`,
      [storeId, WORK_DATE.slice(0, 8) + '01']
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM store_plans WHERE store_id = $1`, [storeId]);
    await query(`DELETE FROM store_month_plans WHERE store_id = $1`, [storeId]);
    await fx.cleanup();
  });

  it('два параллельных вызова на одну дату оставляют ровно одну строку', async () => {
    await Promise.all([
      materializeStoreDailyPlans(WORK_DATE),
      materializeStoreDailyPlans(WORK_DATE)
    ]);

    const rows = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date = $2::date`,
      [storeId, WORK_DATE]
    );
    expect(rows.rows.length).toBe(1);
  });

  it('повторный вызов на ту же дату не создаёт вторую строку (upsert, не insert)', async () => {
    await materializeStoreDailyPlans(WORK_DATE);
    await materializeStoreDailyPlans(WORK_DATE);

    const rows = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date = $2::date`,
      [storeId, WORK_DATE]
    );
    expect(rows.rows.length).toBe(1);
  });
});
