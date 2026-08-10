import { describe, it, expect } from 'vitest';
import { toDateISO } from '../../src/utils/date.js';

// Регрессия: node-postgres парсит колонку типа `date` в полночь ПО
// ЛОКАЛЬНОМУ времени процесса, а не UTC. toDateISO() раньше читал такой
// Date через getUTC*() — на проде (контейнер в UTC) локальное совпадает
// с UTC, поэтому не проявлялось, но при любом локальном TZ восточнее UTC
// (Europe/Moscow, UTC+3 — как раз таймзона этого проекта) сдвигало дату
// на день назад. Тест эмулирует именно то, что реально возвращает
// node-postgres для DATE-колонки: Date, сконструированный в локальной
// полночи через new Date(year, monthIndex, day).
describe('toDateISO — конвертация Date из pg date-колонки', () => {
  it('возвращает тот же календарный день, что был передан в локальный конструктор Date', () => {
    const localMidnight = new Date(2026, 4, 15); // 15 мая, локальная полночь
    expect(toDateISO(localMidnight)).toBe('2026-05-15');
  });

  it('корректно работает на границах месяца/года', () => {
    expect(toDateISO(new Date(2025, 11, 31))).toBe('2025-12-31');
    expect(toDateISO(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('строковый ISO-вход проходит без изменений', () => {
    expect(toDateISO('2026-05-15')).toBe('2026-05-15');
    expect(toDateISO('2026-05-15T00:00:00.000Z')).toBe('2026-05-15');
  });

  it('пустой/null вход не падает', () => {
    expect(typeof toDateISO(null)).toBe('string');
    expect(typeof toDateISO(undefined)).toBe('string');
    expect(typeof toDateISO('')).toBe('string');
  });
});
