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
