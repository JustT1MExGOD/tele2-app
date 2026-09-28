/**
 * Google Sheets -> график: разбор одного события правки ячейки (одна
 * ячейка одной строки/даты), пришедшего с Apps Script вебхука
 * (api/routes/integrations/sheets-webhook.ts). См. docs/SHEET-SCHEDULE-IMPORT.md
 * для установки скрипта на стороне таблицы и общей схемы.
 *
 * Приоритет (бриф пользователя, дословно): "изменения внутри бота
 * [приложения] являются более приоритетными" — реализовано на
 * schedules.source (см. data/repositories/schedules.ts::upsertFromSheet):
 * импорт никогда не перезаписывает строку графика, которую последним
 * трогали руками внутри приложения.
 *
 * Сопоставление сотрудника (бриф: "нечёткое совпадение с подтверждением"):
 * точное совпадение имени (после normalizeName) подтверждается
 * автоматически и запоминается; нечёткое — уходит в
 * sheet_schedule_pending и ждёт разбора в Admin Center (routes/admin/
 * sheet-import.ts), НИЧЕГО не записывая в график, пока админ не выберет
 * сотрудника.
 */
import * as employeesRepo from '../../data/repositories/employees.js';
// schedules — bounded context owned by core/schedules/, never data/repositories/schedules.js directly (check:architecture).
import { upsertFromSheet, deleteOneFromSheet } from '../schedules/index.js';
import * as mappingsRepo from '../../data/repositories/sheet-schedule-import.js';
import { findBestMatch, normalizeName } from './sheet-name-match.js';
import { parseShiftCell } from './sheet-shift-parse.js';

export interface SheetScheduleEvent {
  orgId: string;
  storeId: string;
  employeeNameRaw: string;
  workDate: string;
  shiftRaw: string;
}

export type SheetImportOutcome =
  | { status: 'applied' }
  | { status: 'skipped_manual' }
  | { status: 'skipped_unparseable' }
  | { status: 'skipped_no_store' }
  | { status: 'pending_confirmation'; pendingId: number };

export async function importSheetScheduleEvent(ev: SheetScheduleEvent): Promise<SheetImportOutcome> {
  const employeeId = await resolveEmployeeId(ev);
  if (employeeId === 'pending') {
    const pending = await createPendingRow(ev);
    return { status: 'pending_confirmation', pendingId: pending.id };
  }

  return applyToSchedule(employeeId, ev);
}

/** Возвращает employee_id, либо 'pending' если нужно подтверждение в Admin Center. */
async function resolveEmployeeId(ev: SheetScheduleEvent): Promise<number | 'pending'> {
  const confirmed = await findConfirmedMapping(ev.orgId, ev.employeeNameRaw);
  if (confirmed) return confirmed.employee_id;

  const candidates = await employeesRepo.listActiveNamesForOrg(ev.orgId);
  const match = findBestMatch(ev.employeeNameRaw, candidates);

  if (match?.exact) {
    // Точное совпадение — подтверждать в Admin Center нечего, запоминаем сразу.
    await mappingsRepo.createConfirmedMapping(ev.orgId, ev.employeeNameRaw, match.employeeId, null);
    return match.employeeId;
  }

  return 'pending';
}

async function createPendingRow(ev: SheetScheduleEvent) {
  const candidates = await employeesRepo.listActiveNamesForOrg(ev.orgId);
  const match = findBestMatch(ev.employeeNameRaw, candidates);
  return mappingsRepo.createPending({
    orgId: ev.orgId,
    storeId: ev.storeId || null,
    sheetNameRaw: ev.employeeNameRaw,
    workDate: ev.workDate,
    shiftRaw: ev.shiftRaw,
    candidateEmployeeId: match?.employeeId ?? null,
    candidateScore: match?.score ?? null
  });
}

/** Общий шаг "сотрудник уже известен -> применить ячейку к графику", используется и с ходу (сопоставление уверенное), и из Admin Center при подтверждении pending-строки. */
export async function applyToSchedule(employeeId: number, ev: Pick<SheetScheduleEvent, 'storeId' | 'workDate' | 'shiftRaw'>): Promise<SheetImportOutcome> {
  const parsed = parseShiftCell(ev.shiftRaw);
  if (parsed.kind === 'unparseable') return { status: 'skipped_unparseable' };

  if (parsed.kind === 'off') {
    // Выходной не привязан к точке — store_id тут не нужен и не используется.
    const deleted = await deleteOneFromSheet(employeeId, ev.workDate);
    return deleted ? { status: 'applied' } : { status: 'skipped_manual' };
  }

  // Настоящая смена требует точку — цвет ячейки в таблице не распознан
  // Apps Script'ом (см. docs/SHEET-SCHEDULE-IMPORT.md), писать в график
  // с пустым store_id нельзя.
  if (!ev.storeId) return { status: 'skipped_no_store' };

  const row = await upsertFromSheet(employeeId, ev.storeId, ev.workDate, parsed.shiftText, parsed.hours);
  return row ? { status: 'applied' } : { status: 'skipped_manual' };
}

/** Один нормализованный вариант написания имени может быть вписан в таблицу с разным по регистру/пробелам текстом — сравнение через normalizeName() делается здесь (core), не в репозитории (infrastructure не должна зависеть от core). */
async function findConfirmedMapping(orgId: string, sheetNameRaw: string) {
  const rows = await mappingsRepo.listMappingsForOrg(orgId);
  const target = normalizeName(sheetNameRaw);
  return rows.find((r) => normalizeName(r.sheet_name_raw) === target) || null;
}

export { normalizeName };
