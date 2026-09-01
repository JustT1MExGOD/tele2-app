/**
 * Local, on-disk diagnostic log for the updater specifically — a
 * dedicated `updater.log` file (main/index.ts wires the real path,
 * `app.getPath('userData')/logs/updater.log`), separate from the
 * general-purpose console `logger` (main/logging.ts, still used
 * unchanged everywhere else) so a real user experiencing "падает после
 * Проверка целостности файла..." can send ONE small, self-contained,
 * append-only file that unambiguously shows which stage failed and why
 * — without needing to capture console output from a packaged app,
 * which most users have no way to do at all.
 *
 * Field discipline (matches every other sanitized-diagnostics point in
 * this codebase — relay-client.ts's `relay_handler_request_failed`,
 * manager.ts's `update_stage_failed`): only short, structural fields.
 * NEVER a full file path, URL, PowerShell command line, stack trace, or
 * anything from auth/session (cookies/tokens/initData) — none of those
 * ever flow through the updater in the first place, but this module
 * only accepts a fixed, typed field shape specifically so a future
 * caller can't accidentally widen that by passing something raw.
 *
 * Deliberately no Electron `app` import here — same testability
 * discipline as the rest of updater/* — the real file path is injected
 * once by main/index.ts via configureUpdaterDiagnosticLog(); until
 * that's called (e.g. in every test, and in any dev/test run that never
 * wires it up), writeUpdaterDiagnostic() is a safe, silent no-op.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface UpdaterDiagnosticEntry {
  /** CHECK | MANIFEST | DOWNLOAD | SHA256 | AUTHENTICODE |
   * SIGNATURE_POLICY | READY_TO_INSTALL | INSTALL_RECHECK_SHA256 |
   * INSTALL_RECHECK_AUTHENTICODE | INSTALL_LAUNCH_START |
   * INSTALL_PROCESS_STARTED, or a confirmation-only stage name — always
   * a short fixed token, never free text. */
  stage: string;
  /** 'manual' | 'automatic' | 'startup' — see manager.ts's
   * `UpdateCheckTrigger`. Only present on the `CHECK` stage. */
  trigger?: string;
  /** Fine-grained failure/result category — e.g. powershell_timeout,
   * authenticode_valid — see signature.ts. Omitted for a pure
   * confirmation entry that isn't reporting a failure. */
  category?: string;
  /** Error class name only (e.g. "AuthenticodeError") — never
   * `.message`/`.stack`. */
  errorName?: string;
  currentVersion?: string;
  targetVersion?: string;
  channel?: string;
  expectedSize?: number;
  receivedSize?: number;
  /** First 8 hex characters only — enough to spot a mismatch at a
   * glance without logging a value someone could mistake for something
   * sensitive, and never the full 64-character hash. */
  expectedSha256Prefix?: string;
  actualSha256Prefix?: string;
  fileExists?: boolean;
  /** Filename only, never a directory component — e.g.
   * "T2Sales-Setup-x64-20.56.4.exe". Never a full path. */
  installerBasename?: string;
  authenticodeStatus?: string;
  /** ENOENT / non-zero exit / timeout / ok — see signature.ts's own
   * execFile error categorization; never the raw error message. */
  powershellExitCategory?: string;
}

/** §updater-field-diagnostic-build item 5 — bounded growth, no log
 * infrastructure dependency. Each on-disk file is capped at this size;
 * once a write would exceed it, the current file is rotated to a single
 * `.1` backup (overwriting any prior one) and a fresh file started. Total
 * on-disk footprint for this log is therefore bounded to roughly 2x this
 * cap, forever — never unbounded growth over the life of the app. */
const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
/** Bounds any single string field so one adversarial/buggy caller-
 * supplied value (e.g. a future Error subclass with an unexpectedly
 * long `.name`) can't blow up a single log line — defense in depth on
 * top of the type shape itself already excluding path/URL/token fields
 * entirely. */
const MAX_FIELD_CHARS = 200;

let logFilePath: string | null = null;

function truncateField(value: string): string {
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) + '…' : value;
}

/** Rotates the log file BEFORE it would grow past MAX_LOG_FILE_BYTES —
 * checked pre-write (not post-write) so the cap is never exceeded by
 * more than a single line's worth mid-rotation. Best-effort: if rotation
 * itself fails (e.g. the backup path is locked), falls through and lets
 * the write proceed anyway — a failed rotation must never drop a
 * diagnostic entry or throw out of the caller. */
function rotateIfNeeded(filePath: string, incomingLineBytes: number): void {
  let currentSize: number;
  try {
    currentSize = fs.statSync(filePath).size;
  } catch {
    return; // file doesn't exist yet — nothing to rotate
  }
  if (currentSize + incomingLineBytes <= MAX_LOG_FILE_BYTES) return;
  const rotatedPath = filePath + '.1';
  try {
    fs.rmSync(rotatedPath, { force: true });
    fs.renameSync(filePath, rotatedPath);
  } catch {
    // best-effort — see doc comment above.
  }
}

/** Called once by main/index.ts at startup with the real, packaged
 * `app.getPath('userData')/logs/updater.log` path. Never called by
 * updater/* modules themselves, and never called at all in tests —
 * writeUpdaterDiagnostic() is a no-op until this runs, which is exactly
 * the desired behavior for every existing unit test (no stray files
 * written into a test runner's working directory). */
export function configureUpdaterDiagnosticLog(filePath: string): void {
  logFilePath = filePath;
}

/** Test-only — resets to the unconfigured (no-op) state. */
export function resetUpdaterDiagnosticLogForTests(): void {
  logFilePath = null;
}

/** Best-effort, append-only, one JSON line per call. A failure writing
 * the DIAGNOSTIC log (disk full, permissions, antivirus lock) must never
 * throw or block the actual update flow it's trying to diagnose — this
 * function swallows its own errors. */
export function writeUpdaterDiagnostic(entry: UpdaterDiagnosticEntry): void {
  if (!logFilePath) return;
  try {
    const bounded: Record<string, unknown> = { time: new Date().toISOString() };
    for (const [key, value] of Object.entries(entry)) {
      if (value === undefined) continue;
      bounded[key] = typeof value === 'string' ? truncateField(value) : value;
    }
    const line = JSON.stringify(bounded) + '\n';
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    rotateIfNeeded(logFilePath, Buffer.byteLength(line, 'utf8'));
    fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // best-effort — see doc comment above.
  }
}
