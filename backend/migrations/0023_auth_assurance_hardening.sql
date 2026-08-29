-- 0023_auth_assurance_hardening.sql
--
-- Auth Assurance Hardening (20.52.1) — §11: bind a step-up ticket to the
-- browser/phone session that requested it, where one exists, so a stolen
-- ticket cannot be replayed from a DIFFERENT session of the same
-- employee. NULL for Telegram-issued tickets (no session object exists
-- for that channel at all, ADR-005) — the ticket stays employee-scoped
-- only there, same as before this migration.
ALTER TABLE public.mfa_step_up_tickets ADD COLUMN session_token_hash text;
