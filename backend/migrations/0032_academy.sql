SET LOCAL search_path TO public;

-- T2 Academy (redesigned onboarding/tutorial) — progress, XP and badges are
-- a deliberately SEPARATE namespace from production gamification
-- (employees.xp / xp_events / employee_badges): Academy completion must
-- never inflate a salesperson's real performance level/streak, and a
-- production performance badge must never look like a training one.
-- No FK on employee_id — matches employee_badges/xp_events' own existing
-- convention in this schema (see migrations/0001_baseline.sql).

CREATE TABLE IF NOT EXISTS academy_progress (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL,
  step_id text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_progress_emp_step
  ON academy_progress (employee_id, step_id);

CREATE TABLE IF NOT EXISTS academy_xp_events (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL,
  amount integer NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_xp_events_employee
  ON academy_xp_events (employee_id);

CREATE TABLE IF NOT EXISTS academy_badges (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL,
  code text NOT NULL,
  title text,
  earned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_badges_employee
  ON academy_badges (employee_id);

-- Contextual lessons ("Показать за 30 секунд?") — per-feature dismissal/
-- completion, independent of course step completion above (a contextual
-- lesson isn't necessarily part of any course's step list).
CREATE TABLE IF NOT EXISTS academy_contextual_dismissals (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL,
  context_id text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_contextual_emp_ctx
  ON academy_contextual_dismissals (employee_id, context_id);
