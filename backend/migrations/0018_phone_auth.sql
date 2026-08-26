-- 0018_phone_auth.sql
--
-- Не-Telegram вход (телефон + пароль) — второй параллельный identity
-- provider поверх шва, который 20.9.0 специально оставил для этого
-- (Identity{provider, providerId} → Principal, ADR-005). Причина: Telegram
-- в стране бизнеса работает только через VPN (риск доступности для ЛЮБОГО
-- сотрудника), плюс есть сотрудники, вообще не пользующиеся Telegram.
-- Telegram-путь не трогается — это чисто аддитивная колонка/таблицы.
--
-- Схема — колонки на employees, не отдельная identities-таблица: Telegram
-- уже живёт как employees.telegram_id, phone+password_hash — симметрично,
-- без новой абстракции ради одного дополнительного провайдера (ADR-005
-- сознательно отложил полную identity-модель именно до этого момента).
ALTER TABLE public.employees ADD COLUMN phone text;
ALTER TABLE public.employees ADD CONSTRAINT employees_phone_unique UNIQUE (phone);
ALTER TABLE public.employees ADD COLUMN password_hash text;

-- access_requests.telegram_id был NOT NULL — заявка теперь может прийти
-- по телефону, не только по Telegram; CHECK держит форму строки валидной
-- для каждого provider, а не только на уровне TypeScript.
ALTER TABLE public.access_requests ALTER COLUMN telegram_id DROP NOT NULL;
ALTER TABLE public.access_requests ADD COLUMN phone text;
ALTER TABLE public.access_requests ADD COLUMN password_hash text;
ALTER TABLE public.access_requests ADD COLUMN provider text NOT NULL DEFAULT 'telegram';
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_provider_shape_chk CHECK (
  (provider = 'telegram' AND telegram_id IS NOT NULL) OR
  (provider = 'phone' AND phone IS NOT NULL AND password_hash IS NOT NULL)
);

-- Сессия — непрозрачный токен, не JWT: в проекте сегодня нет сессий вообще
-- (Telegram identity перепроверяется заново на каждый запрос против свежей
-- подписи) — токен в БД с мгновенным revoke при деактивации сотрудника
-- ближе к этой уже принятой философии "не доверять устаревшему состоянию".
-- Хранится только sha256(token), как уже давно принято для password_hash —
-- нового подписывающего секрета не требуется.
CREATE TABLE public.employee_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz DEFAULT now()
);
CREATE INDEX idx_employee_sessions_employee ON public.employee_sessions(employee_id);

-- Сброс пароля — через админа (нет SMS-провайдера для self-service), тот
-- же токен-примитив, что сессия: одноразовый, с истечением, без
-- self-contained подписи.
CREATE TABLE public.employee_password_resets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by bigint REFERENCES public.employees(id),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
