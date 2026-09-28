SET LOCAL search_path TO public;

-- Google Sheets -> график import. Правило приоритета из брифа: правки
-- внутри приложения ВСЕГДА побеждают правки из таблицы. Источник правды
-- о том, кто последний трогал строку графика, хранится прямо на
-- schedules.source — так это проверяется одним WHERE в ON CONFLICT, без
-- отдельного запроса "а не трогали ли эту смену руками".
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'sheet_import'));

-- Один раз подтверждённое соответствие "как сотрудник записан в таблице"
-- -> employees.id. sheet_name_raw хранится НЕ нормализованным (как есть в
-- таблице) — normalize() применяется на чтении в коде импорта, чтобы
-- маленькие расхождения в пробелах не плодили дублирующиеся маппинги.
CREATE TABLE IF NOT EXISTS sheet_schedule_mappings (
  id bigserial PRIMARY KEY,
  org_id text REFERENCES organizations(id),
  sheet_name_raw text NOT NULL,
  employee_id bigint NOT NULL REFERENCES employees(id),
  confirmed_by bigint REFERENCES employees(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sheet_schedule_mappings_org_name_idx
  ON sheet_schedule_mappings (COALESCE(org_id, ''), sheet_name_raw);

-- Строка из таблицы, для которой не нашлось точного/уверенного соответствия
-- сотруднику — ждёт разбора в Admin Center. candidate_employee_id/score —
-- лучшая догадка нечёткого совпадения, может быть NULL (совсем не нашли).
CREATE TABLE IF NOT EXISTS sheet_schedule_pending (
  id bigserial PRIMARY KEY,
  org_id text REFERENCES organizations(id),
  -- Без FK на stores: может нести shared/replacement.ts::REPLACEMENT_PLACEHOLDER_STORE_ID
  -- ('__REPLACEMENT__', ячейка «Замена» в таблице) — тот же сентинел, что и
  -- schedules.store_id (тоже без FK по этой же причине), не строка stores.
  store_id text,
  sheet_name_raw text NOT NULL,
  work_date date NOT NULL,
  shift_raw text,
  candidate_employee_id bigint REFERENCES employees(id),
  candidate_score real,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by bigint REFERENCES employees(id)
);
CREATE INDEX IF NOT EXISTS sheet_schedule_pending_status_idx ON sheet_schedule_pending (status);
