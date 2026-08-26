/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `smart_alerts`.
 * Начато в батче 3 с resolveFromTask (для routes-tasks.ts), дополнено в
 * батче 4 остальным SQL (генерация, список/ack/status).
 */
import { query } from '../db/index.js';
import { todayMoscow } from '../../utils/date.js';

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

/** Learn (21.x) — plan_miss_projected алерты конкретной даты, ещё без
 * посчитанного исхода (payload.outcome). alert_date::text — иначе pg
 * вернул бы JS Date, а не ISO-строку (тот же баг класс, что уже ловили в
 * newbieCohorts, 19.x). */
export async function findUnevaluatedPlanMiss(date: string): Promise<any[]> {
  const res = await query(
    `SELECT id, store_id, payload, alert_date::text as alert_date
     FROM smart_alerts
     WHERE alert_type = 'plan_miss_projected' AND alert_date = $1::date
       AND NOT (payload ? 'outcome')`,
    [date]
  );
  return res.rows;
}

/** Learn — "тихие" (isDip, payload.z < 0) anomaly_vs_forecast алерты не
 * младше окна рецидива, ещё без исхода. Всплески (z>0) не оцениваем — им
 * нечего "исправлять". */
export async function findUnevaluatedAnomalyDips(olderThanOrEqualDate: string): Promise<any[]> {
  const res = await query(
    `SELECT id, store_id, payload, alert_date::text as alert_date
     FROM smart_alerts
     WHERE alert_type = 'anomaly_vs_forecast' AND alert_date <= $1::date
       AND (payload->>'z')::float < 0
       AND NOT (payload ? 'outcome')`,
    [olderThanOrEqualDate]
  );
  return res.rows;
}

/** Learn — была ли у ТОЙ ЖЕ точки ещё одна просадка строго после
 * fromDateExclusive и не позже toDateInclusive (окно рецидива). */
export async function hasRecurringDip(storeId: string, fromDateExclusive: string, toDateInclusive: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM smart_alerts
     WHERE store_id = $1 AND alert_type = 'anomaly_vs_forecast'
       AND (payload->>'z')::float < 0
       AND alert_date > $2::date AND alert_date <= $3::date
     LIMIT 1`,
    [storeId, fromDateExclusive, toDateInclusive]
  );
  return !!res.rows[0];
}

/** Learn — дописать outcome/had_task в payload алерта, не трогая остальное. */
export async function mergeOutcome(alertId: number, outcome: string, hadTask: boolean): Promise<void> {
  await query(
    `UPDATE smart_alerts SET payload = payload || $1::jsonb WHERE id = $2`,
    [JSON.stringify({ outcome, had_task: hadTask }), alertId]
  );
}

/** Product Analytics (20.34) — первый просмотр алерта менеджером. Один раз
 * на алерт (не на сотрудника) — вопрос "открыли ли вообще", не "кто именно". */
export async function markOpened(alertId: number): Promise<void> {
  await query(
    `UPDATE smart_alerts SET first_opened_at = COALESCE(first_opened_at, now()) WHERE id = $1`,
    [alertId]
  );
}

/** Product Analytics (20.34) — вовлечённость по типу алерта: всего/открыто/
 * отклонено (status='dismissed'). Только для типов, у которых вообще есть
 * Learn-исход (без него open_rate/dismissed_rate бессмысленно сравнивать
 * с recovery_rate — разные знаменатели). */
export async function summarizeEngagement(): Promise<
  { alert_type: string; total: number; opened: number; dismissed: number }[]
> {
  const res = await query(
    `SELECT alert_type,
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE first_opened_at IS NOT NULL)::int as opened,
            COUNT(*) FILTER (WHERE status = 'dismissed')::int as dismissed
     FROM smart_alerts
     WHERE alert_type IN ('plan_miss_projected', 'anomaly_vs_forecast')
     GROUP BY alert_type`
  );
  return res.rows;
}

/** Learn — сводка "сработала ли рекомендация": группировка по типу алерта,
 * наличию выполненной задачи и исходу. GROUP BY прямо в SQL — строк мало
 * (по одной на каждую реально встретившуюся комбинацию), агрегировать в
 * JS избыточно. */
export async function summarizeOutcomes(): Promise<
  { alert_type: string; had_task: boolean; outcome: string; cnt: number }[]
> {
  const res = await query(
    `SELECT alert_type,
            (payload->>'had_task')::boolean as had_task,
            payload->>'outcome' as outcome,
            COUNT(*)::int as cnt
     FROM smart_alerts
     WHERE payload ? 'outcome'
     GROUP BY alert_type, had_task, outcome`
  );
  return res.rows;
}
