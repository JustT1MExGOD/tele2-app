/**
 * Fetches and validates one channel's manifest.json from the configured
 * update origin. A plain Node `https` request (same reasoning as
 * relay-client.ts: no automatic redirect-following, real default TLS
 * verification, no Electron session/cookie involvement at all — the
 * update server is a separate, unauthenticated static file host, never
 * sees a session cookie in the first place).
 */
import https from 'node:https';
import { validateManifest, type UpdateManifest, type UpdateChannelName, ManifestValidationError } from './manifest.js';

/** manifest.json is a few hundred bytes to a few KB in real use — this
 * is a defensive ceiling, not a realistic size. */
const MAX_MANIFEST_BYTES = 1 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export class ManifestFetchError extends Error {}

/**
 * `updateBaseUrl` must already be a validated https:// origin (see
 * main/config.ts::loadDesktopConfig) — this function does not itself
 * accept a client/request-supplied destination; it always requests
 * exactly `{updateBaseUrl}/{channel}/manifest.json`, nothing else, and
 * never follows a redirect to a different host.
 */
/** `extraTrustedCa` is test-only plumbing — same precedent as
 * downloader.ts's own parameter of the same name: adds a certificate to
 * the trusted set for this one request, never disables verification.
 * Omitted (the default — main/updater/manager.ts never passes it),
 * production behavior is Node's own default TLS verification,
 * unchanged. */
export function fetchManifest(
  updateBaseUrl: string,
  channel: UpdateChannelName,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraTrustedCa?: string | Buffer
): Promise<UpdateManifest> {
  const url = new URL(`/${channel}/manifest.json`, updateBaseUrl);
  const allowedOrigin = new URL(updateBaseUrl).origin;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', timeout: timeoutMs, headers: { accept: 'application/json' }, ca: extraTrustedCa, rejectUnauthorized: true },
      (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        // No automatic redirect-following — same invariant as the
        // installer download (§2/§6 of the updater brief): a manifest
        // fetch that gets redirected is treated as a failure, never
        // silently chased to wherever Location points.
        res.resume();
        reject(new ManifestFetchError(`manifest fetch got a redirect (${status}) — redirects are not followed`));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new ManifestFetchError(`manifest fetch failed with HTTP ${status}`));
        return;
      }

      const declaredLength = res.headers['content-length'] ? Number(res.headers['content-length']) : undefined;
      if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
        res.resume();
        reject(new ManifestFetchError(`manifest Content-Length (${declaredLength}) exceeds ${MAX_MANIFEST_BYTES} bytes`));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX_MANIFEST_BYTES) {
          req.destroy();
          reject(new ManifestFetchError(`manifest response exceeded ${MAX_MANIFEST_BYTES} bytes`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          reject(new ManifestFetchError('manifest response is not valid JSON'));
          return;
        }
        try {
          resolve(validateManifest(parsed, channel, allowedOrigin));
        } catch (e) {
          reject(e instanceof ManifestValidationError ? e : new ManifestFetchError(String(e)));
        }
      });
      res.on('error', (e) => reject(new ManifestFetchError(e.message)));
    });
    req.once('timeout', () => req.destroy(new ManifestFetchError('manifest fetch timed out')));
    req.once('error', (e) => reject(new ManifestFetchError(e.message)));
    req.end();
  });
}
