-- 0003_org_scoping_indexes.sql
--
-- Найдено через EXPLAIN (ANALYZE, BUFFERS) на проде при разборе внешнего
-- security/perf-чеклиста: КАЖДЫЙ org-scoped запрос (их десятки — вся
-- изоляция по сети этого сеанса построена на WHERE COALESCE(org_id,
-- 'default') = $1) делает Seq Scan на stores/employees — индекса на org_id
-- не было вообще. При текущем масштабе (7 сотрудников, 7 точек)
-- незаметно (<0.1мс), но это ровно тот тип запроса, что упрётся первым
-- при росте до сотен сотрудников/точек — особенно там, где он выполняется
-- N раз в цикле (getLiveNetworkMap — 4 запроса на точку, calculateAllBFQ —
-- 4 запроса на сотрудника). Сами N+1-циклы намеренно НЕ трогаем сейчас —
-- premature optimization при текущих объёмах, только индексы (дёшево,
-- безопасно, чистый выигрыш без риска сломать логику).
CREATE INDEX idx_stores_org_id ON public.stores (org_id);
CREATE INDEX idx_employees_org_id ON public.employees (org_id) WHERE is_active = true;

-- sales/schedules по store_id+дате — тот самый паттерн из per-store циклов
-- (live-map, dashboard) — раньше store_id был проиндексирован только как
-- часть UNIQUE(employee_id, store_id, sale_date)/(employee_id, work_date),
-- бесполезно без ведущего employee_id.
CREATE INDEX idx_sales_store_date ON public.sales (store_id, sale_date);
CREATE INDEX idx_schedules_store_date ON public.schedules (store_id, work_date);
