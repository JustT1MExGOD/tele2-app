SET LOCAL search_path TO public;

-- Admin Control Center, Phase 4+ — shift/schedule/plan admin corrections.
-- Forward-only, additive, non-destructive. Mirrors 0034_admin_center.sql's
-- sales.version/voided_* pattern:
--   - version: optimistic-concurrency token, bumped only by the new admin
--     correction path (never by ordinary manager upserts) — same
--     WHERE id=$1 AND version=$2 idiom as sales.
--   - shift_sessions gets the full soft-void trio (voided_at/voided_by/
--     void_reason) — shifts are soft-voided like sales, only ever on
--     closed/auto_closed sessions.
--   - schedules and the two plan tables get ONLY version: schedules'
--     "void" is a version-gated hard delete (no soft-delete precedent,
--     no read call site benefits from one); plans have no void concept
--     at all (zeroing every metric already models "no plan").

ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS voided_by bigint;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS shift_sessions_voided_at_idx ON shift_sessions (voided_at) WHERE voided_at IS NOT NULL;

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE employee_month_plans ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE store_month_plans ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
