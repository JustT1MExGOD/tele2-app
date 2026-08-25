/**
 * Domain Integrity (20.33) — org-scoping инвариант ("точка/сотрудник
 * принадлежит существующей сети") раньше жил только в TypeScript
 * (tenant.ts, assertStoreInOrg/assertEmployeeInOrg). Эти тесты проверяют,
 * что теперь его держит и сама БД (0016_org_scoping_fk.sql) — INSERT с
 * несуществующим org_id/store_id падает на уровне constraint, а не тихо
 * проходит.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { query } from '../../src/data/db/index.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('FK-целостность org-scoping колонок', () => {
  const fx = new TestFixtures();

  afterAll(async () => {
    await fx.cleanup();
  });

  it('employees.org_id — INSERT с несуществующей сетью падает', async () => {
    await expect(
      query(
        `INSERT INTO employees (full_name, role, access_status, is_active, org_id)
         VALUES ('FK Test', 'employee', 'active', true, 'nonexistent_org_xyz')`
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it('stores.org_id — INSERT с несуществующей сетью падает', async () => {
    await expect(
      query(
        `INSERT INTO stores (id, code, name, short_name, hours, close_time_weekday, org_id)
         VALUES ('fk_test_store', 'fk_test_store', 'FK Test', 'FK', 12, '21:00', 'nonexistent_org_xyz')`
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it('announcements.org_id — INSERT с несуществующей сетью падает', async () => {
    await expect(
      query(
        `INSERT INTO announcements (org_id, title, body) VALUES ('nonexistent_org_xyz', 'x', 'x')`
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it('channels.org_id и channels.store_id — INSERT с несуществующими родителями падает', async () => {
    await expect(
      query(
        `INSERT INTO channels (id, org_id, kind, title) VALUES ('fk_test_ch', 'nonexistent_org_xyz', 'sales', 'x')`
      )
    ).rejects.toThrow(/foreign key/i);

    const org = await fx.createOrg('FK Channel Org');
    await expect(
      query(
        `INSERT INTO channels (id, org_id, kind, store_id, title) VALUES ('fk_test_ch2', $1, 'sales', 'nonexistent_store_xyz', 'x')`,
        [org]
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it('org_id IS NULL по-прежнему разрешён (COALESCE(org_id, \'default\') — существующая конвенция)', async () => {
    const org = await fx.createOrg('FK Null Org');
    const store = await fx.createStore(org, 'FK Null Store');
    await query(`UPDATE stores SET org_id = NULL WHERE id = $1`, [store]);
    const res = await query(`SELECT org_id FROM stores WHERE id = $1`, [store]);
    expect(res.rows[0].org_id).toBeNull();
  });

  it('валидный org_id по-прежнему проходит (позитивный кейс, не только отказ)', async () => {
    const org = await fx.createOrg('FK Valid Org');
    const employee = await fx.createEmployee(org);
    expect(employee.id).toBeGreaterThan(0);
  });
});
