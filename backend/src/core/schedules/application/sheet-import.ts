/**
 * Thin re-export of the sheet-import data-access functions from
 * data/repositories/schedules.js, mirroring admin-correction.ts's pattern
 * — this is the only allowed access path for core/integrations/
 * sheet-schedule-import.ts (architecture rule: schedules is an owned
 * repo, external core/** modules must go through core/schedules/index.js).
 */
import * as schedulesRepo from '../../../data/repositories/schedules.js';

export const upsertFromSheet = schedulesRepo.upsertFromSheet;
export const deleteOneFromSheet = schedulesRepo.deleteOneFromSheet;
export const findRowForExport = schedulesRepo.findRowForExport;
