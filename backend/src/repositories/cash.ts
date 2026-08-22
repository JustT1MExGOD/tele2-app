/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `store_cash`.
 */
import { query } from '../db/index.js';

export interface CashRow {
  id: number;
  store_id: string;
  cash_date: string;
  cash_fact: number;
  cash_1c: number;
  comment: string | null;
  created_by: number | null;
  updated_at: string;
}

/** GET /cash/table — сырые строки за период, дальше группируются по дате/точке в роуте. */
export async function findInRange(from: string, to: string, orgId: string): Promise<
  { store_id: string; cash_date: string; cash_fact: number; cash_1c: number; delta: number; comment: string | null }[]
> {
  const res = await query(
    `SELECT c.store_id, c.cash_date::text as cash_date,
            c.cash_fact, c.cash_1c,
            (c.cash_fact - (c.cash_1c + 2000)) as delta, c.comment
     FROM store_cash c
     JOIN stores st ON st.id = c.store_id
     WHERE c.cash_date >= $1::date AND c.cash_date <= $2::date AND COALESCE(st.org_id, 'default') = $3
     ORDER BY c.cash_date`,
    [from, to, orgId]
  );
  return res.rows;
}

/** services/alerts.ts — кассовый разрыв на точке за день. */
/** GET /stores/:id/profile — кассовая дисциплина за период (все дни, не только сегодня). */
export async function findForStoreRange(storeId: string, from: string, to: string): Promise<{ cash_fact: number; cash_1c: number }[]> {
  const res = await query(
    `SELECT cash_fact, cash_1c FROM store_cash
     WHERE store_id = $1 AND cash_date::date >= $2::date AND cash_date::date <= $3::date`,
    [storeId, from, to]
  );
  return res.rows;
}

export async function findOneForStoreDay(storeId: string, date: string): Promise<{ cash_fact: number; cash_1c: number } | null> {
  const res = await query(
    `SELECT cash_fact, cash_1c FROM store_cash WHERE store_id = $1 AND cash_date = $2::date`,
    [storeId, date]
  );
  return res.rows[0] || null;
}

export async function upsert(data: {
  storeId: string; cashDate: string; cashFact: number; cash1c: number; comment: string | null;
}): Promise<CashRow> {
  const res = await query(
    `INSERT INTO store_cash (store_id, cash_date, cash_fact, cash_1c, comment, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (store_id, cash_date)
     DO UPDATE SET
       cash_fact = EXCLUDED.cash_fact,
       cash_1c = EXCLUDED.cash_1c,
       comment = EXCLUDED.comment,
       updated_at = now()
     RETURNING *`,
    [data.storeId, data.cashDate, data.cashFact, data.cash1c, data.comment]
  );
  return res.rows[0];
}

/** GET /cash — список с опциональным фильтром по точке. */
export async function list(from: string, to: string, orgId: string, storeId?: string): Promise<any[]> {
  const params: any[] = [from, to, orgId];
  let sql = `
    SELECT c.*, COALESCE(st.display_name, st.name) as store_name
    FROM store_cash c
    LEFT JOIN stores st ON st.id = c.store_id
    WHERE c.cash_date >= $1::date AND c.cash_date <= $2::date AND COALESCE(st.org_id, 'default') = $3`;
  if (storeId) {
    params.push(storeId);
    sql += ` AND c.store_id = $${params.length}`;
  }
  sql += ` ORDER BY c.cash_date DESC, st.name`;
  const res = await query(sql, params);
  return res.rows;
}
