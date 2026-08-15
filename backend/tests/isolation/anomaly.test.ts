import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';
import { checkAnomalyVsForecast } from '../../src/services/anomaly.js';

// 19.2 Anomaly Detection — единственный smart_alerts-триггер, сравнивающий
// вчерашний факт со СТАТИСТИЧЕСКИ ТИПИЧНЫМ для этого дня недели (через
// forecast-модель), а не с планом/фиксированным порогом, как остальные
// три триггера (services/alerts.ts). Проверяем обе стороны (провал и
// всплеск), гейт на нехватку истории и дедуп.
describe('checkAnomalyVsForecast', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeDip: string, storeSpike: string, storeStable: string, storeFewSamples: string;
  let employeeA: { id: number; telegramId: number };

  const yesterday = new Date(todayMoscow() + 'T12:00:00');
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  /** Плотная, реалистичная 120-дневная история без единого пропуска:
   * будни ~baseline, целевой день недели (тот же, что у yesterday)
   * чуть выше — лёгкая, но настоящая недельная сезонность вместо
   * искусственных длинных серий нулей (те гасят сглаженный уровень между
   * редкими наблюдениями и ломают модель непредсказуемым образом — так и
   * было в первой версии этого теста, до этой правки). weekdayRealDays
   * ограничивает, на сколько последних недель реально пишем целевой
   * день — остальные дни недели всегда полные (для сценария «мало
   * наблюдений»: baseline остаётся плотным, только целевой день редкий). */
  function seedDenseHistory(storeId: string, baseline: number, weekdayValue: number, weekdayRealWeeks: number) {
    const targetDow = yesterday.getDay();
    const rows: Promise<any>[] = [];
    for (let i = 1; i <= 120; i++) {
      const d = new Date(yesterday);
      d.setDate(d.getDate() - i);
      const dow = d.getDay();
      if (dow === targetDow) {
        if (i / 7 > weekdayRealWeeks) continue; // старше окна реальных недель — оставляем пропуском
        rows.push(query(
          `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
          [employeeA.id, storeId, d.toISOString().slice(0, 10), weekdayValue]
        ));
      } else {
        rows.push(query(
          `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
          [employeeA.id, storeId, d.toISOString().slice(0, 10), baseline]
        ));
      }
    }
    return Promise.all(rows);
  }

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    storeDip = await fx.createStore(orgA, 'Store Dip');
    storeSpike = await fx.createStore(orgA, 'Store Spike');
    storeStable = await fx.createStore(orgA, 'Store Stable');
    storeFewSamples = await fx.createStore(orgA, 'Store Few Samples');
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });

    for (const [storeId, todayValue, weekdayRealWeeks] of [
      [storeDip, 0, 18],
      [storeSpike, 200, 18],
      [storeStable, 21, 18],
      [storeFewSamples, 0, 2] // мало реальных наблюдений ИМЕННО по целевому дню недели — гейт должен молчать
    ] as [string, number, number][]) {
      await seedDenseHistory(storeId, 10, 20, weekdayRealWeeks);
      await query(
        `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
        [employeeA.id, storeId, yesterdayStr, todayValue]
      );
    }
  });

  afterAll(async () => {
    await query(`DELETE FROM smart_alerts WHERE store_id = ANY($1)`, [
      [storeDip, storeSpike, storeStable, storeFewSamples]
    ]);
    await fx.cleanup();
  });

  it('провальный день (факт ~0 против типичных 20) создаёт anomaly_vs_forecast с отрицательным z', async () => {
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeDip]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].payload.z).toBeLessThan(-2);
    expect(res.rows[0].title).toContain('тихий');
  });

  it('всплеск (факт 200 против типичных 20) создаёт anomaly_vs_forecast с положительным z и severity warn', async () => {
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeSpike]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].payload.z).toBeGreaterThan(2);
    expect(res.rows[0].severity).toBe('warn');
    expect(res.rows[0].title).toContain('всплеск');
  });

  it('факт близко к типичному — алерт не создаётся', async () => {
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeStable]
    );
    expect(res.rows.length).toBe(0);
  });

  it('мало реальных наблюдений по этому дню недели (< 4) — алерт не создаётся, даже при провале до 0', async () => {
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeFewSamples]
    );
    expect(res.rows.length).toBe(0);
  });

  it('повторный вызов не создаёт вторую запись на ту же точку/дату (дедуп по alert_date)', async () => {
    await checkAnomalyVsForecast();
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeDip]
    );
    expect(res.rows.length).toBe(1);
  });
});
