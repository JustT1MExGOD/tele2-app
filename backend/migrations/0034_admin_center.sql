SET LOCAL search_path TO public;

-- Admin Control Center — sales void/restore + optimistic concurrency.
-- Forward-only, additive, non-destructive:
--
-- - voided_at/voided_by/void_reason: nullable "soft void" markers on a
--   sales day-row (employee+store+date aggregate — see
--   core/admin/sales-correction.ts for why there is no per-transaction
--   sale entity in this schema). A voided row stays in place, historically
--   visible, excluded from active aggregates by callers that care
--   (reporting/plans queries filter `voided_at IS NULL`) — never deleted.
-- - version: optimistic-concurrency token, bumped on every admin write to
--   the row (void/restore/store-correction), checked via
--   `WHERE id = $1 AND version = $2` so two admins editing the same row
--   get an explicit conflict instead of a silent overwrite.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by bigint;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS sales_voided_at_idx ON sales (voided_at) WHERE voided_at IS NOT NULL;
