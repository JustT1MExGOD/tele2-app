-- 0002_employees_telegram_id_unique.sql
--
-- employees.telegram_id раньше был только проиндексирован (idx_employees_telegram),
-- без UNIQUE. Вместе с тем, что /me/bind и approve заявки делают "снять
-- отовсюду, поставить на выбранную карточку" ДВУМЯ отдельными запросами
-- (не в транзакции), это race condition: два одновременных запроса могли
-- в теории оставить один telegram_id на двух карточках сразу, а
-- loadUser() (WHERE telegram_id = $1 LIMIT 1) резолвил бы в непредсказуемо
-- какую из них. Проверено на проде перед миграцией — дублей нет, накатывается
-- чисто. NULL разрешён многократно (обычное поведение UNIQUE в Postgres —
-- NULL не равен NULL), так что незанятые карточки миграция не затрагивает.
ALTER TABLE public.employees
  ADD CONSTRAINT employees_telegram_id_unique UNIQUE (telegram_id);
