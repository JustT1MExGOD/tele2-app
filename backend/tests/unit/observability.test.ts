/**
 * 20.32.0 (Production Observability) — health/readiness semantics and
 * Prometheus metrics instrumentation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getApp } from '../helpers/app.js';
import { pool } from '../../src/data/db/index.js';
import { runJob } from '../../src/cron/job-logger.js';
import { isApplicationReady, markApplicationReady, resetApplicationReadyForTests } from '../../src/platform/observability/readiness.js';
import { metricsRegistry, httpRequestsTotal, jobsTotal, jobsDuration, jobsFailuresTotal, aiRequestsTotal, aiRequestFailuresTotal } from '../../src/platform/observability/metrics.js';

// insertAudit пишет в ai_audit — не предмет этого теста (нет ни одного
// существующего теста AI-клиента вообще, ни фикстур для его очистки),
// поэтому мокаем репозиторий целиком, чтобы проверить только инструментацию
// метрик, не тащить за собой новую DB-фикстуру ради несвязанной фичи.
vi.mock('../../src/data/repositories/ai.js', () => ({
  insertAudit: vi.fn().mockResolvedValue(undefined),
  findLatestResponse: vi.fn().mockResolvedValue(null)
}));

describe('/healthz — process liveness', () => {
  it('всегда 200, без обращения к БД/интеграциям', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('/readyz — готовность обслуживать нагрузку', () => {
  afterEach(() => {
    markApplicationReady(); // возвращаем в нормальное состояние для остальных тестов файла
    vi.restoreAllMocks();
  });

  it('bootstrap завершён (buildApp() уже отработал) + БД доступна — 200 ready', async () => {
    const app = await getApp();
    expect(isApplicationReady()).toBe(true); // buildApp() внутри getApp() уже вызвал markApplicationReady()
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  it('bootstrap ещё не завершён (флаг сброшен) — 503 bootstrap_incomplete, до реального обращения к БД', async () => {
    const app = await getApp();
    resetApplicationReadyForTests();
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', reason: 'bootstrap_incomplete' });
  });

  it('bootstrap завершён, но БД недоступна — 503 database_unreachable', async () => {
    const app = await getApp();
    vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('connection refused'));
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', reason: 'database_unreachable' });
  });
});

describe('/integrations/health — диагностический срез конфигурации', () => {
  it('сообщает только наличие env-переменных, не бьёт живым запросом ни в одну интеграцию', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/integrations/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.telegram.configured).toBe('boolean');
    expect(typeof body.ai.configured).toBe('boolean');
  });
});

describe('/metrics/system — Prometheus exposition', () => {
  // §5 (Auth Assurance Hardening, 20.52.1) — не /metrics: та строка
  // принадлежит бизнес-каталогу кастомных метрик (api/routes/metrics.ts),
  // коллизия между ними ронялa регистрацию business-модуля целиком молча
  // (registerAllRoutes() ловил ошибку и продолжал) — см. app.ts.
  it('отдаёт text/plain Prometheus-формат, включающий HTTP/DB/jobs/AI метрики', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/metrics/system' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('http_requests_total');
    expect(res.body).toContain('db_query_duration_seconds');
    expect(res.body).toContain('jobs_total');
    expect(res.body).toContain('ai_requests_total');
    // process-метрики от collectDefaultMetrics() — подтверждает, что baseline подключён
    expect(res.body).toMatch(/process_cpu_user_seconds_total|nodejs_/);
  });

  it('http_requests_total: route — паттерн ("/healthz"), не резолвнутый URL с реальным id', async () => {
    const app = await getApp();
    await app.inject({ method: 'GET', url: '/healthz' });
    const metric = await httpRequestsTotal.get();
    const healthzSample = metric.values.find((v) => v.labels.route === '/healthz');
    expect(healthzSample).toBeDefined();
    expect(healthzSample!.value).toBeGreaterThan(0);
    // ни один лейбл route не должен выглядеть как конкретный id-содержащий путь —
    // высокая кардинальность недопустима по спецификации фичи.
    const idLike = metric.values.filter((v) => /\/\d+(\/|$)/.test(String(v.labels.route)));
    expect(idLike).toEqual([]);
  });
});

describe('jobs_* метрики (runJob инструментирован)', () => {
  afterEach(() => metricsRegistry.resetMetrics());

  it('успешный job: jobs_total{result=success} инкрементится, jobs_duration_seconds пишется, jobs_failures_total — нет', async () => {
    await runJob('test.metrics.ok', async () => {});
    const total = await jobsTotal.get();
    const success = total.values.find((v) => v.labels.job === 'test.metrics.ok' && v.labels.result === 'success');
    expect(success?.value).toBe(1);

    const duration = await jobsDuration.get();
    const durationSample = duration.values.find((v) => v.labels.job === 'test.metrics.ok' && v.metricName === 'jobs_duration_seconds_count');
    expect(durationSample?.value).toBe(1);

    const failures = await jobsFailuresTotal.get();
    expect(failures.values.find((v) => v.labels.job === 'test.metrics.ok')).toBeUndefined();
  });

  it('упавший job: jobs_total{result=failure} И jobs_failures_total оба инкрементятся', async () => {
    await runJob('test.metrics.fail', async () => {
      throw new Error('boom');
    });
    const total = await jobsTotal.get();
    const failure = total.values.find((v) => v.labels.job === 'test.metrics.fail' && v.labels.result === 'failure');
    expect(failure?.value).toBe(1);

    const failures = await jobsFailuresTotal.get();
    const failureSample = failures.values.find((v) => v.labels.job === 'test.metrics.fail');
    expect(failureSample?.value).toBe(1);
  });
});

describe('ai_* метрики (callGroq инструментирован)', () => {
  const originalKey = process.env.GROQ_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    metricsRegistry.resetMetrics();
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  it('без GROQ_API_KEY — ничего не считает (запрос физически не уходит)', async () => {
    delete process.env.GROQ_API_KEY;
    const { generateShiftSummary } = await import('../../src/integrations/ai/client.js');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await generateShiftSummary({ employeeId: 1, employeeName: 'Т', planPct: 100, idealShift: true, fact: {}, dayPlan: {}, xpGained: 0, leveledUp: false, streakDays: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
    const total = await aiRequestsTotal.get();
    expect(total.values.find((v) => v.labels.operation === 'shift_summary')).toBeUndefined();
  });

  it('успешный вызов — ai_requests_total{operation=shift_summary} инкрементится, ai_request_failures_total — нет', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const { generateShiftSummary } = await import('../../src/integrations/ai/client.js');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Отличная смена!' } }] }) })
    );
    await generateShiftSummary({ employeeId: 1, employeeName: 'Т', planPct: 100, idealShift: true, fact: {}, dayPlan: {}, xpGained: 0, leveledUp: false, streakDays: 1 });
    const total = await aiRequestsTotal.get();
    expect(total.values.find((v) => v.labels.operation === 'shift_summary')?.value).toBe(1);
    const failures = await aiRequestFailuresTotal.get();
    expect(failures.values.find((v) => v.labels.operation === 'shift_summary')).toBeUndefined();
  });

  it('провайдер отвечает ошибкой — ai_request_failures_total{operation=shift_summary} инкрементится', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const { generateShiftSummary } = await import('../../src/integrations/ai/client.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'error' }));
    await generateShiftSummary({ employeeId: 1, employeeName: 'Т', planPct: 100, idealShift: true, fact: {}, dayPlan: {}, xpGained: 0, leveledUp: false, streakDays: 1 });
    const failures = await aiRequestFailuresTotal.get();
    expect(failures.values.find((v) => v.labels.operation === 'shift_summary')?.value).toBe(1);
  });
});
