import { describe, it, expect } from 'vitest';
import { canonicalMetricId } from '../lib/metrics.js';

describe('canonicalMetricId', () => {
  it('maps both RU/uppercase and EN/mixed-case SIM literals to the same id', () => {
    expect(canonicalMetricId('SIM')).toBe('sim');
    expect(canonicalMetricId('Sim')).toBe('sim');
  });

  it('maps both RU and EN Combo literals to the same id', () => {
    expect(canonicalMetricId('Комбо')).toBe('combo');
    expect(canonicalMetricId('Combo')).toBe('combo');
  });

  it('maps every literal seen in the source bundle', () => {
    const literals = [
      'HB', 'MNP-заявки', 'wink', 'Аксы', 'Доп услуги', 'Кредит', 'ПА',
      'Плоттер', 'Страховки', 'Телефон', 'ФО', 'ШПД',
    ];
    for (const l of literals) {
      expect(canonicalMetricId(l), `literal "${l}" should map`).not.toBeNull();
    }
  });

  it('returns null for an unknown literal (fail loud, never silently drop)', () => {
    expect(canonicalMetricId('totally unknown metric')).toBeNull();
  });
});
