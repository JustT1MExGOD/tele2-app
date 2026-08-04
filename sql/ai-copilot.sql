-- 15.0.0 AI Copilot v1: аудит и хранение AI-генераций (summary смены, комментарий к просадке точки)
CREATE TABLE IF NOT EXISTS ai_audit (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,               -- 'shift_summary' | 'dip_comment'
  employee_id INTEGER,
  store_id TEXT,
  ref_date DATE,
  prompt TEXT,
  response TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_dip_lookup ON ai_audit (store_id, ref_date, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_employee ON ai_audit (employee_id, kind, created_at DESC);
