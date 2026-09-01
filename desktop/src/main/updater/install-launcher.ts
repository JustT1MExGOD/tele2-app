/**
 * Launches the verified installer. §8 of the updater brief: no command
 * line is ever built from manifest data — the ONLY input to this
 * function is a local filesystem path this process itself produced
 * (downloader.ts's verified `finalPath`), and the ONLY argument passed
 * to the installer is nothing at all (no `/S`, no silent flags — v1
 * explicitly never does a silent install, so the real NSIS installer UI
 * runs and the user goes through its normal confirm/install flow).
 *
 * Security: `shell.openPath()` has NO shell/command-line boundary at
 * all — it takes a literal path string and hands it to the OS shell API
 * directly, so there is structurally no metacharacter-injection surface
 * to reason about (unlike a `cmd.exe`-based alternative, which was
 * considered and rejected specifically for introducing one). `installerPath`
 * is never IPC/user-suppliable — traced below — and is validated against
 * the exact expected T2 Sales artifact filename shape before use
 * regardless, as defense in depth beyond the absence of a shell boundary.
 * Every check below is fail-closed: any mismatch rejects before the OS is
 * ever asked to run anything.
 *
 * `installerPath` origin, traced: the ONLY caller is
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
 * own expected values. `launchInstaller()` is never the sole gate on "is
 * this file trustworthy" — it only answers "does the OS accept launching
 * this specific, already-verified path."
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
 * independently, and the desktop app is expected to quit shortly after
 * per the caller's own flow, matching a normal NSIS installer replacing
 * a running app. */
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
