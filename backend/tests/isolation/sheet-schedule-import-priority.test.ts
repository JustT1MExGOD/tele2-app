/**
 * Google Sheets schedule import (Phase 2 — симметричная синхронизация):
 * таблица и приложение равноправны, побеждает тот, кто правил последним,
 * в обе стороны. schedules.source остаётся, но больше не защищает —
 * только учёт, кто из двух источников правил строку последним (и точка
 * невозврата для core/integrations/sheet-schedule-export.ts: пуш обратно
 * в таблицу шлёт только upsert(), никогда upsertFromSheet()). См.
 * docs/SHEET-SCHEDULE-IMPORT.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/data/db/index.js';
import * as schedulesRepo from '../../src/data/repositories/schedules.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('sheet schedule import — симметричная синхронизация (последний правил — тот и победил)', () => {
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

  it('повторный импорт обновляет строку', async () => {
    await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    const row2 = await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '9-21', 12);
    expect(row2).not.toBeNull();
    expect(row2.shift_text).toBe('9-21');
  });

  it('импорт из таблицы перезаписывает строку, даже если её до этого правили в приложении (source=manual) — приоритет полностью снят', async () => {
    await schedulesRepo.upsert(employeeId, storeId, '2026-09-10', '9-18', 9);
    const fromSheet = await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    expect(fromSheet).not.toBeNull();

    const res = await query(`SELECT shift_text, hours, source FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-10']);
    expect(res.rows[0]).toMatchObject({ shift_text: '10-22', hours: 12, source: 'sheet_import' });
  });

  it('ручная правка (upsert) перезаписывает строку, даже если её до этого правили из таблицы', async () => {
    await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-10', '10-22', 12);
    const manual = await schedulesRepo.upsert(employeeId, storeId, '2026-09-10', '9-18', 9);
    expect(manual.source).toBe('manual');
    expect(manual).toMatchObject({ shift_text: '9-18', hours: 9 });
  });

  it('deleteOneFromSheet удаляет строку безусловно, включая source=manual', async () => {
    await schedulesRepo.upsertFromSheet(employeeId, storeId, '2026-09-11', '10-22', 12);
    const deleted1 = await schedulesRepo.deleteOneFromSheet(employeeId, '2026-09-11');
    expect(deleted1).toBe(true);

    await schedulesRepo.upsert(employeeId, storeId, '2026-09-12', '10-22', 12);
    const deleted2 = await schedulesRepo.deleteOneFromSheet(employeeId, '2026-09-12');
    expect(deleted2).toBe(true);
    const res = await query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND work_date = $2`, [employeeId, '2026-09-12']);
    expect(res.rows.length).toBe(0);
  });
});
