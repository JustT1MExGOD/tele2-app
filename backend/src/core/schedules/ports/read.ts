/**
 * Explicit read contract owned by the `schedules` module (20.58.0
 * architecture split, corr. #1: "must NOT be a cosmetic re-export barrel").
 * Every external module that needs applied-schedule data goes through this
 * interface — never through `data/repositories/schedules.js` directly (see
 * the global rule in docs/ARCHITECTURE.md: core/module-A must not import
 * data/repositories/module-B).
 *
 * This is a functional port (an object of typed functions), not a class you
 * inject — no DI framework, just an explicit named contract plus one
 * implementation, so ownership and dependency direction are structurally
 * enforced (the checker forbids importing `data/repositories/schedules.js`
 * from any `core/<other-module>/**`, not just by convention).
 */
import * as schedulesRepo from '../../../data/repositories/schedules.js';

export interface ScheduleReads {
  /** Applied shifts for one employee/store pair across a date range — used by employee-plan-generator's coverage math. */
  countShiftsByEmployeeStoreInRange(
    orgId: string, from: string, to: string
  ): ReturnType<typeof schedulesRepo.countShiftsByEmployeeStoreInRange>;
  /** Total worked days for an employee in a range — used by plans' remaining-shift math. */
  countWorkedInRange(
    employeeId: number, from: string, to: string
  ): ReturnType<typeof schedulesRepo.countWorkedInRange>;
  /** Historical headcount-per-day for stores — used by alerts' anomaly detection (understaffing explain factor). */
  findHeadcountHistory(
    storeIds: string[], beforeDate: string
  ): ReturnType<typeof schedulesRepo.findHeadcountHistory>;
  /** Scheduled headcount for a specific date — used by alerts' anomaly detection. */
  findHeadcountForDate(
    storeIds: string[], date: string
  ): ReturnType<typeof schedulesRepo.findHeadcountForDate>;
}

export const scheduleReads: ScheduleReads = {
  countShiftsByEmployeeStoreInRange: schedulesRepo.countShiftsByEmployeeStoreInRange,
  countWorkedInRange: schedulesRepo.countWorkedInRange,
  findHeadcountHistory: schedulesRepo.findHeadcountHistory,
  findHeadcountForDate: schedulesRepo.findHeadcountForDate
};
