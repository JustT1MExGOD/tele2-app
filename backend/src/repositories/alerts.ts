/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `smart_alerts`.
 * Начато в батче 3 с resolveFromTask (для routes-tasks.ts), дополнено в
 * батче 4 остальным SQL (генерация, список/ack/status).
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../utils/date.js';

/** GET /alerts — своей сети, с привязанной задачей (если есть). */
export async function listForOrg(orgId: string, status: string): Promise<any[]> {
  const res = await query(
    `SELECT a.*, COALESCE(st.display_name, st.name) as store_name,
       t.id as task_id, t.status as task_status
     FROM smart_alerts a
     LEFT JOIN stores st ON st.id = a.store_id
     LEFT JOIN tasks t ON t.alert_id = a.id
     WHERE a.status = $1 AND COALESCE(st.org_id,'default') = $2
     ORDER BY a.created_at DESC LIMIT 50`,
    [status, orgId]
  );
  return res.rows;
}

/** null — алерта с таким id вообще нет (404); { store_id: null } — есть, но без привязанной точки. */
/** Command Center — открытые алерты по всей сети (admin/manager без scope-ограничения). */
export async function listOpenAll(): Promise<any[]> {
  const res = await query(
    `SELECT a.*, COALESCE(st.display_name, st.name) as store_name FROM smart_alerts a
     LEFT JOIN stores st ON st.id = a.store_id
     WHERE a.status = 'open' ORDER BY a.created_at DESC LIMIT 50`
  );
  return res.rows;
}

/** Command Center — открытые алерты, ограниченные сектором супервайзера. */
export async function listOpenForStores(storeIds: string[]): Promise<any[]> {
  const res = await query(
    `SELECT a.*, COALESCE(st.display_name, st.name) as store_name FROM smart_alerts a
     LEFT JOIN stores st ON st.id = a.store_id
     WHERE a.status = 'open' AND a.store_id = ANY($1)
     ORDER BY a.created_at DESC LIMIT 50`,
    [storeIds]
  );
  return res.rows;
}

export async function findStoreId(alertId: number): Promise<{ store_id: string | null } | null> {
  const res = await query(`SELECT store_id FROM smart_alerts WHERE id = $1`, [alertId]);
  return res.rows[0] || null;
}

export async function ack(alertId: number, ackedBy: number | null): Promise<any | null> {
  const res = await query(
    `UPDATE smart_alerts SET status='acked', acked_at=now(), acked_by=$1, updated_at=now()
     WHERE id=$2 RETURNING *`,
    [ackedBy, alertId]
  );
  return res.rows[0] || null;
}

export async function setStatus(alertId: number, status: string, actedBy: number | null): Promise<any | null> {
  const res = await query(
    `UPDATE smart_alerts SET
       status = $1,
       updated_at = now(),
       acked_at = COALESCE(acked_at, now()),
       acked_by = COALESCE(acked_by, $2)
     WHERE id = $3 RETURNING *`,
    [status, actedBy, alertId]
  );
  return res.rows[0] || null;
}

/**
 * Атомарный claim по partial unique index (store_id, alert_type, alert_date)
 * WHERE status='open' (миграция 0007) — раньше это была SELECT-проверка и
 * отдельный INSERT, уязвимые к гонке между двумя одновременно живыми
 * контейнерами при деплое. ON CONFLICT DO NOTHING делает второй, проигравший
 * вызов молча no-op (null).
 */
export async function insertOnce(opts: {
  store_id: string;
  employee_id?: number;
  alert_type: string;
  severity: string;
  title: string;
  body: string;
  payload: any;
  /** По умолчанию сегодня — детекция аномалий (19.2) проверяет ВЧЕРАШНИЙ
   * завершённый день и должна клеймиться под его датой, не под сегодняшней. */
  alert_date?: string;
}): Promise<any | null> {
  const res = await query(
    `INSERT INTO smart_alerts (store_id, employee_id, alert_type, severity, title, body, payload, alert_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      opts.store_id,
      opts.employee_id || null,
      opts.alert_type,
      opts.severity,
      opts.title,
      opts.body,
      JSON.stringify(opts.payload || {}),
      opts.alert_date || todayMoscow()
    ]
  );
  return res.rows[0] || null;
}

/** 18.6: задача, созданная из алерта, сама закрывает его при выполнении —
 * не трогаем уже resolved/dismissed (не переоткрываем). */
export async function resolveFromTask(alertId: number, resolvedBy: number | null): Promise<void> {
  await query(
    `UPDATE smart_alerts SET status='resolved', updated_at=now(),
       acked_at = COALESCE(acked_at, now()), acked_by = COALESCE(acked_by, $1)
     WHERE id = $2 AND status NOT IN ('resolved', 'dismissed')`,
    [resolvedBy, alertId]
  );
}
