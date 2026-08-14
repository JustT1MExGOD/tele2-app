-- Shift 2.0 (18.7): заметка для следующей смены на той же точке.
-- Отдельная колонка от self_report — self_report личный разбор смены
-- (для себя/AI), handover_note адресован конкретно следующему человеку.
ALTER TABLE public.shift_sessions ADD COLUMN handover_note text;
