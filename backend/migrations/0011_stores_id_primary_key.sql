-- 0011_stores_id_primary_key.sql
--
-- stores.id (текстовый slug точки, например "kalinina2") исторически не
-- имел ни PRIMARY KEY, ни UNIQUE — baseline-дамп (0001) объявляет его
-- просто `text NOT NULL`. Найдено при живой проверке нового error handler
-- (19.15.0): POST /stores с уже существующим id тихо создавал ВТОРУЮ
-- строку с тем же id вместо ожидаемого конфликта — INSERT ... RETURNING *
-- в routes-employees.ts не имел ON CONFLICT ровно потому, что дубликат id
-- никогда не должен быть возможен физически. Проверено на проде перед
-- миграцией — дублей и NULL нет (7 строк всего), накатывается чисто.
ALTER TABLE public.stores
  ADD CONSTRAINT stores_pkey PRIMARY KEY (id);
