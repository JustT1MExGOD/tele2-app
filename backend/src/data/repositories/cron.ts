/**
 * Data Access Layer (20.8.0, Full DAL) — cron-специфичные таблицы
 * (cron_send_log, alert_flags) и bespoke-запросы cron/reports.ts,
 * cron/alerts.ts.
 */
import { query } from '../db/index.js';

/** cron/reports.ts::claimCronSend, services/network-digest.ts — атомарный claim по ключу. */
export async function claimSend(key: string): Promise<boolean> {
  const res = await query(
    `INSERT INTO cron_send_log (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
    [key]
  );
  return !!res.rows[0];
}

/** cron/reports.ts::loadStorePlans — день-план, при сбое ИЛИ отсутствии
 * пробуем шаблон отдельно (каждый шаг сам ловит ошибку — сохранённое
 * поведение: сбой именно дневного запроса не должен блокировать попытку
 * шаблонного). */
export async function findDayOrTemplatePlanResilient(storeId: string, date: string): Promise<any> {
  let res = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
    [storeId, date]
  );
  if (!res.rows[0]) {
    res = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
      [storeId]
    );
  }
  return res.rows[0] || {};
}

export async function listStoresForReportSchedule(): Promise<{
  id: string; name: string; code: string; org_id: string | null;
  micro_report_times: string[] | null; skip_sunday_micro_times: string[] | null;
  close_time_weekday: string | null; close_time_sunday: string | null;
  open_time_weekday: string | null; open_time_sunday: string | null;
}[]> {
  const res = await query(
    `SELECT id, name, code, org_id, micro_report_times, skip_sunday_micro_times,
            close_time_weekday, close_time_sunday, open_time_weekday, open_time_sunday
     FROM stores ORDER BY name`
  );
  return res.rows;
}

/** cron/reports.ts — список имён смены точки на дату, БЕЗ сортировки (порядок как в БД — сохранённое поведение). */
export async function listStaffNamesUnordered(date: string, storeId: string): Promise<string[]> {
  const res = await query(
    `SELECT e.full_name FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.work_date::date = $1::date AND sch.store_id = $2 AND COALESCE(sch.hours,0)>0`,
    [date, storeId]
  );
  return res.rows.map((r: any) => r.full_name);
}

export async function listTomorrowShiftsForReminders(today: string): Promise<any[]> {
  const res = await query(
    `SELECT sch.*, e.full_name, e.telegram_id, st.name as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date::date = ($1::date + interval '1 day')
       AND COALESCE(sch.hours,0) > 0
       AND e.telegram_id IS NOT NULL`,
    [today]
  );
  return res.rows;
}

/** cron/alerts.ts::wasSent/mark — alert_flags claim-once-per-key. */
export async function alertWasSent(key: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM alert_flags WHERE id = $1', [key]);
  return res.rows.length > 0;
}

export async function markAlertSent(key: string): Promise<void> {
  await query('INSERT INTO alert_flags (id) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
}

/**
 * Detection stays employee-wide (NOT EXISTS over ALL of the employee's
 * sales that day, no store filter) — a replacement employee who sold
 * anywhere today is correctly excluded, unchanged. Only the DISPLAYED
 * store_name/org_id (message text + which network's chat it's routed to)
 * now prefers the employee's active (open) shift_session store over the
 * scheduled one, falling back to the scheduled store when no session is
 * open — so the alert never labels/routes a replacement employee under
 * their scheduled store while they're actually working elsewhere.
 */
export async function findZeroSalesOnShift(date: string): Promise<any[]> {
  const res = await query(
    `SELECT e.full_name, e.telegram_id,
            COALESCE(actual_st.display_name, actual_st.name, st.display_name, st.name) as store_name,
            sch.shift_text,
            COALESCE(actual_st.org_id, st.org_id, 'default') as org_id
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     LEFT JOIN shift_sessions ss
       ON ss.employee_id = sch.employee_id
      AND ss.work_date = sch.work_date
      AND ss.status = 'open'
     LEFT JOIN stores actual_st ON actual_st.id = ss.store_id
     WHERE sch.work_date = $1 AND sch.hours > 0 AND e.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM sales s
         WHERE s.employee_id = e.id AND s.sale_date = $1
           AND (s.sim+s.mnp+s.pa+s.combo+s.phones) > 0
       )`,
    [date]
  );
  return res.rows;
}

export async function sumKeyMetricsForStoreDate(storeId: string, date: string): Promise<{ sim: number; mnp: number; pa: number; combo: number }> {
  const res = await query(
    `SELECT COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
            COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo
     FROM sales WHERE store_id = $1 AND sale_date = $2`,
    [storeId, date]
  );
  return res.rows[0];
}

/** cron/message-cleanup.ts, integrations/telegram/bot.ts::trackGroupMessage
 * — журнал отправленных в группы/каналы сообщений для автоудаления через
 * 2+ дня (0019_bot_sent_messages.sql). */
export async function recordSentGroupMessage(chatId: string, messageId: number): Promise<void> {
  await query(
    `INSERT INTO bot_sent_messages (chat_id, message_id) VALUES ($1, $2)`,
    [chatId, messageId]
  );
}

export async function listSentGroupMessagesOlderThan(cutoffIso: string): Promise<{ id: number; chat_id: string; message_id: number }[]> {
  const res = await query(
    `SELECT id, chat_id, message_id FROM bot_sent_messages WHERE sent_at < $1::timestamptz ORDER BY sent_at ASC`,
    [cutoffIso]
  );
  return res.rows;
}

export async function deleteSentGroupMessageLogRow(id: number): Promise<void> {
  await query(`DELETE FROM bot_sent_messages WHERE id = $1`, [id]);
}

export async function enqueueReportJobs(jobs: {key:string;due_at:string;payload:any}[]) {
  if (!jobs.length) return;
  await query(`INSERT INTO report_jobs(key,due_at,payload)
    SELECT j.key,j.due_at,j.payload FROM jsonb_to_recordset($1::jsonb) j(key text,due_at timestamptz,payload jsonb)
    WHERE NOT EXISTS(SELECT 1 FROM cron_send_log old WHERE old.key=j.key)
    ON CONFLICT(key) DO NOTHING`,[JSON.stringify(jobs)]);
}
export async function claimReportJob() {
  await query(`UPDATE report_jobs SET status='failed',last_error=COALESCE(last_error,'Worker lease expired') WHERE status='running' AND lease_until<now() AND attempts>=5`);
  return (await query(`UPDATE report_jobs SET status='running', attempts=attempts+1, lease_until=now()+interval '10 minutes'
    WHERE key=(SELECT key FROM report_jobs WHERE due_at<=now() AND next_attempt_at<=now() AND attempts<5
      AND (status='pending' OR (status='running' AND lease_until<now())) ORDER BY due_at,key
      FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`)).rows[0];
}
export async function finishReportJob(key:string,attempt:number,error?:string) {
  await query(`UPDATE report_jobs SET status=CASE WHEN $3::text IS NULL THEN 'done' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
    completed_at=CASE WHEN $3::text IS NULL THEN now() ELSE NULL END,last_error=$3,lease_until=NULL,
    next_attempt_at=now()+ LEAST(30,attempts*attempts)*interval '1 minute'
    WHERE key=$1 AND attempts=$2 AND status='running'`,[key,attempt,error ?? null]);
}
