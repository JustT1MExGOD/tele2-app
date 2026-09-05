/**
 * Distributed (Postgres-backed) rate limiting for credential-verification
 * endpoints — login, MFA challenge/verify (TOTP/WebAuthn/recovery-code),
 * Telegram AAL2 verify, step-up, password reset (20.54.0, P1-A).
 *
 * Why a second layer on top of the existing @fastify/rate-limit (app.ts,
 * per-route configs already on every one of these routes): that limiter
 * is in-process memory only — reset on every deploy/restart, and would
 * not be shared across instances if this service ever ran more than the
 * single replica the Telegram long-polling bot currently requires (see
 * docs/RUNBOOK.md). This layer persists counters in Postgres so brute-
 * force protection survives restarts, and lets multiple identity axes
 * (IP, account) be enforced together rather than IP alone.
 *
 * Fixed-window counters, not a sliding-window log — a deliberate
 * trade-off: up to ~2x burst is possible right at a window boundary,
 * which does not meaningfully help an attacker against a target that
 * needs thousands of guesses (TOTP, password, recovery code). The
 * storage/complexity cost of a sliding-window log isn't justified for
 * this threat model.
 */
import type { FastifyRequest } from 'fastify';
import { query } from '../data/db/index.js';

/**
 * @fastify/rate-limit keyGenerator for authenticated-only routes reachable
 * through the desktop RELAY (relay/src/forward.ts — the relay calls this
 * backend from its own single outbound connection and deliberately never
 * forwards X-Forwarded-For/X-Real-IP from the original desktop client, see
 * that file's header comment). Without this, every employee using the
 * desktop app through one relay instance would collide on the same
 * IP-keyed per-route quota (hotfix 20.57.1 PASS 2, finding #1).
 *
 * Requires `hook: 'preHandler'` on the route's own `config.rateLimit` —
 * authPlugin (app.ts, global preHandler) must already have resolved
 * request.user, which has not happened yet on the default 'onRequest'
 * hook (confirmed empirically during this investigation: on 'onRequest',
 * both request.body and request.user are still unset — this is also why
 * the existing /auth/login phone-based keyGenerator, which does NOT
 * override the hook, never actually reads a phone and silently always
 * falls back to req.ip; that is a separate pre-existing issue, out of
 * scope for this pass).
 *
 * Unauthenticated traffic (request.user null/undefined) keeps the exact
 * previous IP-based behavior — this only gives authenticated employees an
 * identity-based key instead, it does not remove or weaken any existing
 * protection.
 */
export function employeeAwareKeyGenerator(prefix: string) {
  return (req: FastifyRequest): string => {
    const employeeId = req.user?.employee_id;
    return employeeId ? `${prefix}:emp:${employeeId}` : `${prefix}:ip:${req.ip}`;
  };
}

export interface RateLimitDimension {
  /** Fully-qualified counter key, e.g. `mfa_verify:acct:123`. */
  key: string;
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  blockedBy?: string;
  retryAfterSeconds?: number;
}

export interface RateLimitLogger {
  error: (obj: unknown, msg?: string) => void;
}

/**
 * Checks and atomically increments every dimension. All dimensions are
 * incremented (not short-circuited) so a request that trips one axis
 * still counts against the others — otherwise an attacker could keep
 * one axis "free" by tripping a different one first.
 *
 * Fail-closed on storage failure: denies only THIS request (nothing is
 * written), so no permanent lockout is created and the very next
 * request gets a fresh attempt once storage recovers. These routes
 * already require the database for credential verification itself, so
 * a DB outage already blocks them regardless of this limiter.
 */
export async function consume(dimensions: RateLimitDimension[], log?: RateLimitLogger): Promise<RateLimitResult> {
  try {
    let blocked: { key: string; retryAfterSeconds: number } | null = null;
    for (const dim of dimensions) {
      const windowMs = dim.windowSeconds * 1000;
      const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
      const { rows } = await query(
        `INSERT INTO security_rate_limit_counters (bucket_key, window_start, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (bucket_key, window_start)
         DO UPDATE SET count = security_rate_limit_counters.count + 1
         RETURNING count`,
        [dim.key, windowStart.toISOString()]
      );
      const count = Number(rows[0].count);
      if (count > dim.max && !blocked) {
        blocked = { key: dim.key, retryAfterSeconds: dim.windowSeconds };
      }
    }
    // Probabilistic cleanup — avoids a dedicated cron entry for a table
    // that is low-volume and self-bounding by nature of its callers.
    if (Math.random() < 0.01) {
      query(`DELETE FROM security_rate_limit_counters WHERE window_start < now() - interval '1 day'`).catch(() => {});
    }
    if (blocked) return { allowed: false, blockedBy: blocked.key, retryAfterSeconds: blocked.retryAfterSeconds };
    return { allowed: true };
  } catch (e) {
    log?.error({ err: e }, 'security_rate_limit_storage_failure');
    return { allowed: false, retryAfterSeconds: 5 };
  }
}

export function ipDimension(action: string, ip: string, max: number, windowSeconds: number): RateLimitDimension {
  return { key: `${action}:ip:${ip}`, max, windowSeconds };
}

export function accountDimension(action: string, employeeId: number, max: number, windowSeconds: number): RateLimitDimension {
  return { key: `${action}:acct:${employeeId}`, max, windowSeconds };
}

/** For pre-auth flows where no employee_id is resolvable yet (e.g. an
 * unrecognized phone number) — the caller passes an already-hashed
 * identity string (never raw PII) so unlimited guessing against unknown
 * identities is still bounded. */
export function identityDimension(action: string, identityHash: string, max: number, windowSeconds: number): RateLimitDimension {
  return { key: `${action}:id:${identityHash}`, max, windowSeconds };
}
