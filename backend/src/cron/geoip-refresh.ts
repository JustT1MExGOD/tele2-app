/**
 * GeoLite2-City is republished roughly weekly — this refreshes our copy
 * on the same cadence, same "cron.schedule('* * * * *', ...) + manual
 * day/time gate" pattern as the rest of src/cron/. A download failure
 * (mirror unreachable, network blip) is a normal, expected state
 * (geo-IP is optional — sessions just show no location) and is logged
 * but never rethrown, same as BOT_TOKEN-gated features elsewhere in
 * this codebase.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { existsSync } from 'fs';
import { nowTimeMoscow, nowDayOfWeekMoscow } from '../utils/date.js';
import { downloadLatestDb } from '../integrations/geoip/refresh.js';
import { getDbPath } from '../integrations/geoip/paths.js';
import { runJob, jobLogger } from './job-logger.js';

export async function refreshGeoipDb(): Promise<void> {
  await runJob('geoip.refresh', async () => {
    try {
      await downloadLatestDb();
      jobLogger.info({ job: 'geoip.refresh' }, 'GeoLite2-City.mmdb updated');
    } catch (e: any) {
      jobLogger.error({ job: 'geoip.refresh', err: e?.message || String(e) }, 'download failed, keeping existing db');
    }
  });
}

/** Railway's filesystem is ephemeral — every deploy/restart wipes the disk,
 * so a freshly booted instance has no .mmdb until the next Wed 04:00 МСК
 * cron tick (up to a week of empty session locations). Called once at
 * startup, fire-and-forget (same pattern as startBot() in index.ts) — a
 * slow/failed download must never delay server boot or the healthcheck. */
export function ensureGeoipDbOnStartup(): void {
  if (existsSync(getDbPath())) return;
  jobLogger.info({ job: 'geoip.refresh' }, 'GeoLite2-City.mmdb missing on boot, downloading now');
  refreshGeoipDb().catch((e) =>
    jobLogger.error({ job: 'geoip.refresh', err: e?.message || String(e) }, 'startup download failed')
  );
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
