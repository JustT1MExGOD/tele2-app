-- T2 Miranda — заранее создаём личные корпоративные аккаунты для
-- действующих администраторов T2 Sales. Аккаунт остаётся привязанным к
-- тому же employee_id и org_id, поэтому Miranda использует существующую
-- identity сотрудника, а не создаёт отдельного пользователя.
--
-- store_id IS NULL означает личный аккаунт сотрудника. В исходной схеме
-- UNIQUE(employee_id, store_id) допускает несколько NULL store_id в PostgreSQL,
-- поэтому backfill использует явный NOT EXISTS вместо ON CONFLICT.

UPDATE public.corporate_accounts ca
SET org_id = e.org_id,
    display_label = COALESCE(ca.display_label, e.full_name),
    is_active = TRUE,
    device_exclusive = FALSE
FROM public.employees e
WHERE ca.employee_id = e.id
  AND ca.store_id IS NULL
  AND e.role = 'admin'
  AND e.is_active = TRUE
  AND e.access_status = 'active'
  AND e.org_id IS NOT NULL;

INSERT INTO public.corporate_accounts (
    org_id,
    employee_id,
    store_id,
    display_label,
    is_active,
    device_exclusive
)
SELECT
    e.org_id,
    e.id,
    NULL,
    e.full_name,
    TRUE,
    FALSE
FROM public.employees e
WHERE e.role = 'admin'
  AND e.is_active = TRUE
  AND e.access_status = 'active'
  AND e.org_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.corporate_accounts ca
    WHERE ca.employee_id = e.id
      AND ca.store_id IS NULL
  );
