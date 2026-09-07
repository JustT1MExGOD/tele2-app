SET LOCAL search_path TO public;
-- Additive migration: no historical facts are rewritten.
ALTER TABLE offline_sync_log ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS day_plan_snapshot jsonb;
ALTER TABLE shift_sessions ADD COLUMN IF NOT EXISTS close_result jsonb;
CREATE INDEX IF NOT EXISTS idx_chat_messages_org_id_live ON chat_messages(org_id,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_orphan_expiry ON chat_attachments(expires_at,id) WHERE message_id IS NULL;
-- Existing custom metrics must have matching store-month columns too.
DO $$ DECLARE m record; BEGIN
 FOR m IN SELECT id FROM plan_metrics WHERE id ~ '^[a-z][a-z0-9_]{0,29}$' LOOP
  EXECUTE format('ALTER TABLE store_month_plans ADD COLUMN IF NOT EXISTS %I numeric DEFAULT 0',m.id);
 END LOOP;
END $$;

-- Retryable report jobs. Sending to Telegram is at-least-once, not exactly-once.
CREATE TABLE IF NOT EXISTS report_jobs (
 key text PRIMARY KEY, due_at timestamptz NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text, completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_report_jobs_ready ON report_jobs(next_attempt_at,due_at)
 WHERE status IN ('pending','running');

ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_shift_date date;
