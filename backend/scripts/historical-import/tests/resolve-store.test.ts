import { describe, it, expect } from 'vitest';
import { resolveStore } from '../lib/resolve-store.js';
import type { ScheduleIndex } from '../lib/schedule-index.js';

function idx(entries: [string, string, 'working' | 'day_off', string | null][]): ScheduleIndex {
  const m: ScheduleIndex = new Map();
  for (const [name, date, status, storeId] of entries) {
    m.set(`${name} ${date}`, { employeeName: name, date, status, storeId, shiftStart: null, shiftEnd: null });
  }
  return m;
}

describe('resolveStore', () => {
  it('resolves from schedule when working with a store', () => {
    const r = resolveStore('Каравашков Андрей Алексеевич', '2026-05-02', idx([
      ['Каравашков Андрей Алексеевич', '2026-05-02', 'working', 'kalinina2'],
    ]));
    expect(r.category).toBe('STORE_RESOLVED_SCHEDULE');
    expect(r.storeId).toBe('kalinina2');
    expect(r.resolutionSource).toBe('SCHEDULE_SOURCE');
  });

  it('flags NO_STORE_NO_SCHEDULE when no schedule row exists at all', () => {
    const r = resolveStore('Рогожин Вячеслав Александрович', '2026-06-01', idx([]));
    expect(r.category).toBe('NO_STORE_NO_SCHEDULE');
    expect(r.storeId).toBeNull();
  });

  it('flags NO_STORE_DAY_OFF_CONFLICT when schedule says day_off with no override', () => {
    const r = resolveStore('Тутаев Никита Алексеевич', '2026-05-05', idx([
      ['Тутаев Никита Алексеевич', '2026-05-05', 'day_off', null],
    ]));
    expect(r.category).toBe('NO_STORE_DAY_OFF_CONFLICT');
  });

  it('the 8 Рогожин USER_CONFIRMED overrides resolve to Калинина 2 regardless of missing schedule', () => {
    const r = resolveStore('Рогожин Вячеслав Александрович', '2026-06-03', idx([]));
    expect(r.category).toBe('STORE_RESOLVED_USER_CONFIRMED');
    expect(r.storeId).toBe('kalinina2');
    expect(r.resolutionSource).toBe('USER_CONFIRMED');
    expect(r.resolutionReason).toBe('HISTORICAL_STORE_OVERRIDE');
  });

  it('the 2 technical-fact-on-day-off cases resolve to a store but are tagged distinctly, never a plain schedule match', () => {
    const r = resolveStore('Каравашков Андрей Алексеевич', '2026-06-30', idx([
      ['Каравашков Андрей Алексеевич', '2026-06-30', 'day_off', null],
    ]));
    expect(r.category).toBe('TECHNICAL_FACT_ON_DAY_OFF');
    expect(r.storeId).toBe('kalinina2');
    expect(r.resolutionReason).toBe('TECHNICAL_FACT_AFTER_STORE_CLOSE');
  });

  it('overrides take precedence even if a (hypothetical) schedule row later existed for that date', () => {
    const r = resolveStore('Рогожин Вячеслав Александрович', '2026-06-05', idx([
      ['Рогожин Вячеслав Александрович', '2026-06-05', 'day_off', null],
    ]));
    expect(r.category).toBe('STORE_RESOLVED_USER_CONFIRMED');
    expect(r.storeId).toBe('kalinina2');
  });
});
