/**
 * Downloads the current GeoLite2-City.mmdb from MaxMind's GeoIP Update
 * download endpoint (HTTP Basic auth, account_id:license_key — the
 * legacy `?license_key=` query-string API MaxMind used to publish is
 * deprecated). Free MaxMind account + license key required; see
 * https://www.maxmind.com/en/geolite2/signup. Both the one-off script
 * (scripts/update-geoip-db.ts) and the weekly cron
 * (cron/geoip-refresh.ts, matching GeoLite2's own weekly release cadence)
 * call this — one implementation, two schedules.
 */
import { createWriteStream } from 'fs';
import { mkdir, rename, rm } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import { getDbPath } from './paths.js';
import { invalidateReaderCache } from './lookup.js';

const DOWNLOAD_URL = 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz';

export class GeoipCredentialsMissingError extends Error {
  constructor() {
    super('MAXMIND_ACCOUNT_ID/MAXMIND_LICENSE_KEY not set — skipping GeoLite2 refresh');
    this.name = 'GeoipCredentialsMissingError';
  }
}

/** Downloads the tar.gz, extracts just the .mmdb into place, and swaps it
 * in atomically (write to a temp path, rename over the live file) so a
 * concurrent lookup never sees a half-written database. Throws
 * GeoipCredentialsMissingError when credentials aren't configured — the
 * caller decides whether that's a hard failure (script) or a quiet no-op
 * (cron, matches this repo's pattern for optional integrations like
 * BOT_TOKEN). */
export async function downloadLatestDb(): Promise<void> {
  const accountId = process.env.MAXMIND_ACCOUNT_ID;
  const licenseKey = process.env.MAXMIND_LICENSE_KEY;
  if (!accountId || !licenseKey) throw new GeoipCredentialsMissingError();

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  await mkdir(dir, { recursive: true });

  const tmpTarPath = path.join(dir, `.download-${Date.now()}.tar.gz`);
  const extractDir = path.join(dir, `.extract-${Date.now()}`);
  const tmpDbPath = `${dbPath}.tmp`;

  try {
    const res = await fetch(DOWNLOAD_URL, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${accountId}:${licenseKey}`).toString('base64') }
    });
    if (!res.ok || !res.body) {
      throw new Error(`MaxMind download failed: ${res.status} ${res.statusText}`);
    }
    await pipeline(res.body as any, createWriteStream(tmpTarPath));

    await mkdir(extractDir, { recursive: true });
    await tar.extract({ file: tmpTarPath, cwd: extractDir });

    // MaxMind ships the mmdb inside a dated subdirectory
    // (GeoLite2-City_YYYYMMDD/GeoLite2-City.mmdb) — find it rather than
    // hardcoding that folder name, since it changes every release.
    const { readdir } = await import('fs/promises');
    const entries = await readdir(extractDir, { recursive: true } as any);
    const mmdbEntry = (entries as string[]).find((e) => e.endsWith('GeoLite2-City.mmdb'));
    if (!mmdbEntry) throw new Error('GeoLite2-City.mmdb not found in downloaded archive');

    const { copyFile } = await import('fs/promises');
    await copyFile(path.join(extractDir, mmdbEntry), tmpDbPath);
    await rename(tmpDbPath, dbPath);
    invalidateReaderCache();
  } finally {
    await rm(tmpTarPath, { force: true }).catch(() => {});
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await rm(tmpDbPath, { force: true }).catch(() => {});
  }
}
