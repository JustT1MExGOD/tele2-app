-- T2 Miranda, этап 2 плана (§4/§5) — диалоговый мессенджер поверх
-- corporate_account_id (не employee_id напрямую). Структура сознательно
-- копирует 0026_chat.sql (keyset-пагинация по bigserial id, идемпотентность
-- через UNIQUE(sender, client_message_id), вложения как отдельная
-- "prepared upload" строка с TTL до привязки, байты в отдельной bytea-
-- таблице — см. core/chat/storage.ts) — отличие по сути одно: участник и
-- отправитель адресуются через corporate_account_id, а не employee_id.
-- sender_employee_id на messenger_messages хранится ДОПОЛНИТЕЛЬНО (не
-- взамен) — это actor для аудита/forensics, см. §4 плана: "кто нажал
-- кнопку" и "от чьего имени показано" — два разных поля, никогда не путаются.

CREATE TABLE public.messenger_conversations (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES public.organizations(id),
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  title text,
  created_by_corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messenger_conversations_org_id_idx ON public.messenger_conversations(org_id);

CREATE TABLE public.messenger_conversation_members (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES public.messenger_conversations(id),
  corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- "Непрочитанные"/read-receipt (§4 плана) — курсор на последнее
  -- прочитанное этим участником сообщение, не отдельная таблица на
  -- каждое сообщение x участника (было бы O(messages*members) строк).
  last_read_message_id bigint,
  UNIQUE(conversation_id, corporate_account_id)
);
CREATE INDEX messenger_conversation_members_account_idx ON public.messenger_conversation_members(corporate_account_id);

CREATE TABLE public.messenger_messages (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES public.messenger_conversations(id),
  org_id text NOT NULL REFERENCES public.organizations(id),
  sender_corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  sender_employee_id bigint NOT NULL REFERENCES public.employees(id),
  client_message_id uuid NOT NULL,
  body text,
  content_type text NOT NULL DEFAULT 'text',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(sender_corporate_account_id, client_message_id)
);
CREATE INDEX messenger_messages_conversation_id_idx ON public.messenger_messages(conversation_id, id);

CREATE TABLE public.messenger_attachments (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL REFERENCES public.organizations(id),
  message_id bigint REFERENCES public.messenger_messages(id),
  uploader_corporate_account_id bigint NOT NULL REFERENCES public.corporate_accounts(id),
  storage_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX messenger_attachments_message_id_idx ON public.messenger_attachments(message_id);

-- Байты вложения — отдельная таблица, не bytea-колонка на метаданных
-- (0026_chat.sql применяет тот же приём): SELECT * на messenger_attachments
-- никогда случайно не тащит блоб.
CREATE TABLE public.messenger_attachment_blobs (
  storage_key text PRIMARY KEY REFERENCES public.messenger_attachments(storage_key) ON DELETE CASCADE,
  data bytea NOT NULL
);
