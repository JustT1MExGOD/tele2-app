/**
 * 20.10.0 (Audit & Observability 2.0) — структурные логи фоновых задач
 * (cron-тики), тем же форматом (pino JSON), что и HTTP-запросы через
 * Fastify (app.log) — в Railway logs оба потока грепаются одинаково.
 *
 * Отдельный pino-инстанс, не app.log: cron стартует уже ПОСЛЕ app.listen()
 * в index.ts, но принципиально не должен зависеть от Fastify-инстанса —
 * это фоновые задачи, не HTTP-обработчики (см. также src/auth/ — тот же
 * принцип отделения по слоям, что 20.9.0).
 *
 * runJob() ловит и логирует ошибку сама, не пробрасывает — тот же эффект,
 * что раньше давал `.catch(console.error)` на каждом вызове внутри
 * cron.schedule(), просто структурно и с длительностью. НЕ используется
 * вокруг функций, которые дублируются как HTTP-эндпоинт ручного запуска
 * (sendMicroReports/sendFinalReports/sendNetworkDigest/runSmartAlertsTick) —
 * там ошибка должна долетать до route-обработчика как обычно.
 */
import pino from 'pino';
import { jobsTotal, jobsDuration, jobsFailuresTotal } from '../platform/observability/metrics.js';

export const jobLogger = pino({ name: 'cron' });

export async function runJob(jobName: string, fn: () => Promise<unknown>): Promise<void> {
  const start = Date.now();
  const endTimer = jobsDuration.startTimer({ job: jobName });
  jobLogger.info({ job: jobName }, 'job started');
  try {
    await fn();
    endTimer();
    jobsTotal.inc({ job: jobName, result: 'success' });
    jobLogger.info({ job: jobName, duration_ms: Date.now() - start }, 'job finished');
  } catch (e: any) {
    endTimer();
    jobsTotal.inc({ job: jobName, result: 'failure' });
    jobsFailuresTotal.inc({ job: jobName });
    jobLogger.error(
      { job: jobName, duration_ms: Date.now() - start, err: e?.message || String(e) },
      'job failed'
    );
  }
}
