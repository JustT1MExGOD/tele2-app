-- T2 Miranda, этап 1 (Этап A плана — аккаунты/устройства) — корпоративные
-- аккаунты и привязка устройств для отдельного мессенджер-приложения
-- "T2 Miranda", построенного поверх существующей identity/auth-модели T2
-- Sales, не рядом с ней. Ничего из существующих таблиц не меняется
-- разрушающе — только новые таблицы и одна nullable-колонка на
-- employee_sessions.
--
-- Корпоративный аккаунт — НЕ новый пользователь и не новый способ входа:
-- это адресуемая проекция уже существующего employee_id (+ контекст точки
-- для отображения, "Королёв · Космонавтов, 20А"). display_label никогда не
-- используется как идентификатор ни в одном запросе — везде только id.
CREATE TABLE IF NOT EXISTS public.corporate_accounts (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES public.organizations(id),
    employee_id bigint NOT NULL REFERENCES public.employees(id),
    store_id text REFERENCES public.stores(id),
    display_label text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT corporate_accounts_employee_store_unique UNIQUE (employee_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_corporate_accounts_org ON public.corporate_accounts (org_id);
CREATE INDEX IF NOT EXISTS idx_corporate_accounts_employee ON public.corporate_accounts (employee_id);

-- Устройство — новая сущность (её не было вообще, см. 0026_chat.sql, явно
-- отказавшийся от sender_device_id в MVP чата). device_secret_hash — тот
-- же принцип, что employee_sessions.token_hash: сырой секрет никогда не
-- попадает в БД, только sha256; секрет сам хранится на клиенте через уже
-- существующий DPAPI/Android Keystore механизм, не IMEI/MAC (ненадёжны и
-- недоступны на современных платформах как единственный якорь доверия).
CREATE TABLE IF NOT EXISTS public.miranda_devices (
    id bigserial PRIMARY KEY,
    device_secret_hash text NOT NULL UNIQUE,
    platform text NOT NULL CHECK (platform IN ('windows', 'android')),
    label text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    revoked_at timestamptz
);

-- Привязка устройство↔аккаунт с собственным жизненным циклом
-- (pending→active→revoked), отдельным от жизненного цикла самого
-- устройства — одно устройство может со временем получить привязки к
-- нескольким корпоративным аккаунтам (разные сотрудники/точки на одном
-- киоске), но только одна из них is_default (автологин при обычном
-- запуске; остальные — только через явное admin-переключение, см.
-- миранда-роуты/core).
CREATE TABLE IF NOT EXISTS public.miranda_device_bindings (
    id bigserial PRIMARY KEY,
    device_id bigint NOT NULL REFERENCES public.miranda_devices(id),
    corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
    is_default boolean NOT NULL DEFAULT true,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    approved_by_employee_id bigint REFERENCES public.employees(id),
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT miranda_device_bindings_device_account_unique UNIQUE (device_id, corporate_account_id)
);

CREATE INDEX IF NOT EXISTS idx_miranda_device_bindings_device ON public.miranda_device_bindings (device_id);
CREATE INDEX IF NOT EXISTS idx_miranda_device_bindings_account ON public.miranda_device_bindings (corporate_account_id);
-- Admin Control Center "Устройства Miranda" — список ожидающих подтверждения,
-- отфильтрованный по статусу; partial index покрывает именно эту выдачу.
CREATE INDEX IF NOT EXISTS idx_miranda_device_bindings_pending ON public.miranda_device_bindings (created_at) WHERE status = 'pending';

-- Явный allowlist "кому какой корпоративный аккаунт разрешено временно
-- использовать" — права на переключение — это ДАННЫЕ (явный грант),
-- никогда не выводятся из одной лишь роли admin на лету.
CREATE TABLE IF NOT EXISTS public.miranda_admin_account_grants (
    id bigserial PRIMARY KEY,
    admin_employee_id bigint NOT NULL REFERENCES public.employees(id),
    corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
    granted_by_employee_id bigint NOT NULL REFERENCES public.employees(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT miranda_admin_account_grants_admin_account_unique UNIQUE (admin_employee_id, corporate_account_id)
);

CREATE INDEX IF NOT EXISTS idx_miranda_admin_account_grants_admin ON public.miranda_admin_account_grants (admin_employee_id);

-- Активация корпоративного аккаунта — поле на уже существующей сессии
-- (employee_sessions), не параллельная система сессий. Nullable → полностью
-- обратно совместимо, существующие T2 Sales-сессии не замечают колонку.
ALTER TABLE public.employee_sessions
    ADD COLUMN IF NOT EXISTS active_corporate_account_id bigint REFERENCES public.corporate_accounts(id);
