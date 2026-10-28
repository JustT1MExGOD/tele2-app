/**
 * Persistent counterpart of route-level @fastify/rate-limit settings.
 *
 * The in-memory plugin still owns the immediate per-process response and
 * headers. This hook mirrors explicit sensitive-route limits in Postgres so
 * the same route budget survives restarts and is shared by instances.
 * Credential-verification routes are excluded because their handlers already
 * use identity/account dimensions that are stricter than a generic route key.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { accountDimension, consume, ipDimension } from './rate-limit.js';

const CREDENTIAL_ROUTES = new Set([
  'POST /auth/login',
  'POST /auth/reset/:token',
  'POST /auth/login/mfa',
  'POST /auth/mfa/step-up',
  'POST /auth/mfa/totp/confirm',
  'POST /auth/mfa/telegram/verify',
  'POST /miranda/accounts/login'
]);

function parseWindowSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.ceil(value / 1000));
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'ms'
    ? 1 / 1000
    : ['s', 'sec', 'secs', 'second', 'seconds'].includes(unit)
      ? 1
      : ['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)
        ? 3600
        : 60;
  return Math.max(1, Math.ceil(amount * multiplier));
}

function routeKey(request: FastifyRequest): string {
  return `${request.method} ${request.routeOptions.url || 'not_found'}`;
}

/**
 * Returns false after sending a response. The caller's preHandler must return
 * immediately in that case so the route handler cannot run after a denial.
 */
export async function enforceDistributedRouteRateLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const config = (request.routeOptions.config as { rateLimit?: unknown } | undefined)?.rateLimit;
  if (!config || config === false) return true;

  const action = routeKey(request);
  if (CREDENTIAL_ROUTES.has(action)) return true;
  if (typeof config !== 'object' || config === null) return true;

  const options = config as { max?: unknown; timeWindow?: unknown };
  const max = typeof options.max === 'number' && Number.isFinite(options.max) ? Math.floor(options.max) : null;
  const windowSeconds = parseWindowSeconds(options.timeWindow);
  if (max === null || max < 0 || windowSeconds === null) {
    // Current route policy is declarative numeric/standard-string config. If a
    // future route uses a dynamic function, leave it to @fastify/rate-limit
    // rather than inventing a weaker persistent interpretation.
    return true;
  }

  // Whenever an identity resolved (any provider), the persistent mirror keys
  // by employee — a rotating-IP attacker can't exhaust the budget and the
  // in-memory plugin still enforces its own per-IP (or custom) key in the
  // same request path, so NAT'd employees stay bounded. Anonymous routes
  // (public directory, avatar, access requests) fall back to the IP key.
  const dimensions = request.user?.employee_id
    ? [accountDimension(`route:${action}`, request.user.employee_id, max, windowSeconds)]
    : [ipDimension(`route:${action}`, request.ip, max, windowSeconds)];
  const result = await consume(dimensions, request.log);
  if (!result.allowed) {
    reply.code(429).send({ error: 'rate_limited', message: 'Слишком много запросов — попробуйте позже' });
    return false;
  }
  return true;
}

export const distributedRouteRateLimitCredentialRoutes = CREDENTIAL_ROUTES;
