-- 20.81.0 — account lockout, separate from distributed rate-limit.
-- One row per employee keeps consecutive failed primary-credential attempts
-- across restarts and instances. The application owns the threshold/window
-- policy; this table is state, not a second rate-limit counter.
CREATE TABLE IF NOT EXISTS public.security_account_lockouts (
  employee_id bigint PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_account_lockouts_locked_until
  ON public.security_account_lockouts (locked_until)
  WHERE locked_until IS NOT NULL;
