-- Ручной месячный план точки — независим от планов сотрудников (эпик 17.0,
-- "убрать доли, вносить планы по точкам вручную"). Зеркалит employee_month_plans,
-- только store_id вместо employee_id. Без FK на stores(id) — у stores нет
-- unique/PK на id (как и у store_cash/schedules), связь по конвенции.
-- Применяется вручную через psql по публичному прокси, как sql/sectors-networks.sql.

CREATE TABLE IF NOT EXISTS store_month_plans (
  id bigserial PRIMARY KEY,
  store_id text NOT NULL,
  month date NOT NULL,
  sim numeric DEFAULT 0,
  mnp numeric DEFAULT 0,
  pa numeric DEFAULT 0,
  combo numeric DEFAULT 0,
  phones numeric DEFAULT 0,
  accessories numeric DEFAULT 0,
  focus numeric DEFAULT 0,
  settings numeric DEFAULT 0,
  wink numeric DEFAULT 0,
  shpd numeric DEFAULT 0,
  insurance numeric DEFAULT 0,
  credit_request numeric DEFAULT 0,
  credit_issued numeric DEFAULT 0,
  plotter numeric DEFAULT 0,
  hb numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (store_id, month)
);
