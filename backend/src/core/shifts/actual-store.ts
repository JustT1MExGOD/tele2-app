/**
 * Actual-vs-planned store resolution for "current work" route handlers (My
 * Day, My Insight, day-plan split, live employee progress).
 *
 * Core rule (post-replacement-shift acceptance audit, corrective pass):
 * an active (open) shift_session is the source of truth for where an
 * employee is ACTUALLY working right now. `schedules` is the planned
 * assignment, used only as a same-date fallback when no active session
 * exists. This is deliberately scoped to single-employee "current work"
 * lookups — bulk supervisor/cron queries apply the identical rule directly
 * in SQL for performance (see supervisor-analytics.ts::findUnderperformingRaw,
 * cron.ts::findZeroSalesOnShift) rather than calling this helper in a loop.
 *
 * Forward-looking/planned functionality (schedule generation, staffing
 * requirements, "tomorrow's shifts" reminders, etc.) must stay schedule-based
 * and never call this helper.
 *
 * Never touches principal.orgId or bypasses org authorization — callers
 * keep applying their own guards/scope exactly as before.
 */
import * as shiftsRepo from '../../data/repositories/shifts.js';
import { scheduleReads } from '../schedules/index.js';

export interface ResolvedWorkStore {
  source: 'session' | 'schedule' | 'none';
  store_id: string | null;
  store_name: string | null;
  store_code: string | null;
  store_address: string | null;
  color: string | null;
  work_mode: string | null;
  shift_text: string | null;
  hours: number | null;
}

/**
 * Resolves the store an employee is actually working at for `date`:
 * - an open shift_session whose own work_date matches `date` wins (actual
 *   current work — includes REPLACEMENT and any other open session, since
 *   an open session is always ground truth for where the employee is);
 * - otherwise falls back to the `schedules` row for that date (planned
 *   assignment);
 * - otherwise `source: 'none'` (no active session, nothing planned either).
 */
export async function resolveActualOrScheduledStoreForDate(
  employeeId: number,
  date: string
): Promise<ResolvedWorkStore> {
  const [session, scheduled] = await Promise.all([
    shiftsRepo.findCurrentOpenWithStore(employeeId).catch(() => null),
    scheduleReads.findShiftWithStore(employeeId, date).catch(() => null)
  ]);

  if (session && session.store_id && session.work_date === date) {
    return {
      source: 'session',
      store_id: session.store_id,
      store_name: session.store_name ?? null,
      store_code: session.store_code ?? null,
      store_address: session.store_address ?? null,
      color: session.color ?? null,
      work_mode: session.work_mode ?? null,
      // shift_sessions carries no planned shift_text/hours — surface the
      // schedule's own (if any) alongside the actual store, same as before.
      shift_text: scheduled?.shift_text ?? null,
      hours: scheduled?.hours ?? null
    };
  }

  if (scheduled && scheduled.store_id) {
    return {
      source: 'schedule',
      store_id: scheduled.store_id,
      store_name: scheduled.store_name ?? null,
      store_code: scheduled.store_code ?? null,
      store_address: scheduled.store_address ?? null,
      color: scheduled.color ?? null,
      work_mode: null,
      shift_text: scheduled.shift_text ?? null,
      hours: scheduled.hours ?? null
    };
  }

  return {
    source: 'none',
    store_id: null, store_name: null, store_code: null, store_address: null,
    color: null, work_mode: null, shift_text: null, hours: null
  };
}
