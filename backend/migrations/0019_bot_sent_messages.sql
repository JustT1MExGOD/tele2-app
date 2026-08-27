-- 0019_bot_sent_messages.sql
--
-- Владелец продукта выдал боту admin-права и доступ к сообщениям в
-- Telegram и попросил: бот должен сам подчищать за собой сообщения,
-- отправленные 2+ дня назад — везде, где бот пишет в группы/каналы
-- (отчёты точек, алерты, дайджесты, продажи/смены), но не в релиз-канал
-- (анонсы версий — тот остаётся архивом истории навсегда).
--
-- Ни (chat_id, message_id, sent_at) отправленных сообщений, ни
-- bot.api.deleteMessage нигде в проекте раньше не использовались —
-- полностью новая возможность. Таблица самоограничена по размеру: cron
-- (src/cron/message-cleanup.ts) удаляет каждую обработанную строку сразу
-- после попытки, история не копится.
-- message_id — integer, не bigint: реальный диапазон Telegram message_id
-- умещается в int32 с запасом, а node-postgres отдаёт bigint строкой (не
-- JS number) из-за потенциального переполнения Number.MAX_SAFE_INTEGER —
-- integer читается сразу как нормальное число, без ручного Number(...) на
-- каждый вызов repository/cron.
CREATE TABLE public.bot_sent_messages (
    id bigserial PRIMARY KEY,
    chat_id text NOT NULL,
    message_id integer NOT NULL,
    sent_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX bot_sent_messages_sent_at_idx ON public.bot_sent_messages (sent_at);
