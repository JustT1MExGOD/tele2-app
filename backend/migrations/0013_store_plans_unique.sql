-- 0013_store_plans_unique.sql
--
-- materializeStoreDailyPlans() (services/plans.ts) вызывается и кроном в
-- 6:00 МСК, и синхронно сразу после правки плана точки (PUT
-- /plans/stores/:id/month) — раньше делала DELETE FROM store_plans WHERE
-- plan_date=$1, затем голые INSERT в цикле без ON CONFLICT. Без уникального
-- constraint'а на (store_id, plan_date) конкурентный вызов (правка плана
-- ровно в момент cron-прогона, или два менеджера сохраняют планы разных
-- точек одновременно) мог оставить дубликаты строк на одну точку/дату —
-- код, ожидающий ровно одну строку (getStoreMonthPlan-подобные запросы),
-- получал неопределённое поведение. Проверено на проде перед миграцией —
-- дублей нет (140 строк всего), накатывается чисто.
ALTER TABLE public.store_plans
  ADD CONSTRAINT store_plans_store_date_uq UNIQUE (store_id, plan_date);
