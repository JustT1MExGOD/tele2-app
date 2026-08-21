-- 0012_audit_log.sql
--
-- Общий лог чувствительных действий (19.23.0) — раньше был только узкий
-- sales_audit (правки метрик продаж) и ai_audit (промпты/ответы AI), не было
-- единой ленты для "кто что сделал" по остальным чувствительным операциям
-- (смена роли, деактивация сотрудника, изменение планов, экспорт). before/
-- after — jsonb-снимки состояния, не привязаны к конкретной таблице/схеме,
-- поэтому не FK на employees/stores и т.п. — target_type/target_id вместо
-- этого, свободная связка, как уже сделано в tasks.alert_id.
CREATE TABLE public.audit_log (
    id bigserial PRIMARY KEY,
    org_id text,
    actor_employee_id integer,
    actor_telegram_id bigint,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    before jsonb,
    after jsonb,
    request_id text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX audit_log_org_created_idx ON public.audit_log (org_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON public.audit_log (target_type, target_id);
