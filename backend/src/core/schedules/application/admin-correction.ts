/**
 * Thin re-export of the admin-correction data-access functions from
 * data/repositories/schedules.js, mirroring core/plans/application/
 * read-model.ts's findEmployeeMonthPlanById/correctEmployeeMonthPlanMetric
 * pattern — this is the only allowed access path for core/admin/
 * schedule-correction.ts (architecture rule: schedules is an owned repo,
 * external core/** modules must go through core/schedules/index.js).
 */
import * as schedulesRepo from '../../../data/repositories/schedules.js';

export const findByIdForAdmin = schedulesRepo.findByIdForAdmin;
export const findScheduleForDateEmployee = schedulesRepo.findScheduleForDateEmployee;
export const deleteByIdVersioned = schedulesRepo.deleteByIdVersioned;
export const correctScheduleRow = schedulesRepo.correctScheduleRow;
