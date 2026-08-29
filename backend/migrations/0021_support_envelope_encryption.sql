-- 0021_support_envelope_encryption.sql
--
-- Application-Level Envelope Encryption (Web Security & Trust Layer,
-- Phase B) — первый реальный потребитель backend/src/security/crypto/*.
-- Аудит (repo-wide documentation audit, 20.50.1) нашёл, что ни одна
-- существующая freeform-text фича в продукте не является приватной
-- перепиской между двумя людьми (channels/task_comments/announcements —
-- team/org-wide broadcast по дизайну; support-тикеты — admin ДОЛЖЕН
-- видеть содержимое, это и есть фича поддержки). Значит true E2EE
-- (Level 3) сегодня нечего защищать — но support-тикеты остаются
-- реальным кандидатом на Level 2 (envelope encryption): текст жалобы/
-- переписки сотрудника не должен читаться из сырого DB dump, при этом
-- admin по-прежнему расшифровывает его на лету через тот же KEK, что
-- держит backend.
--
-- Новые колонки — nullable jsonb, старые text-колонки НЕ удаляются и
-- НЕ теряют NOT NULL: `message`/`admin_reply`/`body` продолжают
-- существовать для обратной совместимости и для уже накопленных строк
-- (эта миграция не переписывает историю, не шифрует задним числом).
-- Репозиторный слой (data/repositories/support.ts) сам решает, в какую
-- колонку писать реальный текст, а какую заполнить нейтральным
-- плейсхолдером — это прикладная логика, не место миграции.
ALTER TABLE public.support_tickets ADD COLUMN message_encrypted jsonb;
ALTER TABLE public.support_tickets ADD COLUMN admin_reply_encrypted jsonb;
ALTER TABLE public.support_messages ADD COLUMN body_encrypted jsonb;
