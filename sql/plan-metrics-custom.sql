CREATE TABLE IF NOT EXISTS plan_metrics (
  id text PRIMARY KEY,
  label text NOT NULL,
  short_label text,
  unit text DEFAULT 'count',
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 100
);

INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order) VALUES
  ('sim', 'SIM', 'SIM', 'count', true, 10),
  ('mnp', 'MNP', 'MNP', 'count', true, 20),
  ('pa', 'ПА', 'ПА', 'count', true, 30),
  ('combo', 'Комбо', 'Комбо', 'count', true, 40),
  ('phones', 'Телефоны', 'Тел', 'money', true, 50),
  ('accessories', 'Аксессуары', 'Аксы', 'money', true, 60),
  ('focus', 'ФО', 'ФО', 'money', true, 70),
  ('settings', 'Настройки', 'Доп', 'money', true, 80),
  ('wink', 'Wink', 'Wink', 'money', true, 90),
  ('shpd', 'ШПД', 'ШПД', 'count', true, 100),
  ('insurance', 'Страховки', 'Страх', 'money', true, 110),
  ('credit_request', 'Кредит заявка', 'Кр.з', 'count', true, 120),
  ('credit_issued', 'Кредит выдан', 'Кр.в', 'money', true, 130),
  ('plotter', 'Плоттер', 'Плот', 'count', true, 140),
  ('hb', 'НВ', 'НВ', 'count', true, 150)
ON CONFLICT (id) DO NOTHING;
