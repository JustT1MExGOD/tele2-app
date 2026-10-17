-- T2 Miranda — группы контактов становятся общими для всей сети (их
-- настраивает администратор — создание/переименование/удаление/состав —
-- через requireAdmin-роуты), а не личным контакт-листом каждого
-- corporate_account; плюс вложенность (группа внутри группы).
--
-- owner_corporate_account_id отражал "чей это личный список" — больше не
-- имеет смысла при общих группах; заменяется на created_by_employee_id
-- (чисто аудит, кто создал, не владение).
ALTER TABLE public.miranda_contact_groups
  ADD COLUMN parent_group_id bigint REFERENCES public.miranda_contact_groups(id) ON DELETE CASCADE,
  ADD COLUMN created_by_employee_id bigint REFERENCES public.employees(id);

UPDATE public.miranda_contact_groups g
SET created_by_employee_id = ca.employee_id
FROM public.corporate_accounts ca
WHERE ca.id = g.owner_corporate_account_id;

ALTER TABLE public.miranda_contact_groups
  DROP CONSTRAINT miranda_contact_groups_owner_corporate_account_id_name_key;
ALTER TABLE public.miranda_contact_groups
  DROP COLUMN owner_corporate_account_id;
DROP INDEX IF EXISTS idx_miranda_contact_groups_owner;

-- Сиблинги (в одном родителе, в одной сети) не дублируются по названию;
-- partial-индексы вместо NULLS NOT DISTINCT — совместимо с Postgres < 15.
CREATE UNIQUE INDEX miranda_contact_groups_org_root_name_key
  ON public.miranda_contact_groups(org_id, name) WHERE parent_group_id IS NULL;
CREATE UNIQUE INDEX miranda_contact_groups_org_parent_name_key
  ON public.miranda_contact_groups(org_id, parent_group_id, name) WHERE parent_group_id IS NOT NULL;
CREATE INDEX idx_miranda_contact_groups_parent ON public.miranda_contact_groups(parent_group_id);
