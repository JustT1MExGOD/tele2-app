-- 0004_shift_sessions_one_open.sql
--
-- Найдено при разборе гонки в /shifts/open: "закрыть висящие open" (UPDATE
-- status='auto_closed') и последующий INSERT новой 'open'-сессии не были
-- атомарны друг с другом — два параллельных /shifts/open для одного
-- employee_id могли оба пройти UPDATE (ни одной строки 'open' на тот
-- момент) и оба вставить свою 'open'-строку, оставив сотрудника с двумя
-- одновременно "открытыми" сменами. Прод проверен через safe read-only
-- прокси перед накаткой — дублей нет, накатывается на чистые данные.
CREATE UNIQUE INDEX idx_shift_sessions_one_open_per_employee
  ON public.shift_sessions (employee_id) WHERE status = 'open';
