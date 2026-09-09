/**
 * Explicit read contract owned by the `plans` module (20.58.0 architecture
 * split, corr. #1/#3 — this already WAS the informal read-model port most
 * external modules used via core/plans/service.js; formalized here as a
 * named, selective re-export so external modules import from ports/, not
 * from application/read-model.ts or data/repositories/plans.js directly).
 */
export {
  metricKeys,
  getEmployeeMonthFacts,
  getEmployeeShiftCount,
  getEmployeeRemainingShifts,
  getEmployeeMonthPlan,
  getStoreMonthPlan,
  getStoreMonthFacts,
  getMonthSummaryTable,
  getStoreMonthSummaryTable,
  getEmployeeDailyPlan,
  computeStoreDailyPlans,
  materializeStoreDailyPlans,
  monthStart,
  remainingDaysInMonth,
  METRICS,
  type Metric
} from '../application/read-model.js';
