-- 0007_alerts_dedup_and_status.sql
--
-- 18.6 Alerts 2.0. insertAlertOnce() (services/alerts.ts) был SELECT-
-- проверкой и INSERT двумя отдельными шагами, не атомарно — тот же класс
-- гонки, что уже чинили дважды сегодня (17.16.0 cron-отчёты, 18.2.0 анонс
-- релиза): Railway держит старый контейнер живым, пока новый не пройдёт
-- healthcheck, оба тика (каждые 30 мин) могли увидеть "алерта ещё нет" и
-- оба вставить + оба уведомить admin. Похоже, это и есть источник жалобы
-- "менеджер получает 15 одинаковых alerts" из формулировки роадмапа, не
-- гипотеза. Прод проверен read-only на дубли перед миграцией — не нашлось,
-- накатывается безопасно.
--
-- Уникальный индекс с выражением created_at::date Postgres не разрешает
-- (STABLE, не IMMUTABLE — зависит от timezone сессии). Явная date-колонка,
-- тот же паттерн, что sales.sale_date/store_cash.cash_date — приложение
-- само проставляет дату по МСК (todayMoscow()), не полагаясь на приведение
-- типов в индексе.
ALTER TABLE public.smart_alerts ADD COLUMN alert_date date;
UPDATE public.smart_alerts SET alert_date = created_at::date WHERE alert_date IS NULL;
ALTER TABLE public.smart_alerts ALTER COLUMN alert_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.smart_alerts ALTER COLUMN alert_date SET NOT NULL;

CREATE UNIQUE INDEX idx_smart_alerts_dedup_open
  ON public.smart_alerts (store_id, alert_type, alert_date)
  WHERE status = 'open';

ALTER TABLE public.smart_alerts ADD COLUMN updated_at timestamptz DEFAULT now();
