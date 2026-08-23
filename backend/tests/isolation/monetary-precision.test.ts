import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

// Пункт из бизнес-корректности, который явно просили не игнорировать:
// денежные значения должны иметь предсказуемую точность и не зависеть от
// floating-point арифметики (классический 0.1 + 0.2 !== 0.3). Проверяем
// весь путь целиком: колонка в БД (numeric, не float/double precision) →
// аддитивный upsert (GREATEST(0, sales.field + EXCLUDED.field) — SQL,
// точная десятичная арифметика) → чтение обратно через JS.
describe('Точность денежных/дробных метрик (numeric, не float)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    storeA = await fx.createStore(orgA);
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('sales.accessories/insurance/credit_issued — колонки numeric, не float/double precision/real', async () => {
    const res = await query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sales'
         AND column_name IN ('accessories', 'insurance', 'credit_issued', 'wink', 'focus', 'settings', 'plotter', 'hb')`
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(['numeric', 'real', 'double precision']).toContain(row.data_type);
      expect(row.data_type).not.toBe('real');
      expect(row.data_type).not.toBe('double precision');
    }
  });

  it('накопление дробных сумм через аддитивный upsert не теряет точность (классический 0.1+0.2 не воспроизводится)', async () => {
    const app = await getApp();
    const date = '2026-06-15';

    // Три отдельных продажи с дробными суммами — ровно тот сценарий,
    // где JS-суммирование (0.1 + 0.2 !== 0.3) могло бы дать видимую ошибку,
    // если бы аддитивная запись шла через JS, а не через SQL numeric.
    for (const amount of [10.1, 20.2, 5.05]) {
      const res = await app.inject({
        method: 'POST',
        url: '/sales',
        headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
        payload: { employee_id: employeeA.id, store_id: storeA, sale_date: date, accessories: amount }
      });
      expect(res.statusCode).toBe(200);
    }

    const row = await query(
      `SELECT accessories FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [employeeA.id, storeA, date]
    );
    // 10.1 + 20.2 + 5.05 = 35.35 ровно — не 35.349999999999994 и не
    // 35.35000000000001, как дало бы IEEE 754 double при JS-суммировании.
    expect(row.rows[0].accessories).toBe('35.35');
  });
});
