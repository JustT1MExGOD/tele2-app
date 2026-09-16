/**
 * The GeoLite2-City .mmdb itself is never committed (binary, MaxMind's
 * license doesn't fit git well, and it's refreshed independently — see
 * cron/geoip-refresh.ts) — this just resolves where it lives on disk so
 * lookup.ts and the refresh job agree without duplicating the path.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/integrations/geoip/paths.ts (or dist/integrations/geoip/paths.js) -> backend/
const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(BACKEND_ROOT, 'data', 'geoip', 'GeoLite2-City.mmdb');

export function getDbPath(): string {
  return process.env.GEOIP_DB_PATH || DEFAULT_DB_PATH;
}
