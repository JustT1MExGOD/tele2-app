/**
 * Downloads the current GeoLite2-City.mmdb via jsDelivr's CDN mirror of
 * the `geolite2-city` npm package (wp-statistics/GeoLite2-City on
 * GitHub) — same MaxMind database/format, re-published without an
 * account/license key gate. MaxMind's own download endpoint
 * (download.maxmind.com) actively blocks both direct Russian IPs and
 * VPN egress ("We're not able to offer GeoLite access from country" /
 * "...via proxy or VPN") — this mirror was chosen specifically because
 * it's unaffected (jsDelivr/GitHub are reachable), at the cost of
 * depending on a third-party's update cadence rather than MaxMind's own.
 * Both the one-off script (scripts/update-geoip-db.ts) and the weekly
 * cron (cron/geoip-refresh.ts) call this — one implementation, two
 * schedules.
 */
import { createWriteStream } from 'fs';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { mkdir, rename, rm } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { getDbPath } from './paths.js';
import { invalidateReaderCache } from './lookup.js';

const DOWNLOAD_URL = 'https://cdn.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz';

/** Downloads the .mmdb.gz, decompresses it, and swaps it in atomically
 * (write to a temp path, rename over the live file) so a concurrent
 * lookup never sees a half-written database. */
export async function downloadLatestDb(): Promise<void> {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  await mkdir(dir, { recursive: true });

  const tmpGzPath = path.join(dir, `.download-${Date.now()}.mmdb.gz`);
  const tmpDbPath = `${dbPath}.tmp`;

  try {
    const res = await fetch(DOWNLOAD_URL);
    if (!res.ok || !res.body) {
      throw new Error(`GeoLite2 mirror download failed: ${res.status} ${res.statusText}`);
    }
    await pipeline(res.body as any, createWriteStream(tmpGzPath));
    await pipeline(createReadStream(tmpGzPath), createGunzip(), createWriteStream(tmpDbPath));
    await rename(tmpDbPath, dbPath);
    invalidateReaderCache();
  } finally {
    await rm(tmpGzPath, { force: true }).catch(() => {});
    await rm(tmpDbPath, { force: true }).catch(() => {});
  }
}
