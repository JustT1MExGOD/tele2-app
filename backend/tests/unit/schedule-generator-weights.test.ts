/**
 * Изолированный тест fallback-цепочки/shrinkage-математики генератора
 * графика (без БД) — см. план synthetic-roaming-mountain, раздел 2.
 */
import { describe, it, expect } from 'vitest';
import {
  tierAdjustedRate,
  type HistBucketsForTest,
  type MetricBucketForTest
} from '../../src/core/schedules/index.js';
import { K_HOURS } from '../../src/core/schedules/domain/weights.js';

function bucket(metricSum: Record<string, number>, hours: number): MetricBucketForTest {
  return { metricSum, hours };
}

function emptyBuckets(): HistBucketsForTest {
  return {
    empStoreWeekday: new Map(),
    empStore: new Map(),
    emp: new Map(),
    storeWeekday: new Map(),
    store: new Map(),
    org: bucket({ sim: 0 }, 0)
  };
}

describe('tierAdjustedRate — fallback-цепочка + shrinkage', () => {
  it('без всякой истории возвращает tier=no_history и rate=0', () => {
    const b = emptyBuckets();
    const r = tierAdjustedRate('e1', 's1', 0, ['sim'], b);
    expect(r.tier).toBe('no_history');
    expect(r.rate.sim).toBe(0);
    expect(r.hoursObserved).toBe(0);
  });

  it('единственный доступный tier (org) используется напрямую с shrinkage к 0 (нет next tier)', () => {
    const b = emptyBuckets();
    b.org = bucket({ sim: 100 }, 50); // hourly rate = 2
    const r = tierAdjustedRate('e1', 's1', 0, ['sim'], b);
    expect(r.tier).toBe('org');
    const expectedConfidence = 50 / (50 + K_HOURS);
    expect(r.rate.sim).toBeCloseTo(expectedConfidence * 2, 6);
  });

  it('при большом observed hours (>>K_HOURS) confidence -> 1, rate стремится к tier-rate без учёта next tier', () => {
    const b = emptyBuckets();
    b.empStoreWeekday.set('e1|s1|0', bucket({ sim: 10000 }, 5000)); // rate=2
    b.store.set('s1', bucket({ sim: 300 }, 100)); // rate=3, next в цепочке (store)
    const r = tierAdjustedRate('e1', 's1', 0, ['sim'], b);
    expect(r.tier).toBe('employee_store_weekday');
    const confidence = 5000 / (5000 + K_HOURS);
    expect(confidence).toBeGreaterThan(0.99);
    expect(r.rate.sim).toBeCloseTo(2, 1);
  });

  it('при малом observed hours (<<K_HOURS) confidence -> 0, rate сильно тянется к next tier', () => {
    const b = emptyBuckets();
    b.empStoreWeekday.set('e1|s1|0', bucket({ sim: 4 }, 1)); // rate=4, but hours=1 << K_HOURS=40
    b.empStore.set('e1|s1', bucket({ sim: 200 }, 100)); // rate=2, next tier
    const r = tierAdjustedRate('e1', 's1', 0, ['sim'], b);
    expect(r.tier).toBe('employee_store_weekday');
    const confidence = 1 / (1 + K_HOURS);
    expect(confidence).toBeLessThan(0.03);
    const expected = confidence * 4 + (1 - confidence) * 2;
    expect(r.rate.sim).toBeCloseTo(expected, 6);
    // сильно ближе к next tier rate (2), чем к first tier rate (4)
    expect(Math.abs(r.rate.sim - 2)).toBeLessThan(Math.abs(r.rate.sim - 4));
  });

  it('пропускает пустые (hours=0) промежуточные tier-ы в цепочке fallback', () => {
    const b = emptyBuckets();
    // employee_store_weekday и employee_store пусты (hours=0) -> должен упасть до emp
    b.emp.set('e1', bucket({ sim: 150 }, 50)); // rate=3
    b.store.set('s1', bucket({ sim: 400 }, 200)); // rate=2, next non-empty tier after emp
    const r = tierAdjustedRate('e1', 's1', 0, ['sim'], b);
    expect(r.tier).toBe('employee');
    const confidence = 50 / (50 + K_HOURS);
    const expected = confidence * 3 + (1 - confidence) * 2;
    expect(r.rate.sim).toBeCloseTo(expected, 6);
  });

  it('несколько метрик считаются независимо в одном вызове', () => {
    const b = emptyBuckets();
    b.store.set('s1', bucket({ sim: 300, revenue: 900 }, 100)); // sim rate=3, revenue rate=9
    const r = tierAdjustedRate('e1', 's1', 0, ['sim', 'revenue'], b);
    const confidence = 100 / (100 + K_HOURS);
    expect(r.rate.sim).toBeCloseTo(confidence * 3, 6);
    expect(r.rate.revenue).toBeCloseTo(confidence * 9, 6);
  });
});
