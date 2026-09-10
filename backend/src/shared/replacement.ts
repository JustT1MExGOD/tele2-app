/**
 * Sentinel `schedules.store_id` value for a manager-scheduled "Замена"
 * placeholder — the manager knows the employee needs to work a
 * replacement shift that day but doesn't yet know which store. `stores.id`
 * is manager-chosen free text (usually matching the store code), so this
 * uses double underscores to make an accidental collision with a real
 * store id effectively impossible; `schedules.store_id` itself has no FK
 * (plain nullable text, see migrations/0001_baseline.sql), so storing this
 * value needs no schema change.
 *
 * Bound to the real store automatically once the employee actually opens a
 * shift for that date (see data/repositories/schedules.ts::bindReplacementPlaceholder,
 * called from POST /shifts/open) — this value is only ever meant to be a
 * short-lived planning placeholder, never the store of an actually-worked
 * day.
 *
 * Shared between backend and frontend (frontend/src imports this file
 * directly, same as shared/api-types.ts) so both sides agree on the exact
 * literal without duplicating it.
 */
export const REPLACEMENT_PLACEHOLDER_STORE_ID = '__REPLACEMENT__';
