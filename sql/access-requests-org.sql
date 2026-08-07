-- org_id гостя, выбранный на регистрации (эпик 16.0 — пикер сети при
-- регистрации). Nullable: старые заявки его не имели; claim-путь (уже
-- существующий сотрудник выбран из списка) тоже намеренно оставляет NULL —
-- сеть в этом случае — это сеть claimed-сотрудника, дублировать её здесь
-- значило бы держать два источника правды, которые могут разойтись.
ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS org_id text REFERENCES organizations(id);

-- Backfill: уже висящие pending-заявки без claim и без сети — раньше были
-- честно видны всем управляющим (решение прошлой сессии, не баг). С этой
-- миграцией это поведение исчезает; делаем backfill явно, а не полагаемся
-- на побочный эффект COALESCE в новом коде.
UPDATE access_requests
  SET org_id = 'default'
  WHERE org_id IS NULL AND claimed_employee_id IS NULL AND status = 'pending';
