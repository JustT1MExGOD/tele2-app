SET LOCAL search_path TO public;
-- Automatic monthly employee schedule generator (DRAFT -> APPLY). See
-- src/core/schedule/schedule-generator.ts for the algorithm. Mirrors the
-- employee_month_plan_drafts pattern (migration 0029) for status/staleness,
-- but the draft item unit here is the SHIFT, not the employee.

-- Coverage config per store. Resolution: an exact-date override wins over
-- the weekday default for the same store+date. A missing row (neither) is
-- a blocking configuration error at generation time, not required=0.
CREATE TABLE IF NOT EXISTS store_staffing_requirements (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    store_id text NOT NULL,
    weekday smallint NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Monday..6=Sunday
    specific_date date NULL,
    required_employees int NOT NULL CHECK (required_employees >= 0),
    max_trainees int NOT NULL DEFAULT 1 CHECK (max_trainees >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((weekday IS NULL) <> (specific_date IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS store_staffing_requirements_weekday_uq
    ON store_staffing_requirements (store_id, weekday) WHERE specific_date IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS store_staffing_requirements_date_uq
    ON store_staffing_requirements (store_id, specific_date) WHERE weekday IS NULL;
CREATE INDEX IF NOT EXISTS store_staffing_requirements_org_idx
    ON store_staffing_requirements (org_id, store_id);

-- Hard-constraint-relevant employee availability (unavailable/vacation),
-- plus schema-ready (but not yet UI-writable) preference kinds for a later
-- pass. Field combinations are validated per kind so an invalid row can
-- never be inserted.
CREATE TABLE IF NOT EXISTS employee_schedule_preferences (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    employee_id bigint NOT NULL REFERENCES employees(id),
    kind text NOT NULL CHECK (kind IN ('unavailable', 'vacation', 'preferred_day_off', 'preferred_work_day', 'preferred_store')),
    specific_date date NULL,
    weekday smallint NULL CHECK (weekday BETWEEN 0 AND 6),
    store_id text NULL,
    source text NOT NULL DEFAULT 'manual',
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by bigint REFERENCES employees(id),
    CHECK (
        (kind IN ('unavailable', 'vacation') AND specific_date IS NOT NULL AND weekday IS NULL AND store_id IS NULL)
        OR (kind IN ('preferred_day_off', 'preferred_work_day') AND weekday IS NOT NULL AND specific_date IS NULL AND store_id IS NULL)
        OR (kind = 'preferred_store' AND store_id IS NOT NULL AND specific_date IS NULL AND weekday IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS employee_schedule_preferences_employee_idx
    ON employee_schedule_preferences (employee_id, kind);
CREATE INDEX IF NOT EXISTS employee_schedule_preferences_date_idx
    ON employee_schedule_preferences (employee_id, specific_date) WHERE specific_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS schedule_drafts (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id),
    month date NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'stale')),
    input_fingerprint text NOT NULL,
    blocking_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    solver_status text NOT NULL CHECK (solver_status IN ('feasible', 'timeout_feasible', 'infeasible', 'config_error', 'solver_error')),
    editable_from_date date NOT NULL,
    score numeric,
    generated_at timestamptz NOT NULL DEFAULT now(),
    generated_by bigint REFERENCES employees(id),
    applied_at timestamptz,
    applied_by bigint REFERENCES employees(id),
    replace_mode text NULL
);

CREATE INDEX IF NOT EXISTS schedule_drafts_org_month_idx
    ON schedule_drafts (org_id, month, status);

CREATE TABLE IF NOT EXISTS schedule_draft_items (
    id bigserial PRIMARY KEY,
    draft_id bigint NOT NULL REFERENCES schedule_drafts(id) ON DELETE CASCADE,
    employee_id bigint NOT NULL REFERENCES employees(id),
    work_date date NOT NULL,
    store_id text NOT NULL,
    shift_text text NOT NULL,
    hours integer NOT NULL,
    predicted_score numeric,
    explanation jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS schedule_draft_items_draft_idx
    ON schedule_draft_items (draft_id);
CREATE INDEX IF NOT EXISTS schedule_draft_items_employee_idx
    ON schedule_draft_items (draft_id, employee_id);
