/**
 * Public surface of the `plans` bounded context (20.58.0 architecture
 * split). Owns month-plan targets/facts (employee_month_plans,
 * store_month_plans) and the employee-plan-generator drafting capability
 * (DRAFT -> VIEW -> APPLY) — the generator is a capability inside this
 * module, not a separate bounded context (corr. #3).
 *
 * External modules must import from here (or from ports/read-model.ts for
 * reads), never from data/repositories/plans.js,
 * data/repositories/employee-plan-drafts.js, or
 * data/repositories/plan-batches.js directly.
 */
export * from './ports/read-model.js';
export {
  upsertEmployeeMonthPlan,
  upsertStoreMonthPlan
} from './application/read-model.js';
export {
  generateDraft,
  viewDraft,
  applyDraft,
  type BlockingError,
  type EmployeeDraftItem,
  type GenerateDraftResult
} from './application/employee-plan-draft.js';
export { defaultTargetMonth } from './scoring/date-helpers.js';
export {
  StaleDraftError,
  DraftHasBlockingErrorsError
} from './application/errors.js';
