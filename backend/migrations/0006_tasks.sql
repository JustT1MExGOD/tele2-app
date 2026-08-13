-- 0006_tasks.sql
--
-- 18.4 Tasks / Action System — замыкает цикл "данные -> alert -> action ->
-- task -> result", который Command Center (18.1) начал, но не заканчивал:
-- кнопки действий там только открывали существующие экраны, ничего не
-- создавали. Та же архитектура, что уже отработана на support_tickets +
-- support_messages (сущность со статусом + отдельный тред комментариев).
CREATE TABLE public.tasks (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL DEFAULT 'default',
    title text NOT NULL,
    description text,
    created_by bigint NOT NULL,
    assigned_to bigint NOT NULL,
    store_id text,
    alert_id bigint,
    priority text NOT NULL DEFAULT 'normal',
    status text NOT NULL DEFAULT 'open',
    due_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_assigned_to ON public.tasks (assigned_to) WHERE status IN ('open', 'in_progress');
CREATE INDEX idx_tasks_org_id ON public.tasks (org_id);

CREATE TABLE public.task_comments (
    id bigserial PRIMARY KEY,
    task_id bigint NOT NULL REFERENCES public.tasks(id),
    author_id bigint NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_comments_task_id ON public.task_comments (task_id);
