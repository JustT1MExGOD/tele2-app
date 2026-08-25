/**
 * 20.32.0 (Production Observability) — Prometheus exposition metrics.
 * Own Registry (not the global default) so tests can spin up isolated
 * counters without cross-test pollution; collectDefaultMetrics() adds the
 * standard Node.js process metrics (CPU, memory, event-loop lag, GC) on top
 * of the four domain-specific groups below — that's the usual baseline for
 * adopting prom-client and costs nothing extra to expose once the registry
 * exists.
 *
 * prom-client is deprecated in favor of @prometheus-io/client (the official
 * Prometheus org's own JS client) — but that package is pre-1.0 (0.16.0, 3
 * published versions) while prom-client has years of production use across
 * the ecosystem. Chose the boring, proven option for a production
 * observability feature; migrating later is a small, contained change
 * (this file is the only place that imports prom-client).
 *
 * Deliberately NOT labeling DB metrics by repository/domain in this first
 * version — every repository call would need threading an operation name
 * through, touching ~30 files for a label that's genuinely useful but not
 * required to answer "is the DB slow / erroring right now". Aggregate
 * db_query_duration_seconds/db_query_errors_total ship now; per-domain
 * breakdown is a natural v2 if the aggregate signal isn't enough.
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

// ---------- HTTP ----------
// route = the route PATTERN (e.g. '/employees/:id'), never the resolved URL —
// resolved URLs carry IDs, which would make this label unbounded cardinality
// (a new time series per employee/store/etc. ever requested, forever).
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry]
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry]
});

export const httpRequestsInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests currently being processed',
  labelNames: ['method', 'route'] as const,
  registers: [metricsRegistry]
});

// ---------- Database ----------
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'PostgreSQL query duration in seconds',
  registers: [metricsRegistry]
});

export const dbQueryErrorsTotal = new Counter({
  name: 'db_query_errors_total',
  help: 'PostgreSQL query errors',
  registers: [metricsRegistry]
});

// ---------- Jobs / cron / workers ----------
export const jobsTotal = new Counter({
  name: 'jobs_total',
  help: 'Total background job executions',
  labelNames: ['job', 'result'] as const,
  registers: [metricsRegistry]
});

export const jobsDuration = new Histogram({
  name: 'jobs_duration_seconds',
  help: 'Background job duration in seconds',
  labelNames: ['job'] as const,
  registers: [metricsRegistry]
});

export const jobsFailuresTotal = new Counter({
  name: 'jobs_failures_total',
  help: 'Total background job failures',
  labelNames: ['job'] as const,
  registers: [metricsRegistry]
});

// ---------- AI / integrations ----------
// operation = a fixed small set ('shift_summary'/'dip_comment'/
// 'forecast_summary', same vocabulary as ai_audit.kind) — never the prompt
// or any user/employee identifier.
export const aiRequestsTotal = new Counter({
  name: 'ai_requests_total',
  help: 'Total AI provider requests',
  labelNames: ['operation'] as const,
  registers: [metricsRegistry]
});

export const aiRequestDuration = new Histogram({
  name: 'ai_request_duration_seconds',
  help: 'AI provider request duration in seconds',
  labelNames: ['operation'] as const,
  registers: [metricsRegistry]
});

export const aiRequestFailuresTotal = new Counter({
  name: 'ai_request_failures_total',
  help: 'Total AI provider request failures',
  labelNames: ['operation'] as const,
  registers: [metricsRegistry]
});
