/**
 * Downloads and verifies one installer artifact. Security properties,
 * all load-bearing (§6 of the updater brief):
 *   - HTTPS only, exact allowlisted update origin (re-checked here, not
 *     just trusted from manifest validation — same "never trust your own
 *     validation as the only line of defense" discipline as
 *     relay/src/forward.ts).
 *   - No automatic redirect-following (a 3xx is a hard failure).
 *   - Never buffers the whole file in memory — streamed straight to a
 *     temp file on disk, SHA-256 computed incrementally alongside.
 *   - Hard byte cap enforced DURING streaming (not just checked after
 *     the fact) — an oversized or runaway response is aborted mid-flight.
 *   - Final file size AND SHA-256 both re-verified against the manifest
 *     after the stream completes; on any mismatch the temp file is
 *     deleted and nothing is ever renamed into a runnable location.
 *   - The temp-to-final rename only happens after verification succeeds
 *     — there is no window where a not-yet-verified file has the final
 *     `.exe` name an installer step or a curious user could stumble into
 *     launching.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import type { UpdateManifest } from './manifest.js';

/** `stage` distinguishes a transport-level failure (couldn't get the
 * bytes at all) from an integrity failure (got bytes, they don't match
 * the manifest) — surfaced in sanitized diagnostics (manager.ts) so a
 * real failure can be told apart from another without parsing message
 * text. Message itself is already the short, specific, user-facing
 * (Russian, matching the rest of the updater UI) string — never a raw
 * URL/path/header/stack. */
export class DownloadError extends Error {
  readonly stage: 'download' | 'sha256';
  constructor(message: string, stage: 'download' | 'sha256' = 'download') {
    super(message);
    this.stage = stage;
  }
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface DownloadResult {
  filePath: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Re-verifies an ALREADY-ON-DISK file's size and SHA-256 against expected
 * values — the same streaming-hash/`timingSafeEqual` technique used
 * during the original download, but reusable against a file that's just
 * sitting on disk, no network involved. This exists specifically to
 * close the TOCTOU gap between "downloaded + verified" and "user clicked
 * install": `UpdateManager.installUpdate()` calls this again,
 * immediately before launching, so a file swapped during the
 * `ready_to_install` waiting window (which has no timeout — it waits on
 * a human) is detected and rejected rather than silently executed.
 */
export async function verifyFileIntegrity(filePath: string, expectedSha256: string, expectedSize: number): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    throw new DownloadError('Файл обновления не найден перед установкой', 'sha256');
  }
  if (!stat.isFile()) throw new DownloadError('Файл обновления повреждён (это не обычный файл)', 'sha256');
  if (stat.size !== expectedSize) {
    throw new DownloadError('Размер файла обновления изменился перед установкой', 'sha256');
  }

  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk as Buffer);
    });
    stream.on('end', () => resolve());
    stream.on('error', () => reject(new DownloadError('Не удалось повторно проверить файл обновления', 'sha256')));
  });

  const expected = Buffer.from(expectedSha256, 'hex');
  const actual = Buffer.from(hash.digest('hex'), 'hex');
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!matches) {
    throw new DownloadError('Файл обновления был изменён после проверки — установка отменена', 'sha256');
  }
}

export interface FileDiagnosticSnapshot {
  exists: boolean;
  actualSize: number | null;
  /** First 8 hex characters of the actual SHA-256 only — see
   * diagnostic-log.ts's field discipline; never the full hash. */
  actualSha256Prefix: string | null;
}

/** Non-throwing diagnostic snapshot of an on-disk file (§updater-
 * diagnostic-pass item 6) — reuses the same streaming-hash technique as
 * verifyFileIntegrity() above, but never rejects: a diagnostic read
 * failing (file gone, permission denied, mid-write) is itself useful
 * diagnostic information (`exists: false`), not a reason to throw. This
 * is diagnostic metadata only — it changes no accept/reject decision;
 * verifyFileIntegrity()/the download-time streaming check remain the
 * only functions whose result gates whether the update proceeds. */
export async function snapshotFileForDiagnostics(filePath: string): Promise<FileDiagnosticSnapshot> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return { exists: false, actualSize: null, actualSha256Prefix: null };
  }
  if (!stat.isFile()) {
    return { exists: false, actualSize: null, actualSha256Prefix: null };
  }

  try {
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk: string | Buffer) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve());
      stream.on('error', (e) => reject(e));
    });
    return { exists: true, actualSize: stat.size, actualSha256Prefix: hash.digest('hex').slice(0, 8) };
  } catch {
    return { exists: true, actualSize: stat.size, actualSha256Prefix: null };
  }
}

/** Removes a stale `*.download` leftover from a previous crashed/aborted
 * run before starting a new one — each run's temp filename already gets
 * a fresh random suffix (never collides with a prior run's), so this is
 * disk-space hygiene, not a correctness requirement; best-effort, never
 * blocks a new download on cleanup failure. */
async function cleanupStaleDownloadTemp(updateCacheDir: string, installerFilename: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(updateCacheDir);
  } catch {
    return;
  }
  const prefix = `${installerFilename}.`;
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix) && name.endsWith('.download'))
      .map((name) => fs.promises.rm(path.join(updateCacheDir, name), { force: true }).catch(() => {}))
  );
}

/** If something already exists at `finalPath` — a stale file from a
 * previous run, or (in the worst case) a planted symlink/reparse point —
 * remove it explicitly via `lstat`+`unlink` before the rename, rather
 * than relying on `fs.rename`'s overwrite-vs-follow behavior for an
 * existing destination, which is not perfectly consistent across
 * platforms/Node versions for symlink destinations. After this,
 * `finalPath` is guaranteed to not exist, so the rename always creates a
 * fresh file there. */
async function removeExistingFinalPath(finalPath: string): Promise<void> {
  let lst: fs.Stats;
  try {
    lst = await fs.promises.lstat(finalPath);
  } catch {
    return; // nothing there — nothing to do
  }
  if (lst.isDirectory() && !lst.isSymbolicLink()) {
    throw new DownloadError('Не удалось сохранить обновление — путь установки занят');
  }
  await fs.promises.unlink(finalPath);
}

/** `updateCacheDir` is provided by the caller (main/index.ts, from
 * `%LOCALAPPDATA%\T2 Sales\updates\` — see updater/manager.ts) rather
 * than computed here, so this module has zero Electron `app` dependency
 * and can be unit-tested with a plain temp directory.
 *
 * `extraTrustedCa` is test-only plumbing — same precedent and same
 * reasoning as relay/src/forward.ts::createUpstreamAgent()'s own
 * `extraTrustedCa` parameter: Node's `https.Agent`/`https.request` `ca`
 * option *adds* a certificate to the trusted set for that connection, it
 * does not disable verification or replace the system trust store.
 * Omitted (the default, used in production always — main/updater/
 * manager.ts never passes it), TLS verification behaves exactly as
 * Node's own default (real chain + hostname verification, nothing
 * weakened). Tests pass a local fixture CA so they can run a real,
 * real-TLS-verified download against an ephemeral local HTTPS server. */
export async function downloadAndVerifyInstaller(
  manifest: UpdateManifest,
  updateCacheDir: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (p: DownloadProgress) => void;
    allowedOrigin: string;
    extraTrustedCa?: string | Buffer;
  }
): Promise<DownloadResult> {
  const url = new URL(manifest.installer.url);
  if (url.protocol !== 'https:') throw new DownloadError('Небезопасный адрес сервера обновлений');
  if (url.origin !== options.allowedOrigin) {
    throw new DownloadError('Адрес сервера обновлений не совпадает с ожидаемым');
  }

  await fs.promises.mkdir(updateCacheDir, { recursive: true });
  const resolvedCacheDir = path.resolve(updateCacheDir);
  const tempPath = path.join(updateCacheDir, `${manifest.installer.filename}.${crypto.randomBytes(6).toString('hex')}.download`);
  const finalPath = path.join(updateCacheDir, manifest.installer.filename);
  // Defense in depth (§2 of the security gate) — manifest.ts's filename
  // validation already forbids separators/'..', which structurally
  // prevents path.join from escaping updateCacheDir, but this re-checks
  // the actually-resolved path rather than trusting that reasoning alone,
  // same "don't trust a single check" discipline used elsewhere.
  const resolvedFinalPath = path.resolve(finalPath);
  if (resolvedFinalPath !== resolvedCacheDir && !resolvedFinalPath.startsWith(resolvedCacheDir + path.sep)) {
    throw new DownloadError('Внутренняя ошибка проверки пути установки');
  }

  await cleanupStaleDownloadTemp(updateCacheDir, manifest.installer.filename);

  const cleanupTemp = async () => {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  };

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tempPath, { flags: 'wx' }); // 'wx' — refuse to overwrite/follow a symlink onto an existing path
    const hash = crypto.createHash('sha256');
    let received = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = https.request(
      url,
      { method: 'GET', timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, ca: options.extraTrustedCa, rejectUnauthorized: true },
      (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        writeStream.destroy();
        settle(() => reject(new DownloadError('Сервер обновлений вернул перенаправление — загрузка отклонена')));
        return;
      }
      if (status !== 200) {
        res.resume();
        writeStream.destroy();
        settle(() => reject(new DownloadError(`Сервер обновлений вернул ошибку (HTTP ${status})`)));
        return;
      }

      const declaredLength = res.headers['content-length'] ? Number(res.headers['content-length']) : undefined;
      if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength !== manifest.installer.size) {
        res.resume();
        writeStream.destroy();
        settle(() => reject(new DownloadError('Заявленный размер файла не совпадает с ожидаемым', 'sha256')));
        return;
      }

      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > manifest.installer.size) {
          res.destroy();
          writeStream.destroy();
          settle(() => reject(new DownloadError('Загрузка превысила ожидаемый размер файла — прервана', 'sha256')));
          return;
        }
        hash.update(chunk);
        options.onProgress?.({ receivedBytes: received, totalBytes: manifest.installer.size });
        // Backpressure: pause the response if the write stream's buffer
        // is full, resume once drained — never let an unbounded amount
        // of unwritten data pile up in memory even before the byte cap
        // above would trip (belt and suspenders for a slow disk).
        if (!writeStream.write(chunk)) res.pause();
      });
      writeStream.on('drain', () => res.resume());

      res.on('end', () => {
        writeStream.end(() => {
          settle(() => {
            if (received !== manifest.installer.size) {
              reject(new DownloadError('Размер файла обновления не совпадает с ожидаемым', 'sha256'));
              return;
            }
            const actualSha256 = hash.digest('hex');
            const expected = Buffer.from(manifest.installer.sha256, 'hex');
            const actual = Buffer.from(actualSha256, 'hex');
            const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
            if (!matches) {
              reject(new DownloadError('Контрольная сумма (SHA-256) файла обновления не совпадает', 'sha256'));
              return;
            }
            resolve();
          });
        });
      });
      // Our own req.destroy(new DownloadError(...)) calls below (timeout/
      // abort) surface here too, since destroy()'s reason becomes the
      // stream's 'error' event — preserve that specific, already-safe
      // Russian message rather than collapsing it into the generic one.
      res.on('error', (e) => settle(() => reject(e instanceof DownloadError ? e : new DownloadError('Загрузка обновления прервана сетевой ошибкой'))));
    });

    req.once('timeout', () => req.destroy(new DownloadError('Истекло время ожидания загрузки обновления')));
    req.once('error', (e) => settle(() => reject(e instanceof DownloadError ? e : new DownloadError('Загрузка обновления прервана сетевой ошибкой'))));
    writeStream.once('error', () => settle(() => reject(new DownloadError('Не удалось сохранить файл обновления на диск'))));

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(new DownloadError('Загрузка обновления отменена'));
      } else {
        const onAbort = () => req.destroy(new DownloadError('Загрузка обновления отменена'));
        options.signal.addEventListener('abort', onAbort, { once: true });
        req.once('close', () => options.signal!.removeEventListener('abort', onAbort));
      }
    }

    req.end();
  }).catch(async (e) => {
    await cleanupTemp();
    throw e;
  });

  // Verification succeeded — rename into the final, versioned filename.
  // fs.rename is atomic on the same volume (both paths are under
  // updateCacheDir), so there is no window where a partially-verified
  // file exists at the final path. removeExistingFinalPath first closes
  // off any ambiguity in how rename treats an existing destination
  // (stale file from a prior run, or — worst case — a planted symlink).
  await removeExistingFinalPath(finalPath).catch(async (e) => {
    await cleanupTemp();
    throw e;
  });
  await fs.promises.rename(tempPath, finalPath);
  return { filePath: finalPath };
}
