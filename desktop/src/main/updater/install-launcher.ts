/**
 * Launches the verified installer. §8 of the updater brief: no command
 * line is ever built from manifest data — the ONLY input to this
 * function is a local filesystem path this process itself produced
 * (downloader.ts's verified `finalPath`), and the ONLY argument passed
 * to the installer is nothing at all (no `/S`, no silent flags — v1
 * explicitly never does a silent install, so the real NSIS installer UI
 * runs and the user goes through its normal confirm/install flow).
 * `execFile`, never `exec`/a shell string — there is no shell
 * interpretation of the path at all, so no injection surface exists
 * regardless of what characters a filename could contain (which is
 * itself already constrained to `^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$` by
 * manifest.ts).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class InstallLaunchError extends Error {}

/** `installerPath` must be an absolute path already known to be the
 * verified, renamed-from-`.download` final installer — this function
 * does not itself re-derive or accept any other source for it. Resolves
 * once the installer process has been detached and started (NOT once
 * installation completes — the installer runs independently, and the
 * desktop app is expected to quit shortly after per the caller's own
 * flow, matching a normal NSIS installer replacing a running app). */
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
    fs.stat(installerPath, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        reject(new InstallLaunchError(`installer file not found at ${installerPath}`));
        return;
      }
      // No arguments — the real NSIS UI runs, no /S, no silent flags.
      const child = execFile(installerPath, [], { windowsHide: false }, (error) => {
        // A non-zero/error here typically just means the detached
        // installer process object itself errored at spawn time (e.g.
        // permissions) — NOT that installation "failed", since we don't
        // wait for the installer to finish. Genuine spawn failures do
        // need to surface to the caller/UI, though.
        if (error && (error as NodeJS.ErrnoException).code !== undefined) {
          reject(new InstallLaunchError(`failed to launch installer: ${error.message}`));
        }
      });
      child.unref();
      resolve();
    });
  });
}
