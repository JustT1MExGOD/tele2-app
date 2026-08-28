/**
 * 20.48.0 (Web Security & Trust Layer, Auth & Session Security) —
 * identities: phone-конфликт reject'ится (409), не transfer'ится, в
 * отличие от Telegram (см. me-bind.test.ts::transfer). Телефон — credential
 * boundary, не recovery-механизм.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

function uniquePhone(): string {
  return '+7902' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('identities — phone reject-конфликт (не transfer)', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('POST /me/link-phone на номер, уже занятый другим сотрудником — 409, чужая identity не тронута', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Identities Reject Org');
    const takenPhone = uniquePhone();
    const occupant = await fx.createPhoneEmployee(org, takenPhone, 'scrypt$aa$bb', { fullName: 'Occupant' });
    const claimant = await fx.createEmployee(org, { role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      headers: authAs(claimant.telegramId),
      payload: { phone: takenPhone, password: 'password123' }
    });
    expect(res.statusCode).toBe(409);

    // Не transfer: identity всё ещё указывает на первоначального владельца.
    const identityRow = await query(
      `SELECT employee_id FROM identities WHERE provider='phone' AND provider_key=$1`,
      [occupant.phone]
    );
    expect(identityRow.rows.length).toBe(1);
    expect(Number(identityRow.rows[0].employee_id)).toBe(occupant.id);

    const claimantRow = await query(`SELECT phone FROM employees WHERE id=$1`, [claimant.id]);
    expect(claimantRow.rows[0].phone).toBeNull();
  });

  it('сотрудник переподвязывает СВОЙ номер на другой — разрешено (не считается конфликтом)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Identities Self Relink Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const firstPhone = uniquePhone();
    const secondPhone = uniquePhone();

    const first = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      headers: authAs(employee.telegramId),
      payload: { phone: firstPhone, password: 'password123' }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/me/link-phone',
      headers: authAs(employee.telegramId),
      payload: { phone: secondPhone, password: 'password456' }
    });
    expect(second.statusCode).toBe(200);

    const identityRows = await query(`SELECT provider_key FROM identities WHERE employee_id=$1 AND provider='phone'`, [employee.id]);
    expect(identityRows.rows.length).toBe(1);
    expect(identityRows.rows[0].provider_key).toBe(secondPhone);

    const staleFirst = await query(`SELECT employee_id FROM identities WHERE provider='phone' AND provider_key=$1`, [firstPhone]);
    expect(staleFirst.rows.length).toBe(0);
  });
});
