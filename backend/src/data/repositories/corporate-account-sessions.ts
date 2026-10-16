/**
 * Data Access Layer — сессии точечных корп-аккаунтов (Этап B плана,
 * `corporate_account_sessions`). Зеркало `sessions.ts` (employee_sessions),
 * но отдельная таблица/токен-примитив: точечный аккаунт не привязан к
 * employee_id, поэтому не может жить в employee_sessions. token_hash —
 * тот же sha256(token), сырой токен живёт только в cookie, никогда в БД.
 */
import { query } from '../db/index.js';
import { generateToken, hashToken } from './sessions.js';

export { generateToken, hashToken };

/** Отдельная cookie от `t2_session` (employee-сессия) — обе должны уметь
 * жить в одном браузере/клиенте одновременно без конфликта. */
export const POINT_COOKIE_NAME = 't2_point_session';

const ABSOLUTE_TTL_DAYS = 30;
const IDLE_TIMEOUT_DAYS = 14;

export async function create(
  corporateAccountId: number,
  device?: { userAgent?: string | null; ip?: string | null }
): Promise<string> {
  const token = generateToken();
  await query(
    `INSERT INTO corporate_account_sessions (corporate_account_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, now() + interval '${ABSOLUTE_TTL_DAYS} days', $3, $4)`,
    [corporateAccountId, hashToken(token), device?.userAgent || null, device?.ip || null]
  );
  return token;
}

export async function resolve(token: string): Promise<{ corporate_account_id: number } | null> {
  const res = await query(
    `SELECT corporate_account_id FROM corporate_account_sessions
     WHERE token_hash = $1
       AND expires_at > now()
       AND revoked_at IS NULL
       AND last_seen_at > now() - interval '${IDLE_TIMEOUT_DAYS} days'`,
    [hashToken(token)]
  );
  return res.rows[0] || null;
}

export async function touch(token: string): Promise<void> {
  await query(
    `UPDATE corporate_account_sessions SET last_seen_at = now()
     WHERE token_hash = $1 AND last_seen_at < now() - interval '1 hour'`,
    [hashToken(token)]
  );
}

export async function revoke(token: string): Promise<void> {
  await query(`UPDATE corporate_account_sessions SET revoked_at = now() WHERE token_hash = $1`, [hashToken(token)]);
}

/** Для heartbeat-проверки в ws.ts — текущая активность сессии+аккаунта. */
export async function isStillValid(corporateAccountId: number, tokenHash: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM corporate_account_sessions s
     JOIN corporate_accounts ca ON ca.id = s.corporate_account_id
     WHERE s.token_hash = $1 AND s.corporate_account_id = $2
       AND s.expires_at > now() AND s.revoked_at IS NULL AND ca.is_active`,
    [tokenHash, corporateAccountId]
  );
  return res.rows.length > 0;
}
