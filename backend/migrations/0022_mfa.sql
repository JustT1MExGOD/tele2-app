-- 0022_mfa.sql
--
-- Strong MFA for privileged users (admin/supervisor mandatory, others
-- optional) — WebAuthn/passkey first, TOTP as compatible fallback,
-- recovery codes as last resort. Both TOTP secrets and recovery-code
-- hashes never leave this migration's tables in plaintext; TOTP secret
-- is protected by the existing Application-Level Envelope Encryption
-- layer (backend/src/security/crypto/**, see 0021), same KEK
-- infrastructure, own AAD context so a TOTP envelope can never be
-- swapped for a support-ticket envelope or vice versa.
--
-- Step-up auth ("recent proof of possession for THIS dangerous action")
-- is channel-agnostic by design (mfa_step_up_tickets) — it works the
-- same way whether the admin is authenticated via Telegram initData
-- (no persistent session to attach freshness to) or a browser
-- employee_sessions row. See docs/ADR/009-mfa.md.

-- Session-level "was MFA completed at all during this browser session"
-- (AAL2) — separate concept from step-up (AAL3, per-action freshness).
ALTER TABLE public.employee_sessions ADD COLUMN mfa_verified_at timestamptz;

CREATE TABLE public.employee_totp (
  employee_id bigint PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  secret_encrypted jsonb NOT NULL,
  confirmed_at timestamptz,
  -- otplib replay protection (RFC 6238 time-step counter of the last
  -- accepted code, not a timestamp) — a code accepted once cannot be
  -- accepted again even if resubmitted within the same/earlier window.
  last_time_step bigint,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE public.employee_webauthn_credentials (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  device_name text,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (credential_id)
);
CREATE INDEX idx_webauthn_creds_employee_active ON public.employee_webauthn_credentials(employee_id) WHERE revoked_at IS NULL;

CREATE TABLE public.employee_recovery_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  batch_id integer NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (code_hash)
);
CREATE INDEX idx_recovery_codes_employee_batch ON public.employee_recovery_codes(employee_id, batch_id) WHERE used_at IS NULL;

-- Password verified, MFA not yet verified — a login is "half-open" in
-- this state; token is opaque, single-use, short-lived, never a
-- substitute for the real session cookie (no employee_sessions row is
-- created until MFA succeeds).
CREATE TABLE public.mfa_pending_logins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (token_hash)
);

-- WebAuthn ceremony challenges — registration (enrollment, already
-- logged in) and authentication (either login-time MFA or step-up).
-- Single-use (consumed_at), short expiry, exactly the properties
-- @simplewebauthn/server's verify* functions require the caller to
-- enforce themselves (the library does not persist challenges).
CREATE TABLE public.mfa_webauthn_challenges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('register', 'authenticate')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Step-up ("fresh MFA proof for this specific dangerous action") —
-- channel-agnostic opaque bearer ticket, works identically for
-- Telegram- and browser-authenticated admins since neither path is
-- assumed to carry usable freshness state on every request the same
-- way (Telegram has no server-side session at all).
CREATE TABLE public.mfa_step_up_tickets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (token_hash)
);
