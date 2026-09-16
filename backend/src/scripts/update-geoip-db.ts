/**
 * `npm run geoip:update` — one-off/manual run of the same download logic
 * the weekly cron (cron/geoip-refresh.ts) uses. Unlike the cron, a
 * failure here is a hard failure (non-zero exit) — this is an explicit
 * ask to fetch the DB, not a background best-effort tick.
 */
import { downloadLatestDb } from '../integrations/geoip/refresh.js';

downloadLatestDb()
  .then(() => {
    console.log('GeoLite2-City.mmdb updated.');
  })
  .catch((e) => {
    console.error('geoip:update failed:', e?.message || e);
    process.exit(1);
  });
