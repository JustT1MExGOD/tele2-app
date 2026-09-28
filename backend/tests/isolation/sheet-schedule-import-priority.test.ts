/**
 * Google Sheets schedule import — проверяет саму гарантию, ради которой
 * заведён schedules.source: правка внутри приложения (upsert) навсегда
 * защищает строку от последующего импорта (upsertFromSheet/
 * deleteOneFromSheet), пока строку снова не тронут руками. См.
 * docs/SHEET-SCHEDULE-IMPORT.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/data/db/index.js';
import * as schedulesRepo from '../../src/data/repositories/schedules.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('sheet schedule import — приоритет ручной правки над импортом', () => {
  const fx = new TestFixtures();
  let orgId: string;
  let storeId: string;
  let employeeId: number;

  beforeEach(async () => {
    orgId = await fx.createOrg();
    storeId = await fx.createStore(orgId);
    employeeId = (await fx.createEmployee(orgId)).id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it('импорт из таблицы создаёт строку с source=sheet_import', async () => {
    const row = await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    expect(row).not.toBeNull();
    expect(row.source).toBe('sheet_import');
    expect(row.hours).toBe(12);
  });

  it('повторный импорт обновляет строку, пока её не тронули руками', async () => {
    await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    const row2 = await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '9-21', 12);
    expect(row2).not.toBeNull();
    expect(row2.shift_text).toBe('9-21');
  });

  it('ручная правка (upsert) переводит строку в source=manual и защищает её от импорта', async () => {
    await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    const manual = await schedulesRepo.upsert(employeeId, storeId, '2026-09-10', '9-18', 9);
    expect(manual.source).toBe('manual');

    // Импорт пытается перезаписать другими часами — должен быть отклонён (null), данные не тронуты.
    const rejected = await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    expect(rejected).toBeNull();

    const res = await query(`SELECT shift_text, hours, source FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-10']);
    expect(res.rows[0]).toMatchObject({ shift_text: '9-18', hours: 9, source: 'manual' });
  });

  it('deleteOneFromSheet удаляет только sheet_import-строки, не трогает manual', async () => {
    await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-11', '10-22', 12);
    const deleted1 = await schedulesRepo.deleteOneFromSheet(employeeId, '2026-09-11');
    expect(deleted1).toBe(true);

    await schedulesRepo.upsert(employeeId, storeId, '2026-09-12', '10-22', 12);
    const deleted2 = await schedulesRepo.deleteOneFromSheet(employeeId, '2026-09-12');
    expect(deleted2).toBe(false);
    const res = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-12']);
    expect(res.rows.length).toBe(1);
  });
});
