import { describe, it, expect } from 'vitest';
import { canonicalEmployeeName } from '../lib/employees.js';

describe('canonicalEmployeeName', () => {
  it('fixes the confirmed April-schedule typo without creating a separate employee', () => {
    expect(canonicalEmployeeName('Степанов Алекскей Юрьевич')).toBe('Степанов Алексей Юрьевич');
  });

  it('leaves an already-correct name unchanged', () => {
    expect(canonicalEmployeeName('Степанов Алексей Юрьевич')).toBe('Степанов Алексей Юрьевич');
  });
});
