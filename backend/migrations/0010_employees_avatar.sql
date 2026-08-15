-- 19.7 (батч 3, п.19): кастомная аватарка сотрудника. Railway — эфемерная
-- ФС, S3/CDN не подключены — храним байты прямо в Postgres.
ALTER TABLE public.employees ADD COLUMN avatar_data bytea;
ALTER TABLE public.employees ADD COLUMN avatar_mime text;
