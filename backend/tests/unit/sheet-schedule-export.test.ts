/**
 * Google Sheets schedule export (Phase 2, обратное направление) — тесты
 * чистых функций (сериал даты, имя листа, буква колонки, hex->rgb). Живой
 * поход в Sheets API (locate/write) не покрыт: требует настоящего
 * сервис-аккаунта и настоящей таблицы, см. docs/SHEET-SCHEDULE-IMPORT.md.
 */
import { describe, it, expect } from 'vitest';
import { workDateToSerial, sheetTitleForMonth, colLetter, hexToRgb } from '../../src/core/integrations/sheet-schedule-export.js';

describe('sheet-schedule-export — сериал даты Google Sheets', () => {
  it('2026-11-01 -> серийный номер по документированной эпохе Sheets (1899-12-30 = день 0)', () => {
    expect(workDateToSerial('2026-11-01')).toBe(46327);
  });

  it('последовательные даты дают последовательные серийные номера', () => {
    const a = workDateToSerial('2026-11-05');
    const b = workDateToSerial('2026-11-06');
    expect(b - a).toBe(1);
  });

  it('переход через границу месяца/года не ломает последовательность', () => {
    expect(workDateToSerial('2027-01-01') - workDateToSerial('2026-12-31')).toBe(1);
  });
});

describe('sheet-schedule-export — имя листа из даты', () => {
  it('строит "Месяц Год" с большой буквы, нужный формат листа', () => {
    expect(sheetTitleForMonth('2026-11-05')).toBe('Ноябрь 2026');
    expect(sheetTitleForMonth('2026-01-15')).toBe('Январь 2026');
    expect(sheetTitleForMonth('2026-12-31')).toBe('Декабрь 2026');
  });
});

describe('sheet-schedule-export — буква колонки A1', () => {
  it('первые буквы совпадают с A1-нотацией', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(3)).toBe('D');
    expect(colLetter(25)).toBe('Z');
  });

  it('после Z переходит на AA/AB', () => {
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
  });
});

describe('sheet-schedule-export — hex -> rgb для Sheets API', () => {
  it('конвертирует известные цвета точек в 0..1 диапазон', () => {
    expect(hexToRgb('#ff6d01')).toEqual({ red: 1, green: 109 / 255, blue: 1 / 255 });
    expect(hexToRgb('#00ff00')).toEqual({ red: 0, green: 1, blue: 0 });
    expect(hexToRgb('#000000')).toEqual({ red: 0, green: 0, blue: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ red: 1, green: 1, blue: 1 });
  });
});
