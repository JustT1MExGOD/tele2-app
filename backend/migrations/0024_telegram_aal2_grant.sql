-- 0024_telegram_aal2_grant.sql
--
-- Full Security & Reliability Hardening (20.53.0), P0 §2 — closes the
-- Telegram privileged-MFA gap confirmed against 20.52.1: previously,
-- checkPrivilegedAssurance() treated "no session object" (the Telegram
-- channel, which has none — ADR-005) as license to accept "the account
-- HAS a confirmed factor" as sufficient AAL2 proof, without the factor
-- ever being verified for the CURRENT Telegram access context. A stolen
-- Telegram session (device theft, account takeover) could reach
-- privileged functionality on password/initData alone if the victim had
-- MFA configured, without the attacker ever proving the second factor.
--
-- This table is the Telegram-channel equivalent of employee_sessions.
-- mfa_verified_at for the browser channel — a short-lived, server-side,
-- opaque grant proving "this employee proved a second factor recently,
-- for this specific Telegram access context", not just "has one on
-- file". Same discipline as every other opaque-token table in this
-- schema: only a hash is stored, the raw value lives only in the
-- HttpOnly cookie the client holds.
CREATE TABLE public.mfa_telegram_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz DEFAULT now(),
  UNIQUE (token_hash)
);
CREATE INDEX idx_telegram_grants_employee ON public.mfa_telegram_grants(employee_id);
