/**
 * Google Sheets schedule import — вебхук + очередь подтверждения
 * end-to-end: секрет, точное совпадение (применяется сразу), нечёткое
 * совпадение (уходит в очередь, ничего не пишет в график), подтверждение
 * в Admin Center применяет отложенную строку.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

const SECRET = 'test-sheets-webhook-secret-only-for-this-file';

describe('Google Sheets schedule import — вебхук', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let storeId: string;
  let employeeId: number;
  let admin: { id: number; telegramId: number; telegramGrantToken?: string };
  const prevSecret = process.env.SHEETS_WEBHOOK_SECRET;

  beforeAll(async () => {
    process.env.SHEETS_WEBHOOK_SECRET = SECRET;
    orgId = await fx.createOrg('Sheet Import Org');
    storeId = await fx.createStore(orgId, 'Sheet Import Store');
    employeeId = (await fx.createEmployee(orgId, { fullName: 'Афанасьев Аким Александрович' })).id;
    admin = await fx.createEmployee(orgId, { role: 'admin' });
  });

  afterAll(async () => {
    process.env.SHEETS_WEBHOOK_SECRET = prevSecret;
    await query(`DELETE FROM sheet_schedule_pending WHERE org_id = $1`, [orgId]);
    await query(`DELETE FROM sheet_schedule_mappings WHERE org_id = $1`, [orgId]);
    await fx.cleanup();
  });

  it('без секрета в заголовке — 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      payload: { org_id: orgId, store_id: storeId, employee_name: 'кто угодно', work_date: '2026-09-05', shift_raw: '10-22' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('точное совпадение имени — применяется сразу, в очередь не попадает', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: storeId, employee_name: 'афанасьев аким александрович', work_date: '2026-09-05', shift_raw: '10-22' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'applied' });

    const row = await query(`SELECT hours, source FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-05']);
    expect(row.rows[0]).toMatchObject({ hours: 12, source: 'sheet_import' });
  });

  it('нечёткое совпадение (опечатка) — уходит в очередь, график не меняется', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: storeId, employee_name: 'Афонасьев Аким Александрович', work_date: '2026-09-06', shift_raw: '9-21' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending_confirmation');
    const pendingId = res.json().pendingId;

    const noRow = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-06']);
    expect(noRow.rows.length).toBe(0);

    const list = await app.inject({ method: 'GET', url: '/admin/sheet-import/pending', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items.some((i: any) => i.id === pendingId)).toBe(true);

    const confirm = await app.inject({
      method: 'POST', url: `/admin/sheet-import/pending/${pendingId}/confirm`,
      headers: authAs(admin.telegramId, admin.telegramGrantToken),
      payload: { employee_id: employeeId }
    });
    expect(confirm.statusCode).toBe(200);

    const row = await query(`SELECT hours, source FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-06']);
    expect(row.rows[0]).toMatchObject({ hours: 12, source: 'sheet_import' });

    // Тот же вариант написания снова приходит с вебхука — теперь уже как подтверждённый маппинг, без очереди.
    const res2 = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: storeId, employee_name: 'Афонасьев Аким Александрович', work_date: '2026-09-07', shift_raw: '10-22' }
    });
    expect(res2.json()).toEqual({ status: 'applied' });
  });

  it('пустой store_id на настоящей смене — skipped_no_store, ничего не пишет', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: '', employee_name: 'афанасьев аким александрович', work_date: '2026-09-08', shift_raw: '10-22' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'skipped_no_store' });
    const row = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-08']);
    expect(row.rows.length).toBe(0);
  });

  it('пустой store_id на выходном — применяется (точка тут не нужна)', async () => {
    const app = await getApp();
    // сначала создаём смену, чтобы было что удалить выходным
    await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: storeId, employee_name: 'афанасьев аким александрович', work_date: '2026-09-09', shift_raw: '10-22' }
    });
    const res = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: '', employee_name: 'афанасьев аким александрович', work_date: '2026-09-09', shift_raw: 'вых' }
    });
    expect(res.json()).toEqual({ status: 'applied' });
    const row = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-09']);
    expect(row.rows.length).toBe(0);
  });

  it('"Замена" (__REPLACEMENT__ вместо store_id) — применяется как обычная смена без точки', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST', url: '/integrations/sheets/schedule-webhook',
      headers: { 'x-sheets-webhook-secret': SECRET },
      payload: { org_id: orgId, store_id: '__REPLACEMENT__', employee_name: 'афанасьев аким александрович', work_date: '2026-09-10', shift_raw: '10-21' }
    });
    expect(res.json()).toEqual({ status: 'applied' });
    const row = await query(`SELECT store_id, hours, source FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-10']);
    expect(row.rows[0]).toMatchObject({ store_id: '__REPLACEMENT__', hours: 11, source: 'sheet_import' });
  });
});
