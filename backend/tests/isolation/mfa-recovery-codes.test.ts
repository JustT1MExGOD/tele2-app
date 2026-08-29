/**
 * 20.52.0 (MFA) — recovery codes: CSPRNG generation, single-use, atomic
 * consumption (race-safe), regeneration invalidates the previous batch.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { TestFixtures } from '../helpers/fixtures.js';
import * as recoveryCodes from '../../src/auth/mfa/recovery-codes.js';

describe('auth/mfa/recovery-codes', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('generates 10 unique codes, all initially unused', async () => {
    const org = await fx.createOrg('Recovery Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const codes = await recoveryCodes.generateRecoveryCodes(id);
    expect(codes.length).toBe(10);
    expect(new Set(codes).size).toBe(10);
    expect(await recoveryCodes.countRemainingRecoveryCodes(id)).toBe(10);
  });

  it('a code can be consumed exactly once', async () => {
    const org = await fx.createOrg('Recovery Consume Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const [code] = await recoveryCodes.generateRecoveryCodes(id);

    expect(await recoveryCodes.consumeRecoveryCode(id, code)).toBe(true);
    expect(await recoveryCodes.countRemainingRecoveryCodes(id)).toBe(9);
    // Повторное использование того же кода — отклонено.
    expect(await recoveryCodes.consumeRecoveryCode(id, code)).toBe(false);
    expect(await recoveryCodes.countRemainingRecoveryCodes(id)).toBe(9);
  });

  it('consuming under concurrent replay only succeeds once (race-safe UPDATE...WHERE used_at IS NULL)', async () => {
    const org = await fx.createOrg('Recovery Race Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const [code] = await recoveryCodes.generateRecoveryCodes(id);

    const [a, b] = await Promise.all([
      recoveryCodes.consumeRecoveryCode(id, code),
      recoveryCodes.consumeRecoveryCode(id, code)
    ]);
    // Ровно один из двух параллельных вызовов должен успеть.
    expect([a, b].filter(Boolean).length).toBe(1);
    expect(await recoveryCodes.countRemainingRecoveryCodes(id)).toBe(9);
  });

  it('a code belonging to a different employee is rejected', async () => {
    const org = await fx.createOrg('Recovery CrossEmp Org');
    const a = await fx.createEmployee(org, { role: 'employee' });
    const b = await fx.createEmployee(org, { role: 'employee' });
    const [codeForA] = await recoveryCodes.generateRecoveryCodes(a.id);
    expect(await recoveryCodes.consumeRecoveryCode(b.id, codeForA)).toBe(false);
    // Код всё ещё валиден для настоящего владельца.
    expect(await recoveryCodes.consumeRecoveryCode(a.id, codeForA)).toBe(true);
  });

  it('regeneration invalidates the entire previous batch, even unused codes', async () => {
    const org = await fx.createOrg('Recovery Regen Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const firstBatch = await recoveryCodes.generateRecoveryCodes(id);
    const secondBatch = await recoveryCodes.generateRecoveryCodes(id);

    expect(await recoveryCodes.countRemainingRecoveryCodes(id)).toBe(10);
    for (const oldCode of firstBatch) {
      expect(await recoveryCodes.consumeRecoveryCode(id, oldCode)).toBe(false);
    }
    expect(await recoveryCodes.consumeRecoveryCode(id, secondBatch[0])).toBe(true);
  });

  it('is case/whitespace-insensitive on submission (matches how a human retypes a code)', async () => {
    const org = await fx.createOrg('Recovery Case Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    const [code] = await recoveryCodes.generateRecoveryCodes(id);
    expect(await recoveryCodes.consumeRecoveryCode(id, `  ${code.toUpperCase()}  `)).toBe(true);
  });

  it('rejects empty/garbage input without throwing', async () => {
    const org = await fx.createOrg('Recovery Garbage Org');
    const { id } = await fx.createEmployee(org, { role: 'employee' });
    await recoveryCodes.generateRecoveryCodes(id);
    for (const bad of ['', '   ', 'not-a-real-code', '<script>alert(1)</script>']) {
      expect(await recoveryCodes.consumeRecoveryCode(id, bad)).toBe(false);
    }
  });
});
