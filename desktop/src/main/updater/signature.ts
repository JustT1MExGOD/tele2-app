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
 * `-Command` string, so it also can't affect PowerShell's OWN parsing —
 * belt and suspenders, not relying on either layer alone. In practice
 * the path is always one this process itself constructed from a
 * `manifest.ts`-validated filename (`^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$`,
 * no quotes/spaces/metacharacters possible), so neither layer is ever
 * actually exercised against attacker-influenced input — this is
 * defense in depth, not the only guard.
 */
import { execFile } from 'node:child_process';

export type SignatureStatus = 'Valid' | 'NotSigned' | 'HashMismatch' | 'NotTrusted' | 'UnknownError' | 'Invalid';

export interface AuthenticodeResult {
  status: SignatureStatus;
  signed: boolean;
  /** Certificate subject (e.g. "CN=Some Publisher, ..."), only present
   * when status is 'Valid'. Safe to log/display — a certificate subject
   * is not a secret. */
  subject: string | null;
}

// -NoProfile/-NonInteractive: don't load a user PowerShell profile or
// prompt for anything. -ExecutionPolicy Bypass scoped to THIS single
// process invocation only (the `-Command` flag), never a system-wide
// policy change. The script reads the path from $args[0], never from
// string interpolation.
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

export function verifyAuthenticodeSignature(filePath: string, timeoutMs = 15_000): Promise<AuthenticodeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_SCRIPT, '--', filePath],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Authenticode verification failed to run: ${error.message}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as { status: string; subject: string | null };
          const status = (['Valid', 'NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError', 'Invalid'] as const).includes(
            parsed.status as SignatureStatus
          )
            ? (parsed.status as SignatureStatus)
            : 'UnknownError';
          resolve({ status, signed: status === 'Valid', subject: status === 'Valid' ? parsed.subject : null });
        } catch {
          reject(new Error('Authenticode verification returned unparseable output'));
        }
      }
    );
  });
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
    return `This build's digital signature could not be verified (${result.status}) — this is different from being unsigned and is always rejected.`;
  }
  const policy = AUTHENTICODE_POLICY[channel];
  if (policy === 'required') {
    return `This build is not digitally signed, and the "${channel}" channel requires a valid signature.`;
  }
  return null; // 'warn' policy — caller surfaces a warning in the UI but does not block
}
