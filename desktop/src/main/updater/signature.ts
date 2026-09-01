/**
 * Authenticode signature verification (§7 of the updater brief) via
 * PowerShell's built-in `Get-AuthenticodeSignature` — there is no Node
 * API for this, and shelling out to the OS's own, already-trusted
 * verification is safer than reimplementing Authenticode parsing.
 *
 * Injection safety: the file path is NEVER interpolated into the
 * PowerShell script text. `execFile` (not `exec`) invokes
 * `powershell.exe` directly with an argv array — no shell/cmd.exe
 * involved at all, so shell metacharacters in the path are inert
 * regardless. On top of that, the path is passed as a PowerShell
 * *script argument* (bound to `$args[0]`), not concatenated into the
 * script text, so it also can't affect PowerShell's OWN parsing — belt
 * and suspenders, not relying on either layer alone. In practice the
 * path is always one this process itself constructed from a
 * `manifest.ts`-validated filename (`^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$`,
 * no quotes/spaces/metacharacters possible), so neither layer is ever
 * actually exercised against attacker-influenced input — this is
 * defense in depth, not the only guard.
 *
 * §updater-postdownload-error regression — `-Command <script> -- <path>`
 * (the original invocation) is BROKEN on real Windows PowerShell 5.1:
 * `-Command` treats every trailing argv element as MORE script text to
 * parse (not as `$args`) — there is no POSIX-style `--`
 * end-of-options convention in PowerShell's own parser, so it tried to
 * parse the literal token `--` as PowerShell syntax and failed with
 * "MissingExpressionAfterOperator", confirmed with a real standalone
 * run against a real unsigned installer on this machine. `-File
 * <script.ps1> <path>` is the mode that actually binds trailing argv
 * to `$args` — confirmed the same way. The script is now written once
 * to a private temp file (unpredictable directory via `fs.mkdtempSync`,
 * so a local process can't pre-plant a symlink at a guessable path) and
 * reused for the life of this process.
 *
 * §updater-diagnostic-pass (this pass) — the invocation fix above is
 * shipped and confirmed working (real PowerShell round-trip, real
 * unsigned installer), yet a real affected PC still fails at the same
 * "Проверка целостности файла..." point with no way to tell, from the
 * UI alone, which stage or which failure mode. Every distinct real-world
 * failure mode this module can encounter (PowerShell missing, temp file
 * couldn't be created, PowerShell exited non-zero, PowerShell timed out,
 * stdout was empty, stdout wasn't valid JSON) now gets its OWN
 * `AuthenticodeErrorCategory` rather than collapsing into one generic
 * "не удалось запустить проверку" — the category is never shown to the
 * user verbatim (user-facing text stays the existing short Russian
 * strings), but it's exactly what diagnostic-log.ts needs to record so a
 * real failure on a real machine becomes reportable instead of a dead
 * end.
 */
import { execFile, type ExecFileException } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SignatureStatus = 'Valid' | 'NotSigned' | 'HashMismatch' | 'NotTrusted' | 'UnknownError' | 'Invalid';

export interface AuthenticodeResult {
  status: SignatureStatus;
  signed: boolean;
  /** Certificate subject (e.g. "CN=Some Publisher, ..."), only present
   * when status is 'Valid'. Safe to log/display — a certificate subject
   * is not a secret. */
  subject: string | null;
}

/** Fine-grained failure category — see the diagnostic-pass doc comment
 * above. Distinct from `SignatureStatus`: this describes a failure to
 * even OBTAIN a result (PowerShell itself didn't produce a usable
 * answer); `SignatureStatus` describes the result once one exists. */
export type AuthenticodeErrorCategory =
  | 'powershell_not_found'
  | 'temp_script_create_failed'
  | 'powershell_execution_failed'
  | 'powershell_timeout'
  | 'powershell_empty_output'
  | 'powershell_invalid_json';

/** Always `stage: 'authenticode'` — lets manager.ts's sanitized
 * diagnostics tell an Authenticode-stage failure apart from a
 * download/sha256/policy one without parsing message text. `.message`
 * is already the short, safe, Russian, user-facing string (matching
 * the rest of the updater UI) — never the raw PowerShell command line,
 * a file path, or a stack trace. `.category` is the fine-grained
 * failure mode for the diagnostic log ONLY — never rendered to the
 * user, never anything but one of the fixed literal categories above. */
export class AuthenticodeError extends Error {
  readonly stage = 'authenticode' as const;
  readonly category: AuthenticodeErrorCategory;

  constructor(message: string, category: AuthenticodeErrorCategory) {
    super(message);
    this.category = category;
  }
}

// -NoProfile/-NonInteractive: don't load a user PowerShell profile or
// prompt for anything. -ExecutionPolicy Bypass scoped to THIS single
// process invocation only, never a system-wide policy change. The
// script reads the path from $args[0], never from string interpolation.
const POWERSHELL_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'try {',
  '  $sig = Get-AuthenticodeSignature -LiteralPath $args[0]',
  '  $subject = $null',
  '  if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }',
  '  [PSCustomObject]@{ status = $sig.Status.ToString(); subject = $subject } | ConvertTo-Json -Compress',
  '} catch {',
  '  [PSCustomObject]@{ status = "UnknownError"; subject = $null } | ConvertTo-Json -Compress',
  '}'
].join('; ');

let cachedScriptPath: string | null = null;

/** Writes POWERSHELL_SCRIPT to a private, unpredictable temp file once
 * per process and reuses it — `-File` needs a real script file (unlike
 * the old, broken `-Command` invocation), and a fresh `mkdtempSync`
 * directory (rather than a fixed/predictable path) means a local
 * process can't plant a symlink there ahead of time. Content is a
 * constant, never derived from any per-call input, so re-checking
 * existence (survives repeated calls, not repeated processes) is safe.
 *
 * Can genuinely fail on a real machine (item 4's "TEMP directory write
 * denied" case — a locked-down enterprise profile, a full disk, an AV
 * product intercepting temp-file creation) — callers must catch this,
 * not assume it always succeeds. */
function getScriptPath(): string {
  if (cachedScriptPath && fs.existsSync(cachedScriptPath)) return cachedScriptPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2sales-authenticode-'));
  const scriptPath = path.join(dir, 'check-signature.ps1');
  fs.writeFileSync(scriptPath, POWERSHELL_SCRIPT, { encoding: 'utf8' });
  cachedScriptPath = scriptPath;
  return scriptPath;
}

/** Categorizes a node:child_process execFile error precisely, instead of
 * folding every failure into one generic "couldn't run PowerShell"
 * category (item 5's explicit requirement). `error.code` is a STRING
 * ('ENOENT' etc.) for a genuine spawn failure — powershell.exe isn't on
 * PATH at all (item 4's "powershell.exe unavailable" case) — and a
 * NUMBER for a non-zero exit code from a process that DID spawn and run
 * (AppLocker/WDAC/EDR blocking script execution, constrained language
 * mode faulting, a GPO-overridden ExecutionPolicy rejecting the script,
 * or AV quarantining the temp script mid-run all surface this way).
 * `error.killed`/`error.signal` mean Node's own `timeout` option fired. */
function categorizeExecFileError(error: ExecFileException): AuthenticodeErrorCategory {
  if (error.killed || error.signal) return 'powershell_timeout';
  if (error.code === 'ENOENT') return 'powershell_not_found';
  return 'powershell_execution_failed';
}

const ERROR_MESSAGES: Record<AuthenticodeErrorCategory, string> = {
  powershell_not_found: 'Не удалось запустить проверку цифровой подписи Windows',
  temp_script_create_failed: 'Не удалось запустить проверку цифровой подписи Windows',
  powershell_execution_failed: 'Не удалось запустить проверку цифровой подписи Windows',
  powershell_timeout: 'Проверка цифровой подписи Windows превысила время ожидания',
  powershell_empty_output: 'Проверка цифровой подписи Windows вернула пустой результат',
  powershell_invalid_json: 'Проверка цифровой подписи вернула некорректный результат'
};

export function verifyAuthenticodeSignature(filePath: string, timeoutMs = 15_000): Promise<AuthenticodeResult> {
  return new Promise((resolve, reject) => {
    let scriptPath: string;
    try {
      scriptPath = getScriptPath();
    } catch {
      reject(new AuthenticodeError(ERROR_MESSAGES.temp_script_create_failed, 'temp_script_create_failed'));
      return;
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, filePath],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          const category = categorizeExecFileError(error);
          reject(new AuthenticodeError(ERROR_MESSAGES[category], category));
          return;
        }

        // Some environments prepend a UTF-8 BOM and/or localized
        // warning noise to PowerShell stdout (item 4's "PowerShell
        // output has BOM/noise" case) — strip a leading BOM only; this
        // is a narrow, known encoding quirk, not lenient/fuzzy parsing.
        const BOM = String.fromCharCode(0xfeff);
        const cleaned = (stdout.startsWith(BOM) ? stdout.slice(BOM.length) : stdout).trim();
        if (cleaned.length === 0) {
          reject(new AuthenticodeError(ERROR_MESSAGES.powershell_empty_output, 'powershell_empty_output'));
          return;
        }

        try {
          const parsed = JSON.parse(cleaned) as { status: string; subject: string | null };
          const status = (['Valid', 'NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError', 'Invalid'] as const).includes(
            parsed.status as SignatureStatus
          )
            ? (parsed.status as SignatureStatus)
            : 'UnknownError';
          resolve({ status, signed: status === 'Valid', subject: status === 'Valid' ? parsed.subject : null });
        } catch {
          reject(new AuthenticodeError(ERROR_MESSAGES.powershell_invalid_json, 'powershell_invalid_json'));
        }
      }
    );
  });
}

/** Diagnostic-only categorization of a completed `AuthenticodeResult`
 * (item 5) — never used for the actual accept/reject decision (that
 * stays exactly `evaluateSignaturePolicy()` below, unchanged), only for
 * what gets written to the local diagnostic log so a real failure's
 * exact result status is distinguishable at a glance. */
export function categorizeAuthenticodeResult(status: SignatureStatus): string {
  switch (status) {
    case 'Valid':
      return 'authenticode_valid';
    case 'NotSigned':
      return 'authenticode_not_signed';
    case 'HashMismatch':
      return 'authenticode_hash_mismatch';
    case 'NotTrusted':
      return 'authenticode_not_trusted';
    case 'Invalid':
      return 'authenticode_invalid';
    case 'UnknownError':
    default:
      return 'authenticode_unknown';
  }
}

/**
 * Policy (§7 of the updater brief): SHA-256 is always required regardless
 * (enforced unconditionally in downloader.ts, before this even runs) —
 * this policy governs ONLY whether an UNSIGNED-but-hash-correct installer
 * is still allowed to proceed to the install step.
 *
 * v1 default: both channels allow unsigned (`warn`), because no real
 * code-signing certificate exists yet for ANY channel — see
 * docs/DESKTOP-UPDATES.md's signing-policy section. This is the one
 * named place to flip once a certificate exists: set `stable: 'required'`
 * to make the stable channel reject unsigned installers outright. This
 * is a value, not a function, specifically so the policy is visible and
 * auditable in one place rather than buried in conditional logic.
 */
export type SignaturePolicy = 'required' | 'warn';
export const AUTHENTICODE_POLICY: Record<'stable' | 'beta', SignaturePolicy> = {
  stable: 'warn',
  beta: 'warn'
};

/** Returns null if the install may proceed, or a user-facing reason
 * string if the signature policy blocks it.
 *
 * Semantics, precisely (§10 of the security gate): `result.status ===
 * 'NotSigned'` is the only status the 'warn' policy is lenient about —
 * a build with no Authenticode signature block at all, which is simply
 * the expected shape of every build today (no certificate exists yet).
 * Any OTHER non-'Valid' status — 'HashMismatch', 'NotTrusted', 'Invalid'
 * — means a signature block IS present but verification failed, which
 * is always rejected regardless of channel policy: the file is claiming
 * an authenticity it doesn't have, a strictly worse signal than having
 * no claim at all. 'UnknownError' (the PowerShell check itself failed
 * to run/parse) is also always rejected — an inconclusive check must
 * never be treated as equivalent to "known unsigned". */
export function evaluateSignaturePolicy(channel: 'stable' | 'beta', result: AuthenticodeResult): string | null {
  if (result.signed) return null;
  if (result.status !== 'NotSigned') {
    return 'Цифровая подпись повреждена или недействительна — установка отменена';
  }
  const policy = AUTHENTICODE_POLICY[channel];
  if (policy === 'required') {
    return 'Сборка не подписана, а этот канал обновлений требует подписи';
  }
  return null; // 'warn' policy — caller surfaces a warning in the UI but does not block
}
