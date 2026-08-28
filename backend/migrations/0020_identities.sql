-- 0020_identities.sql
--
-- Web Security & Trust Layer, часть 1 (Auth & Session Security) —
-- schema-level identity abstraction, порог, который ADR-005 дважды
-- откладывал ("один provider не оправдывает схему"). Providers сегодня
-- два (telegram/phone), но КАНАЛОВ использования — три (Telegram Mini
-- App, телефон-браузер, standalone PWA) — реальная причина перехода.
--
-- employees.telegram_id/phone/password_hash НЕ убираются — используются
-- вне auth-boundary (бот-уведомления по telegram_id, отображение в
-- Команде и т.д.). identities — новый, additive resolution-слой именно
-- для auth (principal.ts::loadUser()), backfill из уже существующих
-- sibling-колонок.
CREATE TABLE public.identities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('telegram','phone')),
  provider_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Один provider_key — один сотрудник; один сотрудник — максимум одна
  -- identity на provider (формализует уже существующую 1:1 реальность
  -- employees.telegram_id/phone как колонок, не новое ограничение).
  UNIQUE (provider, provider_key),
  UNIQUE (employee_id, provider)
);
CREATE INDEX idx_identities_employee ON public.identities(employee_id);

-- Нормализация employees.phone ДО backfill — сырые значения сегодня не
-- канонизированы ("+7 999...", "8999...", "+79991234567" могут описывать
-- один номер тремя строками). Тот же алгоритм зеркалится в TypeScript —
-- src/utils/phone.ts::normalizePhone() — держать оба места в синхроне.
UPDATE public.employees SET phone = regexp_replace(phone, '[^0-9+]', '', 'g') WHERE phone IS NOT NULL;
UPDATE public.employees SET phone = '+7' || substring(phone from 2) WHERE phone ~ '^8\d{10}$';
UPDATE public.employees SET phone = '+7' || phone WHERE phone ~ '^\d{10}$';
UPDATE public.employees SET phone = '+' || phone WHERE phone ~ '^7\d{10}$' AND phone !~ '^\+';
-- Нераспознанный формат — не гадаем, обнуляем явно (не блокируем всю
-- миграцию из-за одной "битой" исторической строки; отличается от
-- дублей ниже, которые ДОЛЖНЫ остановить деплой).
UPDATE public.employees SET phone = NULL WHERE phone IS NOT NULL AND phone !~ '^\+7\d{10}$';

-- Preflight: миграция ПАДАЕТ (откатывается целиком — db/migrate.ts уже
-- оборачивает каждый файл в BEGIN/COMMIT/ROLLBACK), если нормализация
-- схлопнула два разных employees.phone в один — ручное разрешение
-- оператором лучше, чем молчаливая потеря строки при backfill ниже.
DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT phone FROM public.employees WHERE phone IS NOT NULL GROUP BY phone HAVING count(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Phone normalization produced % duplicate(s) in employees.phone — resolve manually before this migration can proceed', dup_count;
  END IF;
END $$;

INSERT INTO public.identities (employee_id, provider, provider_key)
SELECT id, 'telegram', telegram_id::text FROM public.employees WHERE telegram_id IS NOT NULL;
INSERT INTO public.identities (employee_id, provider, provider_key)
SELECT id, 'phone', phone FROM public.employees WHERE phone IS NOT NULL;
