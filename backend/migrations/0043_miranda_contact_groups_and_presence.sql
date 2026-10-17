-- T2 Miranda — личные группы контактов + статус "в сети"/"не в сети".
--
-- presence_override: NULL значит "авто" (онлайн, если у аккаунта есть
-- хотя бы одно живое WS-соединение в мессенджере — см.
-- connectionCountForAccount в core/messenger/realtime-registry.ts).
ALTER TABLE public.corporate_accounts
  ADD COLUMN presence_override text CHECK (presence_override IN ('online', 'offline'));

-- Группы — личный контакт-лист каждого corporate_account (как папки в
-- легаси Miranda NG), не общесетевые сущности.
CREATE TABLE public.miranda_contact_groups (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES public.organizations(id),
  owner_corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_corporate_account_id, name)
);
CREATE INDEX idx_miranda_contact_groups_owner ON public.miranda_contact_groups(owner_corporate_account_id);

CREATE TABLE public.miranda_contact_group_members (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.miranda_contact_groups(id) ON DELETE CASCADE,
  member_corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, member_corporate_account_id)
);
CREATE INDEX idx_miranda_contact_group_members_group ON public.miranda_contact_group_members(group_id);
