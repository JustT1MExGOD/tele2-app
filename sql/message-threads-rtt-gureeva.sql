-- Роутинг по темам Telegram-групп (message_thread_id) + подключение второй
-- реальной сети РТТ Гуреева. Применяется вручную через psql по публичному
-- прокси, как sql/sectors-networks.sql. Идемпотентно — безопасно перезапускать.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sales_thread_id text,
  ADD COLUMN IF NOT EXISTS reports_thread_id text;

-- Переименование текущей сети
UPDATE organizations SET name = 'РТТ Бижонов', brand_name = 'РТТ Бижонов' WHERE id = 'default';

-- Новая сеть — тот же сектор (второго пока нет)
INSERT INTO organizations (id, name, brand_name, sector_id, chat_id, sales_thread_id, reports_thread_id)
VALUES ('rtt_gureeva', 'РТТ Гуреева', 'РТТ Гуреева', 'default', '-1003281984280', '29423', '13')
ON CONFLICT (id) DO UPDATE SET
  chat_id = EXCLUDED.chat_id,
  sales_thread_id = EXCLUDED.sales_thread_id,
  reports_thread_id = EXCLUDED.reports_thread_id;

-- 4 точки. Круглосуточная (Комсомольская пл. 3) — "итог дня" в 21:00 (граница дневной/ночной смены).
-- ВАЖНО: у stores нет unique/PK на id (как и у store_cash/schedules) — этот
-- INSERT не защищён от повторного запуска, перед повторным применением
-- проверить SELECT'ом, что этих id ещё нет.
INSERT INTO stores (id, code, name, short_name, address, work_time, hours, color, is_active, org_id,
  micro_report_times, skip_sunday_micro_times, close_time_weekday, close_time_sunday)
VALUES
  ('horoshevskaya27', '133066', 'Хорошевская 27', 'Хорошевск', 'г. Москва, ул. Хорошевская, д. 27', '10-22', 12, '#e07a5f', true, 'rtt_gureeva',
   ARRAY['10:00','12:00','14:00','16:00','18:00','20:00','22:00'], NULL, '22:00', '22:00'),
  ('kozhevnicheskaya4', '125370', 'Кожевническая 4', 'Кожевнич', 'г. Москва, ул. Кожевническая, д. 4', '9-21', 12, '#3d5a80', true, 'rtt_gureeva',
   ARRAY['10:00','12:00','14:00','16:00','18:00','20:00'], NULL, '21:00', '21:00'),
  ('novoslobodskaya10', '1086736', 'Новослободская 10', 'Новослоб', 'г. Москва, ул. Новослободская, д. 10', '9-21', 12, '#81b29a', true, 'rtt_gureeva',
   ARRAY['10:00','12:00','14:00','16:00','18:00','20:00'], NULL, '21:00', '21:00'),
  ('komsomolskaya3', '178953', 'Комсомольская пл. 3', 'Комсомол', 'г. Москва, Комсомольская площадь, д. 3', 'круглосуточно', 24, '#f2cc8f', true, 'rtt_gureeva',
   ARRAY['10:00','12:00','14:00','16:00','18:00','20:00'], NULL, '21:00', '21:00');

INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, phones)
SELECT id, NULL, 0, 0, 0, 0, 0 FROM stores WHERE org_id = 'rtt_gureeva'
ON CONFLICT DO NOTHING;
