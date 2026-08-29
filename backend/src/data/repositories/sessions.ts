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

/** Абсолютный TTL (§9 — «for privileged users consider shorter lifetimes»):
 * admin/supervisor держат более широкий доступ, поэтому короче живут по
 * умолчанию — 7 дней, не 30. */
const ABSOLUTE_TTL_DAYS_PRIVILEGED = 7;
const ABSOLUTE_TTL_DAYS_DEFAULT = 30;
/** Idle-таймаут (20.52.0) — раньше был только абсолютный TTL, sessions
 * roadmap в docs/SECURITY.md явно называл отсутствие idle-таймаута
 * известным пробелом. Сессия, к которой не притрагивались 14 дней,
 * перестаёт резолвиться, даже если её абсолютный TTL ещё не истёк.
 *
 * §13 (Auth Assurance Hardening, 20.52.1) — 14 дней idle было ЕДИНОЙ
 * политикой для всех, а privileged absolute TTL уже 7 дней — то есть idle
 * никогда фактически не успевал сработать раньше абсолютного истечения
 * для admin/supervisor (14 > 7), полностью бессмысленный параметр именно
 * для той роли, ради которой его в первую очередь стоило заводить.
 * Отдельный, заметно короче, idle-таймаут для privileged-ролей — открытая
 * вкладка администратора, оставленная без дела на ночь, не должна
 * оставаться рабочей сессией до утра.
 */
const IDLE_TIMEOUT_HOURS_PRIVILEGED = 18;
const IDLE_TIMEOUT_DAYS_DEFAULT = 14;

const PRIVILEGED_ROLES = new Set(['admin', 'supervisor']);

/**
 * `mfaVerified` — 20.52.0: true only when this session was issued right
 * after a successful second-factor check (POST /auth/mfa/login), so
 * downstream code can tell "this browser session completed MFA" (AAL2)
 * apart from "password/reset alone".
 * `role` — определяет абсолютный TTL (см. ABSOLUTE_TTL_DAYS_PRIVILEGED);
 * необязателен для обратной совместимости существующих вызовов, но без
 * него privileged-роли получают дефолтный (более длинный) TTL.
 */
export async function createSession(employeeId: number, mfaVerified = false, role?: string | null): Promise<string> {
  const token = generateToken();
  const ttlDays = role && PRIVILEGED_ROLES.has(role) ? ABSOLUTE_TTL_DAYS_PRIVILEGED : ABSOLUTE_TTL_DAYS_DEFAULT;
  await query(
    `INSERT INTO employee_sessions (employee_id, token_hash, expires_at, mfa_verified_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, ${mfaVerified ? 'now()' : 'NULL'})`,
    [employeeId, hashToken(token), String(ttlDays)]
  );
  return token;
}

/**
 * `mfa_verified_at` (20.52.0/20.52.1) — surfaced to the caller so
 * auth/guards.ts can tell "this session actually completed MFA" (AAL2)
 * apart from "the account merely has MFA configured" (see
 * auth/assurance.ts::checkPrivilegedAssurance — the two are different
 * guarantees, RESET-1/ROLE-1 invariants).
 *
 * Idle timeout is role-dependent (§13) — joins employees for the
 * CURRENT role (not a role snapshotted at session creation), same
 * "always read fresh" principle principal.ts already applies to
 * authorization decisions elsewhere in this codebase.
 */
export async function resolveSession(token: string): Promise<{ employee_id: number; mfa_verified_at: string | null } | null> {
  const res = await query(
    `SELECT es.employee_id, es.mfa_verified_at
     FROM employee_sessions es
     JOIN employees e ON e.id = es.employee_id
     WHERE es.token_hash = $1
       AND es.expires_at > now()
       AND es.last_seen_at > now() - (
         CASE WHEN e.role = ANY($2::text[])
           THEN ($3 || ' hours')::interval
           ELSE ($4 || ' days')::interval
         END
       )`,
    [hashToken(token), Array.from(PRIVILEGED_ROLES), String(IDLE_TIMEOUT_HOURS_PRIVILEGED), String(IDLE_TIMEOUT_DAYS_DEFAULT)]
  );
  return res.rows[0] || null;
}

/** §6/ROLE-1 — upgrades an already-issued session to AAL2 the moment its
 * owner proves a factor server-side within that same request (MFA
 * enrollment confirm, WebAuthn registration verify) — avoids forcing a
 * redundant logout+relogin right after enrollment while staying
 * cryptographically honest (a real factor WAS just verified for this
 * session, not merely configured on the account). Silently no-ops for
 * Telegram-authenticated callers (no token). */
export async function markSessionMfaVerified(token: string): Promise<void> {
  await query(`UPDATE employee_sessions SET mfa_verified_at = now() WHERE token_hash = $1`, [hashToken(token)]);
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

/**
 * Auth Assurance Hardening (20.52.1, §8 доп. аудит) — atomic claim in one
 * statement (`UPDATE...WHERE used_at IS NULL...RETURNING`), not the
 * former resolve-then-consume pair (separate SELECT + UPDATE). Two
 * concurrent requests with the same reset token (double-submit on a
 * flaky connection, or a raced replay) could both pass the SELECT's
 * `used_at IS NULL` check before either UPDATE ran — both then setting a
 * password from the same one-time token, whichever write landed last
 * silently winning with no signal to the caller which one took effect.
 * Now: only the caller that wins the atomic claim proceeds at all.
 */
export async function claimPasswordReset(token: string, q: typeof query = query): Promise<{ id: number; employee_id: number } | null> {
  const res = await q(
    `UPDATE employee_password_resets SET used_at = now()
     WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL
     RETURNING id, employee_id`,
    [hashToken(token)]
  );
  return res.rows[0] || null;
}
