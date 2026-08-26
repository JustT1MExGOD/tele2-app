/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `access_requests`.
 */
import { query } from '../db/index.js';

export interface AccessRequestRow {
  id: number;
  telegram_id: string | number | null;
  telegram_username: string | null;
  full_name: string;
  claimed_employee_id: number | null;
  message: string | null;
  status: string;
  org_id: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  /** Не-Telegram вход (20.35, план) — 'telegram' (по умолчанию) или 'phone'. */
  provider: string;
  phone: string | null;
  password_hash: string | null;
}

export interface AccessRequestWithEffectiveOrg extends AccessRequestRow {
  effective_org_id: string;
}

export async function findLatestByTelegramId(telegramId: string | number): Promise<AccessRequestRow | null> {
  const res = await query(
    `SELECT * FROM access_requests WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [telegramId]
  );
  return res.rows[0] || null;
}

export async function findPendingByTelegramId(telegramId: string | number): Promise<{ id: number } | null> {
  const res = await query(
    `SELECT id FROM access_requests WHERE telegram_id = $1 AND status = 'pending'`,
    [telegramId]
  );
  return res.rows[0] || null;
}

export async function create(data: {
  telegramId: string | number; username: string | null; fullName: string;
  claimedEmployeeId: number | null; message: string; orgId: string | null;
}): Promise<AccessRequestRow> {
  const res = await query(
    `INSERT INTO access_requests
       (telegram_id, telegram_username, full_name, claimed_employee_id, message, status, org_id)
     VALUES ($1,$2,$3,$4,$5,'pending',$6)
     RETURNING *`,
    [data.telegramId, data.username, data.fullName, data.claimedEmployeeId, data.message, data.orgId]
  );
  return res.rows[0];
}

/** Не-Telegram вход (20.35, план) — та же заявка, но по телефону; та же
 * pending-дедупликация, что findPendingByTelegramId. */
export async function findPendingByPhone(phone: string): Promise<{ id: number } | null> {
  const res = await query(
    `SELECT id FROM access_requests WHERE provider = 'phone' AND phone = $1 AND status = 'pending'`,
    [phone]
  );
  return res.rows[0] || null;
}

export async function createPhone(data: {
  phone: string; passwordHash: string; fullName: string;
  claimedEmployeeId: number | null; message: string; orgId: string | null;
}): Promise<AccessRequestRow> {
  const res = await query(
    `INSERT INTO access_requests
       (provider, phone, password_hash, full_name, claimed_employee_id, message, status, org_id)
     VALUES ('phone',$1,$2,$3,$4,$5,'pending',$6)
     RETURNING *`,
    [data.phone, data.passwordHash, data.fullName, data.claimedEmployeeId, data.message, data.orgId]
  );
  return res.rows[0];
}

/** GET /access/requests — очередь заявок сети (эффективная сеть: прямой org_id
 * на заявке -> сеть заклеймленного сотрудника -> 'default'). Явный список
 * колонок, НЕ SELECT * — password_hash (заявки provider='phone') не должен
 * уйти в этот ответ, он отдаётся клиенту напрямую как список. */
export async function listPendingForOrg(orgId: string): Promise<Omit<AccessRequestRow, 'password_hash'>[]> {
  const res = await query(
    `SELECT ar.id, ar.telegram_id, ar.telegram_username, ar.full_name, ar.claimed_employee_id,
            ar.message, ar.status, ar.org_id, ar.reviewed_by, ar.reviewed_at, ar.created_at,
            ar.provider, ar.phone
     FROM access_requests ar
     LEFT JOIN employees e ON e.id = ar.claimed_employee_id
     WHERE ar.status = 'pending'
       AND COALESCE(ar.org_id, COALESCE(e.org_id,'default'), 'default') = $1
     ORDER BY ar.created_at ASC`,
    [orgId]
  );
  return res.rows;
}

/** Approve/reject — та же effective_org_id проекция, что list, для одной заявки по id. */
export async function findByIdWithEffectiveOrg(id: number): Promise<AccessRequestWithEffectiveOrg | null> {
  const res = await query(
    `SELECT ar.*, COALESCE(ar.org_id, e.org_id, 'default') as effective_org_id
     FROM access_requests ar
     LEFT JOIN employees e ON e.id = ar.claimed_employee_id
     WHERE ar.id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

/**
 * CAS: переводит заявку в approved только если она ещё pending — двойной
 * тап/ретрай на медленной сети раньше проходил оба раза (findByIdWithEffectiveOrg
 * читал status до мутации, сама mark-запись ничего не перепроверяла), из-за
 * чего мог уйти второй "✅ Доступ открыт" в Telegram, а на claim-less пути —
 * создаться второй сотрудник (спасал только случайный UNIQUE на telegram_id,
 * который на это не рассчитан и просто падал 500-кой). Возвращает false,
 * если заявку уже успели обработать — вызывающий код тогда не должен
 * повторно создавать/подтверждать сотрудника и слать уведомление.
 */
export async function markApproved(id: number, reviewedBy: number | null, q: typeof query = query): Promise<boolean> {
  const res = await q(
    `UPDATE access_requests SET status = 'approved', reviewed_by = $1, reviewed_at = now() WHERE id = $2 AND status = 'pending'`,
    [reviewedBy, id]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Тот же CAS, что markApproved — см. комментарий там. */
export async function markRejected(id: number, reviewedBy: number | null, q: typeof query = query): Promise<boolean> {
  const res = await q(
    `UPDATE access_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = now() WHERE id = $2 AND status = 'pending'`,
    [reviewedBy, id]
  );
  return (res.rowCount ?? 0) > 0;
}
