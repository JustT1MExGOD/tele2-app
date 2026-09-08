/**
 * Public surface of the `schedules` bounded context (20.58.0 architecture
 * split). Owns the applied-schedule aggregate (`schedules` table) and the
 * schedule-generator drafting capability (DRAFT -> VIEW -> APPLY) — the
 * generator is a capability inside this module, not a separate bounded
 * context (corr. #3), because it writes into `schedules` and shares its
 * domain vocabulary (editable horizon, weekday convention, shift-time
 * derivation).
 *
 * External modules must import from here (or from ports/read.ts for reads),
 * never from data/repositories/schedules.js, data/repositories/schedule-drafts.js,
 * or data/repositories/store-staffing.js directly.
 */
export { generateDraft } from './application/generate-draft.js';
export { viewDraft, applyDraft } from './application/apply-draft.js';
export { StaleDraftError, DraftHasBlockingErrorsError } from './application/errors.js';
export type { BlockingError } from './application/generate-draft.js';
export { defaultTargetMonth, monthStart, monthAdd, weekdayMonday0 } from './domain/weekday.js';
export { storeFullShiftHours, deriveShift } from './domain/shift-time.js';
export { computeEditableFromDateToday, resolveEditableFromDate } from './domain/editable-boundary.js';
export {
  tierAdjustedRate,
  type HistBucketsForTest,
  type MetricBucketForTest
} from './domain/history-scoring.js';
export { scheduleReads, type ScheduleReads } from './ports/read.js';
