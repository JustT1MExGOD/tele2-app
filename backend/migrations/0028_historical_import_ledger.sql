SET LOCAL search_path TO public;
-- Historical data import (2026-04-01..2026-07-31) — Implementation Phase 1.
-- schedules.employee_id/work_date already has a unique constraint since
-- baseline (schedules_employee_date_uq) — verified against production,
-- nothing to add there. The only new structural piece needed is an
-- append-only ledger recording exactly what the importer wrote, so any
-- historical row can be traced back to its source and, if needed, rolled
-- back.

CREATE TABLE IF NOT EXISTS import_ledger (
    id bigserial PRIMARY KEY,
    batch_id text NOT NULL,
    entity text NOT NULL,
    natural_key jsonb NOT NULL,
    operation text NOT NULL CHECK (operation IN ('insert', 'update')),
    before_state jsonb,
    after_state jsonb NOT NULL,
    source_row jsonb NOT NULL,
    applied_at timestamp with time zone NOT NULL DEFAULT now(),
    rolled_back_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS import_ledger_batch_id_idx ON import_ledger (batch_id);
CREATE INDEX IF NOT EXISTS import_ledger_entity_idx ON import_ledger (entity);
CREATE INDEX IF NOT EXISTS import_ledger_natural_key_idx ON import_ledger USING gin (natural_key jsonb_path_ops);
