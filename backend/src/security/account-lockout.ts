/**
 * Temporary account lockout for failed primary-credential verification.
 *
 * This is intentionally separate from security/rate-limit.ts: the distributed
 * rate-limit bounds request volume by IP/identity across a time window, while
 * this state follows one employee account and blocks consecutive password
 * failures even when the attacker rotates IPs. The row is kept in Postgres so
 * the decision is shared by all backend instances.
 */
import { query } from '../data/db/index.js';

export const ACCOUNT_LOCKOUT_THRESHOLD = 5;
export const ACCOUNT_LOCKOUT_FAILURE_WINDOW_SECONDS = 15 * 60;
export const ACCOUNT_LOCKOUT_DURATION_SECONDS = 15 * 60;

export interface AccountLockoutLogger {
  error: (obj: unknown, msg?: string) => void;
}

export interface AccountLockoutState {
  locked: boolean;
  lockedUntil: string | null;
  storageFailure?: boolean;
}

/**
 * A lock is checked separately from the failed-attempt mutation. The caller
 * must reject before running password verification, so a known locked account
 * cannot keep spending scrypt work or advance the counter.
 */
export async function getAccountLockout(employeeId: number, log?: AccountLockoutLogger): Promise<AccountLockoutState> {
  try {
    const result = await query(
      `SELECT locked_until
       FROM security_account_lockouts
       WHERE employee_id = $1 AND locked_until > now()`,
      [employeeId]
    );
    const lockedUntil = result.rows[0]?.locked_until ? String(result.rows[0].locked_until) : null;
    return { locked: lockedUntil !== null, lockedUntil };
  } catch (error) {
    // Fail closed: a storage failure must not turn the lockout into an allow.
    log?.error({ err: error, employee_id: employeeId }, 'security_account_lockout_storage_failure');
    return { locked: true, lockedUntil: null, storageFailure: true };
  }
}

/**
 * Atomically records one failed password verification and returns whether this
 * failure reaches the lock threshold. When the previous failure is outside the
 * consecutive-failure window, the sequence starts at one again.
 */
export async function recordFailedLogin(employeeId: number, log?: AccountLockoutLogger): Promise<AccountLockoutState> {
  try {
    const result = await query(
      `INSERT INTO security_account_lockouts
         (employee_id, failed_attempts, first_failed_at, last_failed_at, locked_until, updated_at)
       VALUES ($1, 1, now(), now(), NULL, now())
       ON CONFLICT (employee_id) DO UPDATE SET
         failed_attempts = CASE
           WHEN security_account_lockouts.last_failed_at < now() - ($2 || ' seconds')::interval THEN 1
           ELSE security_account_lockouts.failed_attempts + 1
         END,
         first_failed_at = CASE
           WHEN security_account_lockouts.last_failed_at < now() - ($2 || ' seconds')::interval THEN now()
           ELSE security_account_lockouts.first_failed_at
         END,
         last_failed_at = now(),
         locked_until = CASE
           WHEN security_account_lockouts.locked_until > now() THEN security_account_lockouts.locked_until
           WHEN (
             CASE
               WHEN security_account_lockouts.last_failed_at < now() - ($2 || ' seconds')::interval THEN 1
               ELSE security_account_lockouts.failed_attempts + 1
             END
           ) >= $3 THEN now() + ($4 || ' seconds')::interval
           ELSE NULL
         END,
         updated_at = now()
       RETURNING locked_until`,
      [
        employeeId,
        ACCOUNT_LOCKOUT_FAILURE_WINDOW_SECONDS,
        ACCOUNT_LOCKOUT_THRESHOLD,
        ACCOUNT_LOCKOUT_DURATION_SECONDS
      ]
    );
    const lockedUntil = result.rows[0]?.locked_until ? String(result.rows[0].locked_until) : null;
    return { locked: lockedUntil !== null, lockedUntil };
  } catch (error) {
    log?.error({ err: error, employee_id: employeeId }, 'security_account_lockout_storage_failure');
    return { locked: true, lockedUntil: null, storageFailure: true };
  }
}

/** A valid primary credential ends the consecutive-failure sequence. */
export async function clearAccountLockout(employeeId: number, log?: AccountLockoutLogger): Promise<boolean> {
  try {
    await query(`DELETE FROM security_account_lockouts WHERE employee_id = $1`, [employeeId]);
    return true;
  } catch (error) {
    // Fail closed: if the successful login cannot clear the state, do not mint
    // a session that may be immediately followed by a stale lock decision.
    log?.error({ err: error, employee_id: employeeId }, 'security_account_lockout_clear_failure');
    return false;
  }
}
