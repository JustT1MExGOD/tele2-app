/**
 * GeoLite2-City is republished by MaxMind roughly weekly (Tuesdays) — this
 * refreshes our copy on the same cadence, same "cron.schedule('* * * * *',
 * ...) + manual day/time gate" pattern as the rest of src/cron/. Missing
 * MAXMIND_ACCOUNT_ID/MAXMIND_LICENSE_KEY is a normal, expected state (geo-IP
 * is optional — sessions just show no location) and quietly no-ops, same
 * as BOT_TOKEN-gated features elsewhere in this codebase.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { nowTimeMoscow, nowDayOfWeekMoscow } from '../utils/date.js';
import { downloadLatestDb, GeoipCredentialsMissingError } from '../integrations/geoip/refresh.js';
import { runJob, jobLogger } from './job-logger.js';

export async function refreshGeoipDb(): Promise<void> {
  await runJob('geoip.refresh', async () => {
    try {
      await downloadLatestDb();
      jobLogger.info({ job: 'geoip.refresh' }, 'GeoLite2-City.mmdb updated');
    } catch (e) {
      if (e instanceof GeoipCredentialsMissingError) return; // expected, not an error
      throw e;
    }
  });
}

/** Возвращает handle — graceful shutdown (index.ts) должен уметь снять таймер. */
export function startGeoipRefreshCron(): ScheduledTask {
  const task = cron.schedule('* * * * *', () => {
    if (nowDayOfWeekMoscow() !== 3 || nowTimeMoscow() !== '04:00') return; // Wed 04:00 МСК
    refreshGeoipDb().catch((e) =>
      jobLogger.error({ job: 'geoip.refresh', err: e?.message || String(e) }, 'pre-gate failed')
    );
  });
  console.log('🌍 GeoIP refresh cron started (Wed 04:00 МСК)');
  return task;
}
