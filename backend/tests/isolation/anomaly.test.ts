import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';
import { checkAnomalyVsForecast, explainDip } from '../../src/core/analytics/anomaly.js';

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

// 21.0 Explain — три детерминированных фактора, добавленные к дипу без
// изменения самой z-модели. explainDip — чистая функция решений (принимает
// уже собранные Map/числа), поэтому network_wide проверяется юнит-тестом
// без обращения к БД: сводить реальный "сетевой" сценарий из нескольких
// одновременно проседающих точек в отдельном describe хрупко (checkAnomalyVsForecast
// видит ВСЕ активные точки в БД, включая оставшиеся от соседних describe/файлов,
// если бы порядок исполнения когда-нибудь изменился) — а тут это не нужно,
// решение зависит только от переданных isNetworkWideDay/mildDipCount/totalStoresWithZ.
describe('explainDip — сетевой фактор (юнит, без БД)', () => {
  const noHist = new Map<string, Map<string, number>>();
  const noHeadcountToday = new Map<string, number>();
  const noSessions = new Map<string, number>();

  it('isNetworkWideDay=false — network_wide не добавляется', () => {
    const causes = explainDip('s1', noHist, noHeadcountToday, noSessions, 3, false, 5, 10);
    expect(causes.some((c) => c.type === 'network_wide')).toBe(false);
  });

  it('isNetworkWideDay=true — network_wide добавляется, считает ДРУГИЕ точки (mildDipCount - 1)', () => {
    const causes = explainDip('s1', noHist, noHeadcountToday, noSessions, 3, true, 5, 10);
    const cause = causes.find((c) => c.type === 'network_wide');
    expect(cause).toBeDefined();
    expect(cause!.detail).toContain('4 из 10');
  });

  it('нет истории headcount и нет графика — причин не находится вообще', () => {
    const causes = explainDip('s1', noHist, noHeadcountToday, noSessions, 3, false, 0, 0);
    expect(causes).toEqual([]);
  });
});

describe('checkAnomalyVsForecast — Explain (understaffing / shift_gap через реальную БД)', () => {
  const fx2 = new TestFixtures();
  let org2: string;
  let storeUnderstaffed: string, storeShiftGap: string;
  // Разные сотрудники на каждую точку: schedules_employee_date_uq не
  // позволяет одному employee_id стоять в графике на двух точках в одну
  // work_date — историческая укомплектованность обеих точек в одни и те
  // же прошлые недели требует непересекающихся людей.
  let emp1: { id: number }, emp2: { id: number }, emp3: { id: number };
  let empS1: { id: number }, empS2: { id: number }, empS3: { id: number };

  const yesterday2 = new Date(todayMoscow() + 'T12:00:00');
  yesterday2.setDate(yesterday2.getDate() - 1);
  const yesterdayStr2 = yesterday2.toISOString().slice(0, 10);

  /** Тот же проверенный числовой паттерн, что storeDip в блоке выше
   * (baseline 10 / целевой день недели 20 / факт 0) — уже подтверждено,
   * что он даёт z < -2 и проходит гейт MIN_REAL_SAMPLES. */
  async function seedDip(storeId: string, employeeId: number) {
    const targetDow = yesterday2.getDay();
    for (let i = 1; i <= 120; i++) {
      const d = new Date(yesterday2);
      d.setDate(d.getDate() - i);
      const value = d.getDay() === targetDow ? 20 : 10;
      await query(
        `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
        [employeeId, storeId, d.toISOString().slice(0, 10), value]
      );
    }
    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
      [employeeId, storeId, yesterdayStr2, 0]
    );
  }

  /** 4 исторические недели по тому же дню недели, что yesterday2 — типичная
   * укомплектованность 3 чел/день (MIN_HEADCOUNT_SAMPLES=2 удовлетворён). */
  async function seedTypicalHeadcount(storeId: string, employees: { id: number }[]) {
    for (let w = 1; w <= 4; w++) {
      const d = new Date(yesterday2);
      d.setDate(d.getDate() - 7 * w);
      const dateStr = d.toISOString().slice(0, 10);
      for (const e of employees) {
        await query(
          `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
          [e.id, storeId, dateStr]
        );
      }
    }
  }

  beforeAll(async () => {
    org2 = await fx2.createOrg('Org Explain');
    storeUnderstaffed = await fx2.createStore(org2, 'Store Understaffed');
    storeShiftGap = await fx2.createStore(org2, 'Store ShiftGap');
    emp1 = await fx2.createEmployee(org2, { role: 'employee' });
    emp2 = await fx2.createEmployee(org2, { role: 'employee' });
    emp3 = await fx2.createEmployee(org2, { role: 'employee' });
    empS1 = await fx2.createEmployee(org2, { role: 'employee' });
    empS2 = await fx2.createEmployee(org2, { role: 'employee' });
    empS3 = await fx2.createEmployee(org2, { role: 'employee' });

    await seedDip(storeUnderstaffed, emp1.id);
    await seedDip(storeShiftGap, empS1.id);
    await seedTypicalHeadcount(storeUnderstaffed, [emp1, emp2, emp3]);
    await seedTypicalHeadcount(storeShiftGap, [empS1, empS2, empS3]);

    // storeUnderstaffed: вчера по графику стоял только emp1 (типично — 3),
    // и он реально открыл смену — явка полная, недоукомплектован именно график.
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
      [emp1.id, storeUnderstaffed, yesterdayStr2]
    );
    await query(
      `INSERT INTO shift_sessions (employee_id, store_id, work_date, status) VALUES ($1,$2,$3,'closed')`,
      [emp1.id, storeUnderstaffed, yesterdayStr2]
    );

    // storeShiftGap: вчера по графику все 3 (типичная укомплектованность),
    // но реально смену открыл только один — разрыв явки, не недокомплект графика.
    for (const e of [empS1, empS2, empS3]) {
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, hours) VALUES ($1,$2,$3,8)`,
        [e.id, storeShiftGap, yesterdayStr2]
      );
    }
    await query(
      `INSERT INTO shift_sessions (employee_id, store_id, work_date, status) VALUES ($1,$2,$3,'closed')`,
      [empS1.id, storeShiftGap, yesterdayStr2]
    );
  });

  afterAll(async () => {
    const storeIds = [storeUnderstaffed, storeShiftGap];
    await query(`DELETE FROM shift_sessions WHERE store_id = ANY($1)`, [storeIds]);
    await query(`DELETE FROM smart_alerts WHERE store_id = ANY($1)`, [storeIds]);
    await fx2.cleanup();
  });

  it('недоукомплектованный график (1 вместо обычных 3) — понимание understaffing, без shift_gap', async () => {
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeUnderstaffed]
    );
    expect(res.rows.length).toBe(1);
    const causes = res.rows[0].payload.possible_causes as { type: string; detail: string }[];
    expect(causes.some((c) => c.type === 'understaffing')).toBe(true);
    expect(causes.some((c) => c.type === 'shift_gap')).toBe(false);
    expect(res.rows[0].body).toContain('Возможные причины');
  });

  it('график полный (3), но пришёл только 1 — понимание shift_gap, без understaffing', async () => {
    await checkAnomalyVsForecast();
    const res = await query(
      `SELECT * FROM smart_alerts WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'`,
      [storeShiftGap]
    );
    expect(res.rows.length).toBe(1);
    const causes = res.rows[0].payload.possible_causes as { type: string; detail: string }[];
    expect(causes.some((c) => c.type === 'shift_gap')).toBe(true);
    expect(causes.some((c) => c.type === 'understaffing')).toBe(false);
  });
});
