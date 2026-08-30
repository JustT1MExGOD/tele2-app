-- 20.54.0, P1-A — distributed (Postgres-backed) rate-limit counters for
-- credential-verification endpoints. Fixed-window counters, keyed by an
-- opaque `bucket_key` the application composes (e.g. "login:ip:1.2.3.4"
-- or "mfa_verify:acct:123") — see backend/src/security/rate-limit.ts.
-- Complements (does not replace) the existing per-route in-memory
-- @fastify/rate-limit config in app.ts/routes: this table survives
-- process restarts and would work across multiple instances, which the
-- in-memory limiter cannot.
CREATE TABLE IF NOT EXISTS public.security_rate_limit_counters (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket_key, window_start)
);

-- Cleanup queries (self-triggered, see rate-limit.ts) scan by window_start.
CREATE INDEX IF NOT EXISTS idx_security_rate_limit_window ON public.security_rate_limit_counters (window_start);
