/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `shift_sessions`.
 * Самый concurrency-чувствительный файл после sales.ts/sync-log.ts —
 * claimOpenSession() и closeSession() переносят partial unique index race
 * (23505-catch) и CAS-переход (WHERE status='open') дословно, без единой
 * правки логики.
 */
import { query } from '../db/index.js';

/** Висящие open-сессии закрываются перед новым открытием (подмена/забытый close). */
export async function autoCloseHanging(employeeId: number, date: string): Promise<void> {
  await query(
    `UPDATE shift_sessions SET status = 'auto_closed', closed_at = now()
     WHERE employee_id = $1 AND status = 'open' AND work_date < $2::date`,
    [employeeId, date]
  );
}

/**
 * Partial unique index (employee_id) WHERE status='open' — гонка: два
 * параллельных /shifts/open для одного сотрудника оба проходят
 * autoCloseHanging() выше (в этот момент ещё ни одной 'open'-строки нет),
 * и без constraint оба вставили бы свою 'open'-сессию, оставляя сотрудника
 * с двумя одновременно "открытыми" сменами. Проигравший ловит 23505 и
 * получает уже открытую победителем сессию вместо ошибки.
 */
/**
 * orgId/workMode/selectionSource — replacement-shift work context (migration
 * 0031), fixed for the lifetime of the session. Resolved BEFORE this call by
 * core/shifts/work-context.ts — this function persists it, it doesn't decide it.
 */
export async function claimOpenSession(
  employeeId: number, storeId: string, date: string,
  lat: number | null, lng: number | null, accuracyM: number | null,
  workContext: { orgId: string; workMode: 'NORMAL' | 'REPLACEMENT'; selectionSource: 'SCHEDULE' | 'MANUAL_CODE' }
): Promise<{ session: any; deduped: boolean }> {
  const res = await query(
    `INSERT INTO shift_sessions (employee_id,store_id,work_date,status,opened_at,open_lat,open_lng,open_accuracy_m,org_id,work_mode,selection_source)
     VALUES ($1,$2,$3,'open',now(),$4,$5,$6,$7,$8,$9)
     ON CONFLICT (employee_id) WHERE status='open' DO NOTHING RETURNING *`,
    [employeeId,storeId,date,lat,lng,accuracyM,workContext.orgId,workContext.workMode,workContext.selectionSource]);
  if (res.rows[0]) return {session:res.rows[0],deduped:false};
  const session = await findOpenForEmployee(employeeId);
  if (!session || session.store_id !== storeId || String(session.work_date).slice(0,10) !== date)
    throw Object.assign(new Error('Уже открыта другая смена: сначала закройте её'),{statusCode:409});
  return {session,deduped:true};
}

/** services/alerts.ts — есть ли сейчас открытая смена на точке (для "тишины к 13:00"). */
export async function countOpenForStoreDay(storeId: string, date: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int c FROM shift_sessions WHERE store_id = $1 AND work_date = $2::date AND status = 'open'`,
    [storeId, date]
  );
  return Number(res.rows[0]?.c) || 0;
}

export async function findLatestHandoverForStore(
  storeId: string
): Promise<{ handover_note: string; closed_at: string; from_employee_name: string } | null> {
  const res = await query(
    `SELECT ss.handover_note, ss.closed_at, e.full_name as from_employee_name
     FROM shift_sessions ss
     JOIN employees e ON e.id = ss.employee_id
     WHERE ss.store_id = $1 AND ss.status = 'closed' AND ss.handover_note IS NOT NULL
     ORDER BY ss.closed_at DESC LIMIT 1`,
    [storeId]
  );
  return res.rows[0] || null;
}

export async function findOpenForEmployee(employeeId: number): Promise<any | null> {
  const res = await query(
    `SELECT * FROM shift_sessions WHERE employee_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    [employeeId]
  );
  return res.rows[0] || null;
}

export async function findCurrentOpenWithStore(employeeId: number): Promise<any | null> {
  const res = await query(
    `SELECT ss.*, ss.work_date::text as work_date,
            COALESCE(st.display_name, st.name) as store_name, st.color,
            st.code as store_code, st.address as store_address
     FROM shift_sessions ss
     LEFT JOIN stores st ON st.id = ss.store_id
     WHERE ss.employee_id = $1 AND ss.status = 'open'
     ORDER BY ss.opened_at DESC LIMIT 1`,
    [employeeId]
  );
  return res.rows[0] || null;
}

/**
 * GET /shifts/open-map — where each of the org's own employees is ACTUALLY
 * working right now (open shift_session), not where they're scheduled.
 * Used by the "Добавить продажу" modal to pre-fill the right store for a
 * replacement employee instead of defaulting to their scheduled store.
 * Filtered by employees.org_id (home org), same as GET /schedules's own
 * "which employees are mine" scoping — a replacement employee's open
 * session at a foreign store still shows up here under their home org,
 * correctly pointing at the foreign store they're actually working.
 *
 * Returns store_name too (not just the id): the replacement store, by
 * definition, is NOT one of fetchOrgStores()'s home-network stores — the
 * modal must inject it into its own store picker as an extra option (with
 * a real label) for the pre-select to actually land on it, rather than
 * silently falling through to whatever option happens to be first.
 */
export async function findOpenSessionStoresForOrg(orgId: string): Promise<{ employee_id: number; store_id: string; store_name: string | null }[]> {
  const res = await query(
    `SELECT ss.employee_id, ss.store_id, COALESCE(st.display_name, st.name) as store_name
     FROM shift_sessions ss
     JOIN employees e ON e.id = ss.employee_id
     LEFT JOIN stores st ON st.id = ss.store_id
     WHERE ss.status = 'open' AND COALESCE(e.org_id, 'default') = $1`,
    [orgId]
  );
  return res.rows;
}

/**
 * AND status = 'open' делает переход атомарным compare-and-swap: если два
 * запроса close (двойной тап, повторный клиентский ретрай) прочитали одну
 * и ту же open-сессию до того, как любой из них успел её закрыть, выигрывает
 * только тот UPDATE, что выполнится первым — у второго WHERE ... AND
 * status='open' больше не совпадёт ни с одной строкой, и он получит 0
 * обновлённых строк вместо того, чтобы тоже перевести уже закрытую сессию
 * в 'closed' и (что хуже) начислить награду второй раз. null — проиграли
 * гонку, вызывающий код сам решает, что делать дальше.
 */
export async function closeSession(
  sessionId: number,
  patch: {
    lat: number | null; lng: number | null; selfReport: string | null; mood: number | null;
    blockers: string | null; ideal: boolean; score: number; handoverNote: string | null;
  }
): Promise<any | null> {
  const res = await query(
    `UPDATE shift_sessions SET
       status = 'closed',
       closed_at = now(),
       close_lat = $1,
       close_lng = $2,
       self_report = $3,
       mood = $4,
       blockers = $5,
       ideal_shift = $6,
       score = $7,
       handover_note = $8
     WHERE id = $9 AND status = 'open'
     RETURNING *`,
    [patch.lat, patch.lng, patch.selfReport, patch.mood, patch.blockers, patch.ideal, patch.score, patch.handoverNote, sessionId]
  );
  return res.rows[0] || null;
}

/** GET /employees/:id/profile — недавние закрытые смены за период. */
export async function findRecentClosedForEmployee(employeeId: number, from: string, to: string): Promise<any[]> {
  const res = await query(
    `SELECT ss.work_date::text as date, ss.store_id, COALESCE(st.display_name, st.name) as store_name,
            ss.score, ss.ideal_shift, ss.mood
     FROM shift_sessions ss
     LEFT JOIN stores st ON st.id = ss.store_id
     WHERE ss.employee_id = $1 AND ss.status = 'closed'
       AND ss.work_date::date >= $2::date AND ss.work_date::date <= $3::date
     ORDER BY ss.work_date DESC LIMIT 20`,
    [employeeId, from, to]
  );
  return res.rows;
}

/** GET /employees/:id/profile — явка: сколько дней периода была открыта смена. */
export async function countAttendedDays(employeeId: number, from: string, to: string): Promise<number> {
  const res = await query(
    `SELECT COUNT(DISTINCT work_date)::int as cnt
     FROM shift_sessions
     WHERE employee_id = $1 AND work_date::date >= $2::date AND work_date::date <= $3::date`,
    [employeeId, from, to]
  );
  return Number(res.rows[0]?.cnt) || 0;
}

export async function findById(sessionId: number): Promise<any | null> {
  const res = await query(`SELECT * FROM shift_sessions WHERE id = $1`, [sessionId]);
  return res.rows[0] || null;
}

/**
 * XP/бейджи/streak — не более одного раза за календарный день. Без этой
 * проверки open→close можно было спамить сколько угодно раз подряд и
 * каждый close начислял полную награду заново.
 */
export async function hasOtherClosedToday(employeeId: number, date: string, excludeSessionId: number): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM shift_sessions
     WHERE employee_id = $1 AND work_date::date = $2::date AND status = 'closed' AND id != $3
     LIMIT 1`,
    [employeeId, date, excludeSessionId]
  );
  return !!res.rows[0];
}

/** core/alerts/anomaly.ts (Explain, 21.0) — сколько уникальных сотрудников
 * реально открыли смену на точке в эту дату (любой статус — open/closed/
 * auto_closed), по всем точкам разом. НЕ то же самое, что countOpenForStoreDay
 * (только те, что открыты ПРЯМО СЕЙЧАС) — здесь интересует явка за весь день. */
export async function findSessionCountForDate(
  storeIds: string[], date: string
): Promise<{ store_id: string; opened: number }[]> {
  const res = await query(
    `SELECT store_id, COUNT(DISTINCT employee_id)::int as opened
     FROM shift_sessions
     WHERE store_id = ANY($1) AND work_date = $2::date
     GROUP BY store_id`,
    [storeIds, date]
  );
  return res.rows;
}

/** cron/reports.ts — replacement employees to additionally DM the store's
 * micro/final report to, for this store+date (any status — a shift closed
 * earlier in the day still counts, per the feature's own "store/day" scope,
 * not time-of-day). DISTINCT on employee_id — one row per employee even if
 * they somehow had more than one REPLACEMENT session at this store today. */
export async function findReplacementEmployeesForStoreDate(
  storeId: string, date: string
): Promise<{ employee_id: number; telegram_id: string | number | null; full_name: string }[]> {
  const res = await query(
    `SELECT DISTINCT ON (ss.employee_id) ss.employee_id, e.telegram_id, e.full_name
     FROM shift_sessions ss
     JOIN employees e ON e.id = ss.employee_id
     WHERE ss.store_id = $1 AND ss.work_date = $2::date AND ss.work_mode = 'REPLACEMENT'
     ORDER BY ss.employee_id`,
    [storeId, date]
  );
  return res.rows;
}

export async function lockEmployee(id:number) { await query('SELECT id FROM employees WHERE id=$1 FOR UPDATE',[id]); }
export async function latestCloseResult(id:number,date:string | null) {
  return (await query('SELECT close_result FROM shift_sessions WHERE employee_id=$1 AND ($2::date IS NULL OR work_date=$2) AND close_result IS NOT NULL ORDER BY id DESC LIMIT 1',[id,date])).rows[0]?.close_result;
}
export async function saveCloseResult(id:string,result:any) {
  await query('UPDATE shift_sessions SET close_result=$2 WHERE id=$1',[id,JSON.stringify(result)]);
}
