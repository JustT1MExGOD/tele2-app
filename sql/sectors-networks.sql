-- Эпик 17.0: секторы → сети точек (organizations) → точки (stores).
-- Применяется вручную через psql по публичному прокси, как sql/ai-copilot.sql.
-- Все операции идемпотентны (IF NOT EXISTS / ON CONFLICT) — безопасно перезапускать.

CREATE TABLE IF NOT EXISTS sectors (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sector_id text REFERENCES sectors(id),
  ADD COLUMN IF NOT EXISTS chat_id text,
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#2AABEE',
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
COMMENT ON TABLE organizations IS 'Сеть точек (network of stores)';

CREATE TABLE IF NOT EXISTS supervisor_sectors (
  supervisor_id bigint NOT NULL REFERENCES employees(id),
  sector_id text NOT NULL REFERENCES sectors(id),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (supervisor_id, sector_id)
);

ALTER TABLE rtk_promocodes ADD COLUMN IF NOT EXISTS org_id text REFERENCES organizations(id);

-- Backfill: текущая единственная сеть становится сетью по умолчанию в секторе по умолчанию.
-- CHAT_ID ниже — реальное текущее значение из backend/.env, поведение не меняется.
INSERT INTO sectors (id, name) VALUES ('default', 'Сектор 1')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, brand_name, sector_id, chat_id)
  VALUES ('default', 'T2 Sales', 'T2', 'default', '-1002331320182')
  ON CONFLICT (id) DO UPDATE SET
    sector_id = COALESCE(organizations.sector_id, EXCLUDED.sector_id),
    chat_id = COALESCE(organizations.chat_id, EXCLUDED.chat_id);

UPDATE stores SET org_id = 'default' WHERE org_id IS NULL;
UPDATE employees SET org_id = 'default' WHERE org_id IS NULL;
UPDATE rtk_promocodes SET org_id = 'default' WHERE org_id IS NULL;
