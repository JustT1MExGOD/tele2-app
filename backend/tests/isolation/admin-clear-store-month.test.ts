/**
 * Admin Control Center — «Очистить график точки за месяц»: весь график
 * одной точки, все сотрудники разом. RBAC, org-scoping, preview count,
 * фактическое удаление, обязательная причина, audit-запись.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

describe('Admin Control Center — очистка графика точки за месяц', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let orgB: string;
  let storeA: string;
  let storeB: string;
  let adminA: { id: number; telegramId: number; telegramGrantToken?: string };
  let managerA: { id: number; telegramId: number; telegramGrantToken?: string };
  let employeeA1: { id: number; telegramId: number };
  let employeeA2: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Clear Store Month Org A');
    orgB = await fx.createOrg('Clear Store Month Org B');
    storeA = await fx.createStore(orgA, 'Store A1');
    storeB = await fx.createStore(orgB, 'Store B1');
    adminA = await fx.createEmployee(orgA, { role: 'admin' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });
    employeeA1 = await fx.createEmployee(orgA, { role: 'employee' });
    employeeA2 = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(async () => {
    await query(`DELETE FROM audit_log WHERE org_id = $1`, [orgA]);
    await fx.cleanup();
  });

  async function seedSchedule(employeeId: number, storeId: string, workDate: string) {
    await query(
      `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours) VALUES ($1, $2, $3, '10-21', 11)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET store_id = EXCLUDED.store_id`,
      [employeeId, storeId, workDate]
    );
  }

  it('non-admin (manager) заблокирован на preview и на самой очистке', async () => {
    const app = await getApp();
    const previewRes = await app.inject({
      method: 'GET', url: `/admin/schedules/clear-store-month/preview?store_id=${storeA}&month=2026-09`,
      headers: authAs(managerA.telegramId)
    });
    expect(previewRes.statusCode).toBe(403);

    const clearRes = await app.inject({
      method: 'POST', url: '/admin/schedules/clear-store-month',
      headers: authAs(managerA.telegramId),
      payload: { store_id: storeA, month: '2026-09', reason: 'test' }
    });
    expect(clearRes.statusCode).toBe(403);
  });

  it('без store_id/month — 400; без reason — 400', async () => {
    const app = await getApp();
    const missingParams = await app.inject({
      method: 'GET', url: '/admin/schedules/clear-store-month/preview',
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(missingParams.statusCode).toBe(400);

    const missingReason = await app.inject({
      method: 'POST', url: '/admin/schedules/clear-store-month',
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken),
      payload: { store_id: storeA, month: '2026-09' }
    });
    expect(missingReason.statusCode).toBe(400);
  });

  it('точка чужой сети — 403, без org_id override', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET', url: `/admin/schedules/clear-store-month/preview?store_id=${storeB}&month=2026-09`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(res.statusCode).toBe(403);
  });

  it('preview считает строки без изменения данных, потом очистка удаляет их все и пишет один audit-запись', async () => {
    const app = await getApp();
    await seedSchedule(employeeA1.id, storeA, '2026-09-05');
    await seedSchedule(employeeA1.id, storeA, '2026-09-06');
    await seedSchedule(employeeA2.id, storeA, '2026-09-05');
    // другой месяц — не должен попасть под очистку
    await seedSchedule(employeeA1.id, storeA, '2026-10-01');

    const preview = await app.inject({
      method: 'GET', url: `/admin/schedules/clear-store-month/preview?store_id=${storeA}&month=2026-09`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ storeId: storeA, count: 3 });

    // preview не должен был ничего удалить
    const stillThere = await query(`SELECT COUNT(*)::int as c FROM schedules WHERE store_id = $1 AND work_date >= '2026-09-01' AND work_date < '2026-10-01'`, [storeA]);
    expect(stillThere.rows[0].c).toBe(3);

    const clear = await app.inject({
      method: 'POST', url: '/admin/schedules/clear-store-month',
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken),
      payload: { store_id: storeA, month: '2026-09', reason: 'месяц не открывался, ошибочно сгенерирован' }
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toMatchObject({ deletedCount: 3, storeId: storeA });

    const afterClear = await query(`SELECT COUNT(*)::int as c FROM schedules WHERE store_id = $1 AND work_date >= '2026-09-01' AND work_date < '2026-10-01'`, [storeA]);
    expect(afterClear.rows[0].c).toBe(0);
    // октябрьская строка не должна была пострадать
    const octoberUntouched = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = '2026-10-01'`, [employeeA1.id]);
    expect(octoberUntouched.rows.length).toBe(1);

    const audit = await query(`SELECT * FROM audit_log WHERE org_id = $1 AND action = 'SCHEDULE_STORE_MONTH_CLEARED' ORDER BY id DESC LIMIT 1`, [orgA]);
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].after).toMatchObject({ deleted_count: 3 });
  });

  it('пустой месяц — preview показывает 0, очистка ничего не делает', async () => {
    const app = await getApp();
    const preview = await app.inject({
      method: 'GET', url: `/admin/schedules/clear-store-month/preview?store_id=${storeA}&month=2027-01`,
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken)
    });
    expect(preview.json()).toMatchObject({ count: 0 });

    const clear = await app.inject({
      method: 'POST', url: '/admin/schedules/clear-store-month',
      headers: authAs(adminA.telegramId, adminA.telegramGrantToken),
      payload: { store_id: storeA, month: '2027-01', reason: 'test' }
    });
    expect(clear.json()).toMatchObject({ deletedCount: 0 });
  });
});
