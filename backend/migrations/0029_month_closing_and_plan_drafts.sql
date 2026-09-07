SET LOCAL search_path TO public;
-- Two features: (1) month-closing daily report, (2) automatic personal
-- month plan drafts.
--
-- (1) needs a real per-store opening time — audited this repo first:
-- stores.work_time is free text, never parsed anywhere (grep confirmed),
-- so it cannot drive a cron schedule. close_time_weekday/close_time_sunday
-- are the established working precedent for exactly this kind of per-store
-- schedule config (time columns, weekday/Sunday split, sensible default),
-- so open_time_* mirrors them exactly.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS open_time_weekday time NOT NULL DEFAULT '09:00';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS open_time_sunday time;

-- (2) DRAFT -> APPLY persistence for employee_month_plan generation.
-- One draft per (org, month); items hold the full per-employee explanation
-- as jsonb so the generator can support custom metrics without schema
-- changes. input_fingerprint captures the state of employee schedules and
-- store month plans at generation time, so a later re-check can detect
-- drift and block a stale apply.
CREATE TABLE IF NOT EXISTS employee_month_plan_drafts (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    month date NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'stale')),
    input_fingerprint text NOT NULL,
    blocking_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    generated_at timestamptz NOT NULL DEFAULT now(),
    generated_by bigint REFERENCES employees(id),
    applied_at timestamptz,
    applied_by bigint REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS employee_month_plan_drafts_org_month_idx
    ON employee_month_plan_drafts (org_id, month, status);

CREATE TABLE IF NOT EXISTS employee_month_plan_draft_items (
    id bigserial PRIMARY KEY,
    draft_id bigint NOT NULL REFERENCES employee_month_plan_drafts(id) ON DELETE CASCADE,
    employee_id bigint NOT NULL REFERENCES employees(id),
    total_shifts integer NOT NULL DEFAULT 0,
    by_store jsonb NOT NULL DEFAULT '[]'::jsonb,
    final_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (draft_id, employee_id)
);

CREATE INDEX IF NOT EXISTS employee_month_plan_draft_items_draft_idx
    ON employee_month_plan_draft_items (draft_id);
