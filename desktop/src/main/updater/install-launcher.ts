/**
 * Launches the verified installer. §8 of the updater brief: no command
 * line is ever built from manifest data — the ONLY input to this
 * function is a local filesystem path this process itself produced
 * (downloader.ts's verified `finalPath`), and the ONLY argument passed
 * to the installer is nothing at all (no `/S`, no silent flags — v1
 * explicitly never does a silent install, so the real NSIS installer UI
 * runs and the user goes through its normal confirm/install flow).
 *
 * §updater-install-lifecycle regression — a real affected PC showed the
 * installer window appear, then close again almost simultaneously with
 * T2 Sales itself closing, install never completing. Root-caused via a
 * real Windows repro (Electron `app`, a direct `execFile`-of-the-.exe
 * invocation this file used to have, `child.unref()`, `app.quit()` after
 * the same 1500ms delay main/index.ts uses): the installer process was
 * killed the instant Electron's own process exited — confirmed with AND
 * without `detached: true` on the execFile/spawn call (Node's Windows
 * `detached` flag only sets `CREATE_NEW_PROCESS_GROUP`, which changes
 * console/Ctrl+C signal handling — it does NOT request
 * `CREATE_BREAKAWAY_FROM_JOB`, so the child remains a member of whatever
 * Windows Job Object Electron/Chromium itself is running under, and that
 * job's `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` semantics — there
 * specifically so no orphaned Chromium helper/GPU/renderer process
 * lingers after the browser process exits — kill every still-associated
 * process, including ours, when the job closes).
 *
 * The fix: Electron's own `shell.openPath()` (confirmed with a real
 * repro, same harness — installer survived `app.quit()` every time,
 * including with a realistic adversarial path containing spaces,
 * parentheses, an apostrophe, `%`, `^`, `!`, and `&`). `shell.openPath`
 * launches via the OS's native ShellExecute machinery — the same reason
 * `cmd.exe /c start "" "<path>"` (an earlier, also-confirmed-working
 * candidate — see §updater-install-lifecycle-security-review below)
 * survives: a ShellExecute-brokered process is never added to Electron's
 * own Job Object in the first place, so it has nothing to break away
 * from.
 *
 * §updater-install-lifecycle-security-review — `shell.openPath()` was
 * chosen over the `cmd.exe /c start` alternative specifically because it
 * has NO shell/command-line boundary at all: it takes a literal path
 * string and hands it to the OS shell API directly — there is no command
 * line for it to construct or parse, so there is structurally no
 * metacharacter-injection surface to reason about (`cmd /c start` DOES
 * introduce one — real Windows testing showed it happens to handle every
 * Windows-legal special character safely, given Node's own automatic
 * argv quoting plus `start`'s own quoted-argument handling, but "happens
 * to be safe after testing every case" is a strictly weaker property
 * than "no shell grammar is involved in the first place"). `installerPath`
 * itself is still never IPC/user-suppliable (see below) and is validated
 * against the exact expected T2 Sales artifact filename shape before use
 * regardless — this isn't relying on the absence of a shell boundary as
 * the ONLY guard, just as the strongest one.
 *
 * A native helper process (calling `CreateProcess` with
 * `CREATE_BREAKAWAY_FROM_JOB` directly, or `ShellExecuteEx` via a native
 * addon) was considered and rejected for this pass — `shell.openPath()`
 * is an already-shipped, already-used-elsewhere-in-this-codebase
 * (navigation-policy.ts's `shell.openExternal()`) Electron API with the
 * SAME underlying OS mechanism and a smaller attack surface than adding
 * new native/compiled code would; `CREATE_BREAKAWAY_FROM_JOB` also
 * requires the ambient job to have been created with
 * `JOB_OBJECT_LIMIT_BREAKAWAY_OK`, which is unverified for Electron's own
 * job on this Chromium version — an unnecessary unknown when a working,
 * lower-effort, smaller-surface mechanism is already confirmed. PowerShell
 * `Start-Process` was not pursued either — it would add a dependency on
 * `powershell.exe`/its execution policy, which this exact codebase has
 * already found to be a real, non-trivial point of failure on affected
 * machines (see signature.ts's Authenticode diagnostic work).
 *
 * `installerPath` origin, traced (§ security review): the ONLY caller is
 * `manager.ts::installUpdate()`, which passes its own private
 * `this.downloadedFilePath` — set exclusively inside `downloadUpdate()`
 * after `downloadAndVerifyInstaller()` succeeds (itself only ever
 * writing to the fixed `updateCacheDir`, under a filename validated by
 * manifest.ts's own filename regex). No IPC channel accepts a path
 * parameter (every updater IPC handler in main/index.ts takes zero
 * arguments from the renderer). Immediately before `launchInstaller()`
 * is ever called, `installUpdate()` unconditionally re-verifies the
 * on-disk file's exact size, SHA-256 (`verifyFileIntegrity`), and
 * Authenticode status + channel policy (`verifyAuthenticodeSignature` +
 * `evaluateSignaturePolicy`) — a TOCTOU recheck against the manifest's
 * own expected values, unchanged by this fix. `launchInstaller()` is
 * never the sole gate on "is this file trustworthy" — it only answers
 * "does the OS accept launching this specific, already-verified path."
 */
import { shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export class InstallLaunchError extends Error {}

/** Tightened beyond manifest.ts's own generic
 * `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.exe$` — every real installer this
 * process could ever produce is named EXACTLY
 * `T2Sales-Setup-x64-<major>.<minor>.<patch>.exe` (electron-builder.yml's
 * own `artifactName`, update-prepare.mjs's own filename regex). Matching
 * that exact shape here, at the launch boundary specifically — the last
 * checkpoint before the OS is asked to run something — is strictly
 * fail-closed defense in depth beyond what manifest.ts already enforces,
 * not a replacement for it. */
const SAFE_INSTALLER_FILENAME_RE = /^T2Sales-Setup-x64-\d+\.\d+\.\d+\.exe$/;

/** `installerPath` must be an absolute path already known to be the
 * verified, renamed-from-`.download` final installer — this function
 * does not itself re-derive or accept any other source for it (see the
 * module doc comment's traced-origin note). Resolves once
 * `shell.openPath()` itself confirms success (it resolves with an empty
 * string on success, or an error message string on failure — never
 * throws) — a real, structured confirmation from Electron itself that
 * the OS accepted the launch request, not merely "the call was made."
 * This does NOT mean installation completed — the installer runs
 * independently, genuinely detached from this process (confirmed via a
 * real Windows repro — see the module doc comment), and the desktop app
 * is expected to quit shortly after per the caller's own flow, matching
 * a normal NSIS installer replacing a running app. */
export function launchInstaller(installerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!path.isAbsolute(installerPath)) {
      reject(new InstallLaunchError('installerPath must be an absolute path'));
      return;
    }
    if (path.extname(installerPath).toLowerCase() !== '.exe') {
      reject(new InstallLaunchError('installerPath must point to a .exe'));
      return;
    }
    if (!SAFE_INSTALLER_FILENAME_RE.test(path.basename(installerPath))) {
      reject(new InstallLaunchError('installerPath has an unexpected filename shape'));
      return;
    }
    fs.stat(installerPath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        reject(new InstallLaunchError(`installer file not found at ${installerPath}`));
        return;
      }
      shell
        .openPath(installerPath)
        .then((errorMessage) => {
          if (errorMessage) {
            reject(new InstallLaunchError(`failed to launch installer: ${errorMessage}`));
            return;
          }
          resolve();
        })
        .catch((error: unknown) => {
          // shell.openPath() is documented to always resolve, never
          // reject — this is belt-and-suspenders only, matching the rest
          // of this file's "don't rely on a single layer" discipline.
          reject(new InstallLaunchError(`failed to launch installer: ${error instanceof Error ? error.message : 'unknown error'}`));
        });
    });
  });
}
