/**
 * 20.48.0 (Web Security & Trust Layer) — normalizePhone()/validatePhone()
 * зеркалят SQL-нормализацию в migrations/0020_identities.sql; таблица
 * кейсов держит оба места в согласии на уровне тестируемого поведения.
 */
import { describe, it, expect } from 'vitest';
import { normalizePhone, validatePhone } from '../../src/utils/phone.js';

describe('utils/phone — normalizePhone/validatePhone (RU-профиль)', () => {
  const CANONICAL = '+79991234567';

  it.each([
    ['+79991234567', CANONICAL],
    ['89991234567', CANONICAL],
    ['79991234567', CANONICAL],
    ['+7 999 123-45-67', CANONICAL],
    ['8 (999) 123-45-67', CANONICAL],
    ['+7-999-123-45-67', CANONICAL]
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
    expect(validatePhone(raw)).toBe(true);
  });

  it.each([
    ['not-a-phone'],
    ['+1 555 123 4567'], // не РФ — вне объёма, сознательно отклоняется
    ['+7999123456'], // 9 цифр после +7, коротко
    ['+799912345678'], // 11 цифр после +7, длинно
    ['']
  ])('%s → null (нераспознанный формат)', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
    expect(validatePhone(raw)).toBe(false);
  });
});
