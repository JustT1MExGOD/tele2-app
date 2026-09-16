/**
 * Offline IP→city geolocation for the "active sessions" display (mirrors
 * Telegram's own device list, which shows city/country per session).
 * MaxMind's free GeoLite2-City database, looked up locally — no
 * per-request network call and no employee IP sent to a third party (a
 * hosted geo-IP API was the simpler alternative, rejected for exactly
 * that reason). The .mmdb file isn't committed (see paths.ts) — its
 * absence is a normal, expected state (fresh clone, CI, before the first
 * refresh run), so every failure mode here degrades to "no location
 * shown", never to a crash or a rejected login.
 */
import { open, type Reader, type CityResponse } from 'maxmind';
import net from 'net';
import { getDbPath } from './paths.js';

export interface GeoLocation {
  city: string | null;
  country: string | null;
  countryCode: string | null;
}

// undefined = not attempted yet, null = attempted and unavailable.
let reader: Reader<CityResponse> | null | undefined;
let warnedMissing = false;

async function getReader(): Promise<Reader<CityResponse> | null> {
  if (reader !== undefined) return reader;
  try {
    reader = await open<CityResponse>(getDbPath());
  } catch {
    reader = null;
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(
        '[geoip] GeoLite2-City.mmdb not found — session locations will be empty until `npm run geoip:update` is run ' +
          '(needs MAXMIND_ACCOUNT_ID/MAXMIND_LICENSE_KEY).'
      );
    }
  }
  return reader;
}

/** Called by cron/geoip-refresh.ts right after a successful download so the
 * new file is picked up without a server restart. */
export function invalidateReaderCache(): void {
  reader = undefined;
  warnedMissing = false;
}

function isPublicIp(ip: string): boolean {
  if (net.isIP(ip) === 0) return false;
  if (ip === '::1' || ip === '127.0.0.1') return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('::ffff:127.')) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^::ffff:10\./.test(ip) || /^::ffff:192\.168\./.test(ip)) return false;
  return true;
}

export async function lookupCity(ip: string | null | undefined): Promise<GeoLocation | null> {
  if (!ip || !isPublicIp(ip)) return null;
  const r = await getReader();
  if (!r) return null;
  try {
    const result = r.get(ip);
    if (!result) return null;
    return {
      city: result.city?.names?.en ?? null,
      country: result.country?.names?.en ?? null,
      countryCode: result.country?.iso_code ?? null
    };
  } catch {
    return null;
  }
}
