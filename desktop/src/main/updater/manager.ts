/**
 * UpdateManager — the façade main/index.ts and the IPC handlers talk to.
 * Mirrors network/manager.ts's shape deliberately (injectable
 * dependencies for testability, a single `getStatus()`/`onStatusChanged`
 * observable state, no Electron `app` import here so this can be unit
 * tested without a real Electron process).
 */
import { fetchManifest, ManifestFetchError } from './fetch-manifest.js';
import { downloadAndVerifyInstaller, verifyFileIntegrity, DownloadError } from './downloader.js';
import { verifyAuthenticodeSignature, evaluateSignaturePolicy, AuthenticodeError } from './signature.js';
import { launchInstaller } from './install-launcher.js';
import { isNewerVersion } from './version.js';
import { ManifestValidationError, type UpdateManifest, type UpdateChannelName } from './manifest.js';
import type { UpdateStatus, UpdateState } from './types.js';
import { logger } from '../logging.js';

/** A few hours, not aggressive polling (§4 of the brief) — the update
 * server is a static file host, but there is still no reason to hammer
 * it every few minutes for a value that changes at most a few times a
 * month. */
const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Small delay after startup — never blocks the app's own boot/login
 * flow on a network call to a server that might be slow or unreachable. */
const DEFAULT_INITIAL_DELAY_MS = 15_000;
const MANIFEST_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface UpdateManagerOptions {
  updateBaseUrl: string; // '' — checking disabled entirely
  channel: UpdateChannelName;
  currentVersion: string;
  updateCacheDir: string;
  checkIntervalMs?: number;
  initialCheckDelayMs?: number;
  /** Injectable for tests/determinism — same pattern as
   * network/state-machine.ts's injected timer functions. */
  setTimeout?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => { unref?: () => void };
  clearInterval?: (handle: unknown) => void;
}

export class UpdateManager {
  private readonly options: Required<Pick<UpdateManagerOptions, 'checkIntervalMs' | 'initialCheckDelayMs'>> & UpdateManagerOptions;
  private state: UpdateState = 'not_configured';
  private manifest: UpdateManifest | null = null;
  private downloadedFilePath: string | null = null;
  private errorMessage: string | null = null;
  private signatureWarning: string | null = null;
  private progress: { receivedBytes: number; totalBytes: number } | null = null;
  private lastCheckedAt: string | null = null;
  private listeners: Array<(status: UpdateStatus) => void> = [];
  private initialTimer: { unref?: () => void } | null = null;
  private intervalTimer: { unref?: () => void } | null = null;
  private abortController: AbortController | null = null;
  // Re-entrancy guard for installUpdate() specifically (§3 of the
  // security gate) — installUpdate() intentionally does not transition
  // `state` while the installer launch is in flight, so without this
  // flag a duplicate call (double-click, a second IPC invocation racing
  // the first) could launch the installer a second time before the first
  // call resolves.
  private installStarted = false;
  private readonly allowedOrigin: string | null;
  private readonly setIntervalFn: NonNullable<UpdateManagerOptions['setInterval']>;
  private readonly clearIntervalFn: NonNullable<UpdateManagerOptions['clearInterval']>;
  private readonly setTimeoutFn: NonNullable<UpdateManagerOptions['setTimeout']>;
  private readonly clearTimeoutFn: NonNullable<UpdateManagerOptions['clearTimeout']>;

  constructor(options: UpdateManagerOptions) {
    this.options = {
      checkIntervalMs: options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
      initialCheckDelayMs: options.initialCheckDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
      ...options
    };
    this.allowedOrigin = options.updateBaseUrl ? new URL(options.updateBaseUrl).origin : null;
    this.state = options.updateBaseUrl ? 'up_to_date' : 'not_configured';
    this.setIntervalFn = options.setInterval ?? ((fn, ms) => setInterval(fn, ms) as unknown as { unref?: () => void });
    this.clearIntervalFn = options.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));
    this.setTimeoutFn = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms) as unknown as { unref?: () => void });
    this.clearTimeoutFn = options.clearTimeout ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  /** Never schedules anything when no update server is configured — a
   * dev/test run with updateBaseUrl:'' does zero timers, zero network
   * activity, ever (§1/§14 of the brief). Idempotent — a repeat call
   * (§8 of the security gate: "periodic timer не плодится при повторной
   * инициализации") clears any previously-scheduled timers first rather
   * than leaking them, so calling start() twice never produces two
   * concurrent interval timers. */
  start(): void {
    if (!this.options.updateBaseUrl) return;
    if (this.initialTimer) this.clearTimeoutFn(this.initialTimer);
    if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer);
    this.initialTimer = this.setTimeoutFn(() => {
      this.checkNow().catch(() => {}); // errors already land in state via checkNow's own try/catch
    }, this.options.initialCheckDelayMs);
    this.initialTimer.unref?.();
    this.intervalTimer = this.setIntervalFn(() => {
      this.checkNow().catch(() => {});
    }, this.options.checkIntervalMs);
    this.intervalTimer.unref?.();
  }

  getStatus(): UpdateStatus {
    return {
      state: this.state,
      currentVersion: this.options.currentVersion,
      channel: this.options.channel,
      availableManifest: this.manifest,
      progress: this.progress,
      errorMessage: this.errorMessage,
      signatureWarning: this.signatureWarning,
      lastCheckedAt: this.lastCheckedAt,
      readyToInstall: this.state === 'ready_to_install' && this.downloadedFilePath !== null
    };
  }

  onStatusChanged(cb: (status: UpdateStatus) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emit(): void {
    const status = this.getStatus();
    for (const l of this.listeners) l(status);
  }

  private setState(state: UpdateState): void {
    this.state = state;
    this.emit();
  }

  /**
   * §4 of the brief — failures here NEVER throw out of this method for
   * the caller to mishandle into a crash/blocking dialog; every failure
   * path lands in `state: 'error'` with a short, sanitized message
   * (never a raw exception object/stack/response body — §15).
   */
  async checkNow(): Promise<void> {
    if (!this.options.updateBaseUrl || !this.allowedOrigin) return; // not_configured — checkNow is a deliberate no-op, not an error
    // §3 of the security gate — a check already in flight, or an active
    // download/verify, must not be clobbered by a second concurrent
    // check: a duplicate 'checking' call is a no-op (avoids a redundant
    // network request), and a check arriving mid-download/verify is a
    // no-op rather than hijacking the visible state away from progress
    // that is genuinely still happening in the background.
    if (this.state === 'checking' || this.state === 'downloading' || this.state === 'verifying') return;
    this.setState('checking');
    try {
      const manifest = await fetchManifest(this.options.updateBaseUrl, this.options.channel, MANIFEST_TIMEOUT_MS);
      this.lastCheckedAt = new Date().toISOString();
      if (isNewerVersion(this.options.currentVersion, manifest.version)) {
        this.manifest = manifest;
        this.errorMessage = null;
        this.setState('update_available');
      } else {
        this.manifest = null;
        this.errorMessage = null;
        this.setState('up_to_date');
      }
    } catch (e) {
      this.lastCheckedAt = new Date().toISOString();
      this.errorMessage = sanitizeError(e);
      this.setState('error');
    }
  }

  /** Downloads + verifies (size, SHA-256, Authenticode policy) the
   * currently-available manifest's installer. No-op if there is no
   * available update.
   *
   * §updater-postdownload-error regression — this used to be one big
   * try/catch around both the download AND the Authenticode check, and
   * sanitizeError() only recognized DownloadError/ManifestFetchError/
   * ManifestValidationError — any OTHER Error (which is exactly what
   * verifyAuthenticodeSignature() threw before its own fix) collapsed to
   * the generic "update check failed", hiding a real post-download
   * failure (e.g. a broken PowerShell invocation) behind a message that
   * looked identical to "the manifest check itself failed". Each stage
   * now has its own try/catch, its own sanitized diagnostic log entry
   * (stage + error name + duration — never a URL/path/PowerShell command
   * line), and produces a specific, already-safe (Russian, matching the
   * rest of the updater UI) user-facing message via each error class's
   * own `.message`. */
  async downloadUpdate(): Promise<void> {
    if (!this.manifest || !this.allowedOrigin) return;
    // §3 of the security gate — never two concurrent downloads of the
    // same installer: a second downloadUpdate() call while one is
    // already downloading/verifying is a no-op rather than starting a
    // parallel transfer that would orphan the first call's
    // abortController (a later assignment here would silently overwrite
    // it, leaking the first download's cancel capability).
    if (this.state === 'downloading' || this.state === 'verifying') return;
    const manifest = this.manifest;
    this.progress = { receivedBytes: 0, totalBytes: manifest.installer.size };
    this.signatureWarning = null;
    this.setState('downloading');
    this.abortController = new AbortController();

    let downloadStageStartedAt = Date.now();
    let result: { filePath: string };
    try {
      result = await downloadAndVerifyInstaller(manifest, this.options.updateCacheDir, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        signal: this.abortController.signal,
        allowedOrigin: this.allowedOrigin,
        onProgress: (p) => {
          this.progress = p;
          this.emit();
        }
      });
    } catch (e) {
      this.failDownload(e instanceof DownloadError ? e.stage : 'download', e, downloadStageStartedAt);
      return;
    }

    this.setState('verifying');
    downloadStageStartedAt = Date.now();
    let sig: Awaited<ReturnType<typeof verifyAuthenticodeSignature>>;
    try {
      sig = await verifyAuthenticodeSignature(result.filePath);
    } catch (e) {
      this.failDownload('authenticode', e, downloadStageStartedAt);
      return;
    }

    const blockReason = evaluateSignaturePolicy(this.options.channel, sig);
    if (blockReason) {
      logger.warn('update_stage_failed', { stage: 'policy', errorName: 'SignaturePolicyBlocked', durationMs: Date.now() - downloadStageStartedAt });
      this.downloadedFilePath = null;
      this.errorMessage = blockReason;
      this.setState('error');
      this.abortController = null;
      return;
    }
    if (!sig.signed) {
      this.signatureWarning = `Обновление не имеет цифровой подписи (${sig.status}). Проверено только по контрольной сумме (SHA-256).`;
    }

    this.downloadedFilePath = result.filePath;
    this.errorMessage = null;
    this.setState('ready_to_install');
    this.abortController = null;
  }

  /** Sanitized diagnostics only — stage name, error class name, duration.
   * Never a URL, query string, cookie, auth header, file path, or
   * PowerShell command line — the SAME discipline already established
   * for relay-client.ts's `relay_handler_request_failed` logging. The
   * user-facing `errorMessage` comes from `sanitizeError()`, which
   * already only ever surfaces our own hand-written, short, safe error
   * messages (never a raw exception's stack/details). */
  private failDownload(stage: 'download' | 'sha256' | 'authenticode', e: unknown, startedAt: number): void {
    logger.warn('update_stage_failed', {
      stage,
      errorName: e instanceof Error ? e.name : 'unknown',
      durationMs: Date.now() - startedAt
    });
    this.downloadedFilePath = null;
    this.errorMessage = sanitizeError(e);
    this.setState('error');
    this.abortController = null;
  }

  cancelDownload(): void {
    this.abortController?.abort();
  }

  /**
   * §8 of the brief — only ever launches the exact file THIS manager
   * downloaded and verified; never a path the caller supplies. Resolves
   * once the installer process has been started (detached) — does not
   * wait for it to finish. `onLaunched` is an injected callback (e.g.
   * wired to `app.quit()` in main/index.ts after a short grace delay) —
   * kept out of this module so it stays Electron-`app`-free for testing.
   *
   * TOCTOU closure (§1 of the security gate): `ready_to_install` has no
   * timeout — the app waits on a human click, an unbounded window during
   * which a local process with write access to the update cache
   * directory could swap the verified file for something else. So
   * immediately before launch, this re-verifies the on-disk file's
   * SHA-256/size against the manifest (the exact same technique used at
   * download time, re-run against the file as it exists right now, not
   * as it existed when the download finished) and re-runs the
   * Authenticode check + policy. A file that fails either check is never
   * launched — it transitions to `error` state instead.
   */
  async installUpdate(onLaunched?: () => void): Promise<void> {
    if (this.state !== 'ready_to_install' || !this.downloadedFilePath || !this.manifest) {
      throw new Error('no verified update is ready to install');
    }
    // §3 of the security gate — a duplicate call (double-click, a second
    // IPC invocation racing the first) must not launch the installer a
    // second time; this method doesn't transition `state` while the
    // launch is in flight, so a dedicated flag is the guard.
    if (this.installStarted) return;
    this.installStarted = true;

    // Captured into locals before any await — a concurrent checkNow()
    // mutating this.manifest/this.downloadedFilePath partway through
    // must not change what this specific install call verifies/launches.
    const filePath = this.downloadedFilePath;
    const expectedSha256 = this.manifest.installer.sha256;
    const expectedSize = this.manifest.installer.size;
    const channel = this.options.channel;

    try {
      await verifyFileIntegrity(filePath, expectedSha256, expectedSize);
    } catch (e) {
      logger.warn('update_stage_failed', { stage: 'sha256', errorName: e instanceof Error ? e.name : 'unknown', at: 'install_recheck' });
      const message = sanitizeError(e);
      this.downloadedFilePath = null;
      this.errorMessage = message;
      this.setState('error');
      this.installStarted = false;
      throw new Error(message);
    }

    let sig: Awaited<ReturnType<typeof verifyAuthenticodeSignature>>;
    try {
      sig = await verifyAuthenticodeSignature(filePath);
    } catch (e) {
      logger.warn('update_stage_failed', { stage: 'authenticode', errorName: e instanceof Error ? e.name : 'unknown', at: 'install_recheck' });
      const message = sanitizeError(e);
      this.downloadedFilePath = null;
      this.errorMessage = message;
      this.setState('error');
      this.installStarted = false;
      throw new Error(message);
    }
    const blockReason = evaluateSignaturePolicy(channel, sig);
    if (blockReason) {
      logger.warn('update_stage_failed', { stage: 'policy', errorName: 'SignaturePolicyBlocked', at: 'install_recheck' });
      this.downloadedFilePath = null;
      this.errorMessage = blockReason;
      this.setState('error');
      this.installStarted = false;
      throw new Error(blockReason);
    }

    await launchInstaller(filePath);
    onLaunched?.();
  }

  dispose(): void {
    if (this.initialTimer) this.clearTimeoutFn(this.initialTimer);
    if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer);
    this.abortController?.abort();
    this.listeners = [];
  }
}

/** Never surfaces a raw Error's full message/stack for network-layer
 * failures where the underlying message might embed a URL/host detail
 * beyond what's useful — but DOES keep our OWN thrown error messages
 * (ManifestFetchError/DownloadError/ManifestValidationError), which are
 * already short, sanitized, hand-written strings, never containing
 * cookies/tokens/response bodies (§15 of the brief). */
function sanitizeError(e: unknown): string {
  if (e instanceof ManifestFetchError || e instanceof DownloadError || e instanceof ManifestValidationError || e instanceof AuthenticodeError) {
    return e.message;
  }
  return 'Не удалось проверить обновление';
}
