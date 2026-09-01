import type { UpdateManifest } from './manifest.js';

/**
 * §5 of the updater brief. `not_configured` — dev/test/unpackaged run
 * with no update server configured (see main/config.ts): checking is
 * simply disabled rather than silently reaching production.
 */
export type UpdateState =
  | 'not_configured'
  | 'checking'
  | 'up_to_date'
  | 'update_available'
  | 'downloading'
  | 'verifying'
  | 'ready_to_install'
  | 'error';

export interface UpdateProgress {
  receivedBytes: number;
  totalBytes: number;
}

/** Safe, structural failure stage (§updater-diagnostic-pass) — lets the
 * renderer and the local diagnostic log identify unambiguously which
 * step of the update produced an error, without parsing
 * `errorMessage`'s free-text Russian string. Each value is a fixed
 * token, never derived from raw error text. `INSTALL_RECHECK_*` covers
 * the pre-install re-verification step (§ installUpdate()'s own
 * SHA-256/Authenticode re-check immediately before launching the
 * installer) as a distinct pair of stages from the initial
 * download-time DOWNLOAD/SHA256/AUTHENTICODE ones. */
export type UpdateErrorStage =
  | 'DOWNLOAD'
  | 'SHA256'
  | 'AUTHENTICODE'
  | 'SIGNATURE_POLICY'
  | 'INSTALL_RECHECK_SHA256'
  | 'INSTALL_RECHECK_AUTHENTICODE';

/** Which half of the 'verifying' state is currently running — lets the
 * UI show "Проверка SHA-256..." vs "Проверка цифровой подписи
 * Windows..." instead of one generic "Проверка целостности файла..."
 * for both (§updater-diagnostic-pass item 7). Non-null only while
 * `state === 'verifying'`. */
export type UpdateVerificationStage = 'sha256' | 'authenticode';

/** Everything here is safe to send across the IPC boundary to the
 * renderer (§9/§15 of the updater brief) — a manifest's own fields are
 * already public release metadata (version/notes/size), never a
 * credential, cookie, or session value; `errorMessage`/`signatureWarning`
 * are always short, sanitized, human-facing strings this module itself
 * constructs, never a raw exception/stack trace or response body. */
export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  channel: 'stable' | 'beta';
  availableManifest: UpdateManifest | null;
  progress: UpdateProgress | null;
  errorMessage: string | null;
  /** Set together with errorMessage whenever state === 'error' — null
   * otherwise. See UpdateErrorStage. */
  errorStage: UpdateErrorStage | null;
  /** Set only while state === 'verifying' — see UpdateVerificationStage.
   * Null in every other state, including 'error' (errorStage is what
   * identifies the stage once it's failed). */
  verificationStage: UpdateVerificationStage | null;
  signatureWarning: string | null;
  lastCheckedAt: string | null;
  /** Deliberately NOT the local filesystem path — §9 of the updater
   * brief forbids handing the renderer an arbitrary/any file path. The
   * renderer only ever needs to know installation is possible; which
   * exact file gets launched is entirely the main process's own
   * decision when `installUpdate()` is invoked, never a path the
   * renderer supplies or even sees. */
  readyToInstall: boolean;
}
