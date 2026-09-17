SET LOCAL search_path TO public;

-- Admin Control Center, Phase 4+ — Feature Flags (new infrastructure, no
-- existing table to build on). One row per (key, org_id): org_id NULL is
-- the platform-wide default, a non-NULL org_id is a per-org override that
-- wins over the default (see core/shared/feature-flags.ts's
-- findEffective()). Uniqueness is on (key, COALESCE(org_id, '')), not a
-- plain UNIQUE(key, org_id) column constraint — Postgres treats NULL as
-- distinct from NULL in a regular unique constraint, which would allow
-- duplicate global (org_id IS NULL) rows for the same key and break
-- upsert()'s ON CONFLICT target.

CREATE TABLE IF NOT EXISTS feature_flags (
  id serial PRIMARY KEY,
  key text NOT NULL,
  org_id text REFERENCES organizations(id),
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_by bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_key_org_idx
  ON feature_flags (key, COALESCE(org_id, ''));
