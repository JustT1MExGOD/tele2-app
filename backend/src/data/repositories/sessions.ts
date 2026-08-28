/**
 * Data Access Layer — не-Telegram вход (20.35, план): `employee_sessions`
 * (cookie-сессия) и `employee_password_resets` (сброс пароля админом).
 * Отдельный файл, не в employees.ts — тот и так большой, а это два разных
 * токен-примитива с собственным жизненным циклом, не поля сотрудника.
 *
 * В обеих таблицах хранится только sha256(token) — сырой токен живёт
 * только в cookie/ссылке, никогда в БД, тот же принцип, что password_hash.
 */
import { randomBytes, createHash } from 'crypto';
import { query } from '../db/index.js';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(employeeId: number): Promise<string> {
  const token = generateToken();
  await query(
    `INSERT INTO employee_sessions (employee_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '30 days')`,
    [employeeId, hashToken(token)]
  );
  return token;
}

export async function resolveSession(token: string): Promise<{ employee_id: number } | null> {
  const res = await query(
    `SELECT employee_id FROM employee_sessions WHERE token_hash = $1 AND expires_at > now()`,
    [hashToken(token)]
  );
  return res.rows[0] || null;
}

/** Не на каждый запрос — раз в час, чтобы не писать в БД на каждый чих. */
export async function touchSession(token: string): Promise<void> {
  await query(
    `UPDATE employee_sessions SET last_seen_at = now()
     WHERE token_hash = $1 AND last_seen_at < now() - interval '1 hour'`,
    [hashToken(token)]
  );
}

export async function deleteSession(token: string): Promise<void> {
  await query(`DELETE FROM employee_sessions WHERE token_hash = $1`, [hashToken(token)]);
}

/** 20.48.0 — password reset: инвалидирует ВСЕ существующие сессии
 * сотрудника до выдачи новой (устройство A украдено → пароль меняют на
 * B → токен на A не должен продолжать работать). */
export async function deleteAllForEmployee(employeeId: number, q: typeof query = query): Promise<void> {
  await q(`DELETE FROM employee_sessions WHERE employee_id = $1`, [employeeId]);
}

/** GET /auth/sessions — список своих сессий, самообслуживание (my-plan). */
export async function listForEmployee(
  employeeId: number
): Promise<{ id: number; created_at: string; last_seen_at: string; token_hash: string }[]> {
  const res = await query(
    `SELECT id, created_at, last_seen_at, token_hash FROM employee_sessions
     WHERE employee_id = $1 ORDER BY last_seen_at DESC`,
    [employeeId]
  );
  return res.rows;
}

/** DELETE /auth/sessions/:id — ownership-scoped запросом, не отдельной
 * проверкой (тот же принцип, что belongsToOrg). */
export async function deleteById(id: number, employeeId: number): Promise<{ token_hash: string } | null> {
  const res = await query(
    `DELETE FROM employee_sessions WHERE id = $1 AND employee_id = $2 RETURNING token_hash`,
    [id, employeeId]
  );
  return res.rows[0] || null;
}

/** POST /auth/sessions/revoke-others — «выйти на всех других устройствах»,
 * не трогает текущую вкладку. */
export async function deleteAllExcept(employeeId: number, currentTokenHash: string): Promise<void> {
  await query(
    `DELETE FROM employee_sessions WHERE employee_id = $1 AND token_hash <> $2`,
    [employeeId, currentTokenHash]
  );
}

export async function createPasswordReset(employeeId: number, createdBy: number | null): Promise<string> {
  const token = generateToken();
  await query(
    `INSERT INTO employee_password_resets (employee_id, token_hash, created_by, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [employeeId, hashToken(token), createdBy]
  );
  return token;
}

export async function resolvePasswordReset(token: string): Promise<{ id: number; employee_id: number } | null> {
  const res = await query(
    `SELECT id, employee_id FROM employee_password_resets
     WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL`,
    [hashToken(token)]
  );
  return res.rows[0] || null;
}

export async function consumePasswordReset(id: number): Promise<void> {
  await query(`UPDATE employee_password_resets SET used_at = now() WHERE id = $1`, [id]);
}
