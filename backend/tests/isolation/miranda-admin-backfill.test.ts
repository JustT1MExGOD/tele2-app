import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAsSession } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

const migrationSql = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/0045_miranda_admin_accounts_backfill.sql'),
  'utf8'
);

describe('T2 Miranda — backfill аккаунтов администраторов', () => {
  const fx = new TestFixtures();
  const corporateAccountIds: number[] = [];

  afterAll(async () => {
    const fixtureCorporateAccountIds = corporateAccountIds.length
      ? await query(
          `SELECT id FROM corporate_accounts
           WHERE id = ANY($1) OR employee_id = ANY($2)`,
          [corporateAccountIds, fx.employeeIds]
        )
      : { rows: [] };
    const ids = fixtureCorporateAccountIds.rows.map((row: any) => Number(row.id));
    if (ids.length) {
      await query(
        `DELETE FROM miranda_admin_account_grants WHERE corporate_account_id = ANY($1)`,
        [ids]
      );
      await query(
        `UPDATE employee_sessions SET active_corporate_account_id = NULL WHERE active_corporate_account_id = ANY($1)`,
        [ids]
      );
      await query(`DELETE FROM corporate_accounts WHERE id = ANY($1)`, [ids]);
    }
    await fx.cleanup();
  });

  it('создаёт ровно один личный аккаунт активному admin, связывает его с employee и показывает в контактах', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Admin Backfill Org');
    const oldOrg = await fx.createOrg('Miranda Admin Old Org');
    const admin = await fx.createEmployee(org, { role: 'admin', fullName: 'Админ для Miranda' });
    const newAdmin = await fx.createEmployee(org, { role: 'admin', fullName: 'Новый админ Miranda' });
    const inactiveAdmin = await fx.createEmployee(org, { role: 'admin', fullName: 'Неактивный админ' });
    const regularEmployee = await fx.createEmployee(org, { role: 'employee', fullName: 'Обычный сотрудник' });

    await query(`UPDATE employees SET is_active = false WHERE id = $1`, [inactiveAdmin.id]);

    // Проверяем не только новый INSERT: существующий профиль администратора
    // должен быть отремонтирован и не должен получить второй личный аккаунт.
    const existing = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, store_id, display_label, is_active, device_exclusive)
       VALUES ($1, $2, NULL, NULL, false, true) RETURNING id`,
      [oldOrg, admin.id]
    );
    const existingAccountId = Number(existing.rows[0].id);
    corporateAccountIds.push(existingAccountId);

    // Повторный запуск имитирует безопасное повторное выполнение backfill:
    // первая команда чинит существующий ряд, вторая не создаёт дубль.
    await query(migrationSql);
    await query(migrationSql);

    const adminAccounts = await query(
      `SELECT id, org_id, employee_id, store_id, display_label, is_active, device_exclusive
       FROM corporate_accounts
       WHERE employee_id = $1 AND store_id IS NULL`,
      [admin.id]
    );
    expect(adminAccounts.rows).toHaveLength(1);
    const account = adminAccounts.rows[0];
    corporateAccountIds.push(Number(account.id));
    expect(Number(account.id)).toBe(existingAccountId);
    expect(account.org_id).toBe(org);
    expect(Number(account.employee_id)).toBe(admin.id);
    expect(account.store_id).toBeNull();
    expect(account.display_label).toBe('Админ для Miranda');
    expect(account.is_active).toBe(true);
    expect(account.device_exclusive).toBe(false);

    const newAdminAccount = await query(
      `SELECT id, org_id, employee_id, store_id, display_label, is_active, device_exclusive
       FROM corporate_accounts
       WHERE employee_id = $1 AND store_id IS NULL`,
      [newAdmin.id]
    );
    expect(newAdminAccount.rows).toHaveLength(1);
    const newAccount = newAdminAccount.rows[0];
    expect(newAccount.org_id).toBe(org);
    expect(Number(newAccount.employee_id)).toBe(newAdmin.id);
    expect(newAccount.store_id).toBeNull();
    expect(newAccount.display_label).toBe('Новый админ Miranda');
    expect(newAccount.is_active).toBe(true);
    expect(newAccount.device_exclusive).toBe(false);
    corporateAccountIds.push(Number(newAccount.id));

    const excluded = await query(
      `SELECT employee_id FROM corporate_accounts WHERE employee_id = ANY($1) AND store_id IS NULL`,
      [[inactiveAdmin.id, regularEmployee.id]]
    );
    expect(excluded.rows).toHaveLength(0);

    const sessionToken = await sessionsRepo.createSession(admin.id, true, 'admin');
    await query(
      `UPDATE employee_sessions
       SET active_corporate_account_id = $1
       WHERE token_hash = encode(sha256($2::bytea), 'hex')`,
      [existingAccountId, sessionToken]
    );
    const contacts = await app.inject({
      method: 'GET',
      url: '/miranda/contacts/all',
      headers: authAsSession(sessionToken)
    });
    expect(contacts.statusCode).toBe(200);
    const contact = contacts.json().items.find(
      (item: any) => Number(item.corporate_account_id) === existingAccountId
    );
    expect(contact).toBeTruthy();
    expect(Number(contact.employee_id)).toBe(admin.id);
    expect(contact.employee_full_name).toBe('Админ для Miranda');
  });
});
