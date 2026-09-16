SET LOCAL search_path TO public;

-- Session device/location metadata for the self-service "active sessions"
-- display (mirrors Telegram's own device list) — additive, nullable,
-- captured once at session creation (login/mfa-login/password-reset) from
-- the request's User-Agent and IP; city/country resolved offline via
-- MaxMind GeoLite2-City (see src/integrations/geoip/). Never backfilled
-- for pre-existing sessions, never re-resolved later even if the DB is
-- refreshed — a session's own creation-time snapshot, same spirit as
-- sales_audit's before/after values.
ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE employee_sessions ADD COLUMN IF NOT EXISTS country_code text;
