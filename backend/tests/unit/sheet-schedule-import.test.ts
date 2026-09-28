/**
 * Google Sheets schedule import — тесты чистых функций (сопоставление
 * имени, разбор ячейки). Без БД: DB-путь (schedules.source-приоритет,
 * pending-очередь) требует embedded Postgres и не покрыт этим файлом —
 * известный пробел, см. docs/SHEET-SCHEDULE-IMPORT.md.
 */
import { describe, it, expect } from 'vitest';
import { normalizeName, nameSimilarity, findBestMatch, FUZZY_MATCH_THRESHOLD } from '../../src/core/integrations/sheet-name-match.js';
import { parseShiftCell } from '../../src/core/integrations/sheet-shift-parse.js';

describe('sheet-name-match', () => {
  it('normalizeName сворачивает регистр, лишние пробелы и ё/е', () => {
    expect(normalizeName('  Афанасьев  Аким ')).toBe('афанасьев аким');
    expect(normalizeName('Ёжиков')).toBe('ежиков');
  });

  it('nameSimilarity: идентичные после нормализации строки дают 1', () => {
    expect(nameSimilarity('Афанасьев Аким', 'афанасьев   аким')).toBe(1);
  });

  it('findBestMatch: точное совпадение помечено exact=true', () => {
    const candidates = [{ id: 1, full_name: 'Афанасьев Аким Александрович' }, { id: 2, full_name: 'Бижонов Семён Михайлович' }];
    const m = findBestMatch('афанасьев аким александрович', candidates);
    expect(m).toEqual({ employeeId: 1, score: 1, exact: true });
  });

  it('findBestMatch: опечатка находит правильного кандидата, но не exact', () => {
    const candidates = [{ id: 1, full_name: 'Афанасьев Аким Александрович' }, { id: 2, full_name: 'Бижонов Семён Михайлович' }];
    const m = findBestMatch('Афонасьев Аким Александрович', candidates); // а->о опечатка
    expect(m?.employeeId).toBe(1);
    expect(m?.exact).toBe(false);
    expect(m!.score).toBeGreaterThanOrEqual(FUZZY_MATCH_THRESHOLD);
  });

  it('findBestMatch: совсем другое имя не возвращает кандидата', () => {
    const candidates = [{ id: 1, full_name: 'Афанасьев Аким Александрович' }];
    expect(findBestMatch('Петров Иван Сидорович', candidates)).toBeNull();
  });

  it('findBestMatch: пустой список кандидатов -> null', () => {
    expect(findBestMatch('Кто угодно', [])).toBeNull();
  });
});

describe('sheet-shift-parse', () => {
  it('разбирает обычную дневную смену', () => {
    expect(parseShiftCell('10-22')).toEqual({ kind: 'shift', shiftText: '10-22', hours: 12 });
  });

  it('разбирает ночную смену через полночь', () => {
    expect(parseShiftCell('22-6')).toEqual({ kind: 'shift', shiftText: '22-6', hours: 8 });
  });

  it('вых/отп/пусто — выходной', () => {
    expect(parseShiftCell('вых')).toEqual({ kind: 'off' });
    expect(parseShiftCell('отп')).toEqual({ kind: 'off' });
    expect(parseShiftCell('')).toEqual({ kind: 'off' });
    expect(parseShiftCell(undefined)).toEqual({ kind: 'off' });
    expect(parseShiftCell('  ВЫХ  ')).toEqual({ kind: 'off' });
  });

  it('мусор в ячейке -> unparseable, не тихий 0', () => {
    expect(parseShiftCell('какой-то текст')).toEqual({ kind: 'unparseable' });
    expect(parseShiftCell('25-30')).toEqual({ kind: 'unparseable' });
    expect(parseShiftCell('10-10')).toEqual({ kind: 'unparseable' });
  });
});
