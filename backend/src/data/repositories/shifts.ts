/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `shift_sessions`.
 * Самый concurrency-чувствительный файл после sales.ts/sync-log.ts —
 * claimOpenSession() и closeSession() переносят partial unique index race
 * (23505-catch) и CAS-переход (WHERE status='open') дословно, без единой
 * правки логики.
 */
import { query } from '../db/index.js';

/** Висящие open-сессии закрываются перед новым открытием (подмена/забытый close). */
export async function autoCloseHanging(employeeId: number): Promise<void> {
  await query(
    `UPDATE shift_sessions SET status = 'auto_closed', closed_at = now()
     WHERE employee_id = $1 AND status = 'open'`,
    [employeeId]
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
export async function claimOpenSession(
  employeeId: number, storeId: string, date: string,
  lat: number | null, lng: number | null, accuracyM: number | null
): Promise<{ session: any; deduped: boolean }> {
  try {
    const res = await query(
      `INSERT INTO shift_sessions
         (employee_id, store_id, work_date, status, opened_at, open_lat, open_lng, open_accuracy_m)
       VALUES ($1,$2,$3,'open', now(), $4, $5, $6)
       RETURNING *`,
      [employeeId, storeId, date, lat, lng, accuracyM]
    );
    return { session: res.rows[0], deduped: false };
  } catch (e: any) {
    if (e?.code === '23505') {
      const existing = await query(
        `SELECT * FROM shift_sessions WHERE employee_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
        [employeeId]
      );
      return { session: existing.rows[0], deduped: true };
    }
    throw e;
  }
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
    `SELECT ss.*, COALESCE(st.display_name, st.name) as store_name, st.color
     FROM shift_sessions ss
     LEFT JOIN stores st ON st.id = ss.store_id
     WHERE ss.employee_id = $1 AND ss.status = 'open'
     ORDER BY ss.opened_at DESC LIMIT 1`,
    [employeeId]
  );
  return res.rows[0] || null;
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

/** core/analytics/anomaly.ts (Explain, 21.0) — сколько уникальных сотрудников
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
