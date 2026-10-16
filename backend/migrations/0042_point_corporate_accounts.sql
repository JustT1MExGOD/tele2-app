-- T2 Miranda, этап B плана (вариант B) — аккаунты точек/касс с собственным
-- входом по телефону+паролю, независимым от employee_id. Без очереди
-- device-approval для этого типа аккаунта (осознанное решение владельца
-- продукта) — успешный логин сразу даёт сессию и доступ к мессенджеру.

ALTER TABLE public.corporate_accounts
  ALTER COLUMN employee_id DROP NOT NULL,
  ADD COLUMN phone text,
  ADD COLUMN password_hash text,
  ADD COLUMN account_name text;

ALTER TABLE public.corporate_accounts
  ADD CONSTRAINT corporate_accounts_kind_check CHECK (
    (employee_id IS NOT NULL AND phone IS NULL AND password_hash IS NULL AND account_name IS NULL)
    OR
    (employee_id IS NULL AND phone IS NOT NULL AND password_hash IS NOT NULL AND account_name IS NOT NULL)
  );

CREATE UNIQUE INDEX corporate_accounts_phone_unique ON public.corporate_accounts(org_id, phone) WHERE phone IS NOT NULL;

-- Точечный отправитель сообщения не имеет employee_id — actor для
-- аудита/forensics (sender_employee_id) становится NULL в этом случае,
-- отображаемый отправитель (sender_corporate_account_id) не меняется.
ALTER TABLE public.messenger_messages
  ALTER COLUMN sender_employee_id DROP NOT NULL;

CREATE TABLE public.corporate_account_sessions (
  id bigserial PRIMARY KEY,
  corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX corporate_account_sessions_account_idx ON public.corporate_account_sessions(corporate_account_id);
