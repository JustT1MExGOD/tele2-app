-- Replacement shift mechanic: an employee may manually work a shift at a
-- same-sector foreign-org store ("замена"). shift_sessions gains the fields
-- needed to fix the actual work context for that shift — see
-- core/shifts/work-context.ts for how these are resolved/enforced.
--
-- Forward-only, additive, non-destructive:
--   - org_id: the ACTUAL org owning the worked store (not the employee's
--     home org) — backfilled for existing rows from stores.org_id so
--     historical data is queryable the same way going forward.
--   - work_mode: 'NORMAL' (store belongs to employee's own org) or
--     'REPLACEMENT' (same-sector foreign-org store). Defaults 'NORMAL' —
--     every existing row is unambiguously NORMAL (replacement never existed
--     before this migration).
--   - selection_source: 'SCHEDULE' (today's planned store, or a plain
--     store_id from the client — existing behavior) or 'MANUAL_CODE' (the
--     employee typed a store code). Defaults 'SCHEDULE' for existing rows.

ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'NORMAL';
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS selection_source text NOT NULL DEFAULT 'SCHEDULE';

ALTER TABLE shift_sessions
  ADD CONSTRAINT shift_sessions_work_mode_check CHECK (work_mode IN ('NORMAL', 'REPLACEMENT'));
ALTER TABLE shift_sessions
  ADD CONSTRAINT shift_sessions_selection_source_check CHECK (selection_source IN ('SCHEDULE', 'MANUAL_CODE'));

-- Backfill: derive org_id from the store actually worked, best-effort
-- (matches the COALESCE(org_id,'default') convention used everywhere else
-- in this codebase for stores without an explicit org).
UPDATE shift_sessions ss
SET org_id = COALESCE(st.org_id, 'default')
FROM stores st
WHERE st.id = ss.store_id AND ss.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_shift_sessions_store_date_mode
  ON shift_sessions (store_id, work_date, work_mode)
  WHERE work_mode = 'REPLACEMENT';
