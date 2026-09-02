-- 20.57.0, Internal Employee Chat (P0/MVP) — один общий чат сотрудников на
-- сеть (organizations.id, тот же org_id text scope, что уже используется
-- announcements.org_id/channels.org_id, employees.org_id). Найденный при
-- ревью существующий channels/channel_messages — это task-обсуждения
-- конкретного канала с due_at, без идемпотентности/курсорной пагинации/
-- вложений/realtime; сознательно НЕ расширяем его под чат (риск сломать
-- уже работающую фичу ради несвязанной семантики), а заводим отдельные
-- таблицы, переиспользуя тот же org_id-scoping idiom.
--
-- chat_messages.id используется как keyset-курсор пагинации напрямую
-- (bigserial, монотонно растёт вместе с created_at при INSERT — тай-брейк
-- по created_at никогда не понадобится), created_at всё равно хранится и
-- индексируется вместе с ним по образцу, который просил product owner.
--
-- client_message_id + UNIQUE(sender_employee_id, client_message_id) —
-- идемпотентность повторного POST при retry (нестабильная сеть/relay):
-- ON CONFLICT DO NOTHING в repositories/chat.ts, конкурентный дубликат
-- ловится на уровне constraint, не в коде.
--
-- content_type/encryption_version — нейтральные поля под будущий E2EE
-- (см. план, §28/§29 брифа): content_type реально используется уже сейчас
-- (различает обычный текст от системных сообщений в будущем), encryption_
-- version осознанно nullable и не используется НИКАКИМ кодом в этом
-- MVP — это ТОЛЬКО задел, чтобы сервер мог в будущем научиться отличать
-- ciphertext от plaintext без миграции схемы задним числом. sender_device_id
-- НЕ добавлен — в MVP нет multi-device концепции, добавлять его сейчас
-- было бы полем без единого читателя.
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES public.organizations(id),
    sender_employee_id bigint NOT NULL REFERENCES public.employees(id),
    client_message_id uuid NOT NULL,
    body text,
    content_type text NOT NULL DEFAULT 'text/plain',
    encryption_version smallint,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    CONSTRAINT chat_messages_client_message_id_unique UNIQUE (sender_employee_id, client_message_id),
    CONSTRAINT chat_messages_body_length CHECK (body IS NULL OR char_length(body) <= 5000)
);

-- Keyset-пагинация: WHERE org_id = $1 AND id < $cursor ORDER BY id DESC
-- LIMIT $n — id один покрывает и сортировку, и тай-брейк (см. комментарий
-- выше), created_at включён в индекс по образцу из брифа и для возможных
-- будущих time-range запросов, не для самого курсора.
CREATE INDEX IF NOT EXISTS idx_chat_messages_org_created ON public.chat_messages (org_id, created_at, id);

-- Вложения. message_id nullable — "prepared" вложение существует ДО
-- отправки сообщения (upload flow, §13 брифа: сначала загрузка, потом
-- POST /chat/messages с attachmentIds, потом связывание в транзакции).
-- expires_at — TTL для orphan cleanup (cron/chat-attachment-cleanup.ts):
-- ставится при создании, обнуляется в момент связывания с сообщением —
-- партиальный индекс ниже покрывает именно "ещё не связанные и просроченные".
CREATE TABLE IF NOT EXISTS public.chat_attachments (
    id bigserial PRIMARY KEY,
    org_id text NOT NULL REFERENCES public.organizations(id),
    message_id bigint REFERENCES public.chat_messages(id),
    uploader_employee_id bigint NOT NULL REFERENCES public.employees(id),
    storage_key text NOT NULL UNIQUE,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON public.chat_attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_org ON public.chat_attachments (org_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_orphan_expiry ON public.chat_attachments (expires_at) WHERE message_id IS NULL;

-- Байты вложения — отдельно от метаданных (core/chat/storage.ts::
-- PostgresBlobStorageAdapter), тем же обоснованием, что employees.avatar_data
-- (0010_employees_avatar.sql): Railway — эфемерная ФС, S3/CDN не подключены.
-- Отдельная таблица (не bytea-колонка на chat_attachments) — метаданные
-- (listing/pagination) никогда не тянут блоб случайно через SELECT *, и
-- будущая замена адаптера на настоящий S3-compatible storage не требует
-- трогать схему chat_attachments вообще, только реализацию адаптера.
CREATE TABLE IF NOT EXISTS public.chat_attachment_blobs (
    storage_key text PRIMARY KEY REFERENCES public.chat_attachments(storage_key) ON DELETE CASCADE,
    data bytea NOT NULL
);
