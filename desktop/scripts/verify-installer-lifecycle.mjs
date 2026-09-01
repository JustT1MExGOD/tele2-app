// Real-Electron, real-installer-artifact process-survival check for the
// production `launchInstaller()` (`shell.openPath()`), matching main/
// index.ts's real ~1500ms `app.quit()` timing exactly.
//
// Scope, precisely: this proves ONE thing — that the specific process
// `shell.openPath()` starts survives this app's own `app.quit()`. It
// does NOT and cannot prove the installer completes a real install (that
// requires a human to click through the NSIS wizard — see docs/DESKTOP-
// UPDATES.md's manual acceptance checklist for that step, tracked
// separately, deliberately not automated here). Treat a PASS from this
// script as "the process-lifecycle half of the pipeline is fine", not as
// end-to-end proof of a successful update.
//
// Two real problems existed in an earlier version of this script and are
// fixed here:
//   1. FALSE-POSITIVE RISK: the old watcher matched by `tasklist /FI
//      "IMAGENAME eq <filename>"` — by NAME only, never the specific PID
//      this run's launch actually created. If ANY other process with the
//      same installer filename was already running (a leftover from an
//      earlier manual test, a previous run of this very script, etc. —
//      empirically observed multiple times while building this pass),
//      the check reported `survived: true` regardless of what THIS run's
//      own launch did. Fixed by snapshotting matching-name PIDs BEFORE
//      launch and only counting PIDs that are NEW after it — `shell.
//      openPath()` still doesn't hand back a PID directly, but a
//      before/after set difference identifies the newly-created one(s)
//      without needing one.
//   2. CRITICAL: the old script's own process exit code was never tied
//      to the result — it couldn't be, because the Electron process here
//      necessarily exits (to test quit-survival) before the detached
//      watcher (which does the actual check) finishes. Fixed with a
//      second, separate phase (verify-installer-lifecycle-check-result.mjs)
//      — a plain Node script that waits for the watcher's result file and
//      turns `survived: false` into a real non-zero exit code. Run both
//      together via `npm run verify:installer-lifecycle`.
//
// Run: cd desktop && npm run desktop:build && npm run verify:installer-lifecycle
import { app } from 'electron';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.join(__dirname, '..', 'release');
export const RESULT_FILE = path.join(__dirname, '..', '.verify-installer-lifecycle-result.json');
const WATCHER_SCRIPT_FILE = path.join(__dirname, '..', '.verify-installer-lifecycle-watcher.cjs');

/** Picks the HIGHEST version present under release/, never just the
 * first `readdir` happens to return (readdir order is not a version
 * order, and this directory routinely holds several historical
 * installers side by side) — so this always exercises the current
 * build, not an arbitrary older one left over from a prior pass. */
function findRealInstaller() {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const candidates = fs
    .readdirSync(RELEASE_DIR)
    .map((name) => {
      const m = /^T2Sales-Setup-x64-(\d+)\.(\d+)\.(\d+)\.exe$/.exec(name);
      return m ? { name, parts: [Number(m[1]), Number(m[2]), Number(m[3])] } : null;
    })
    .filter(Boolean);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]);
  return path.join(RELEASE_DIR, candidates[candidates.length - 1].name);
}

/** PIDs of every currently-running process with this exact image name —
 * used before AND after launch so only a genuinely NEW process counts,
 * never a stale/unrelated one with the same name. */
function snapshotPids(imageName) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH`, { encoding: 'utf8' });
    return new Set(
      out
        .trim()
        .split('\n')
        .filter((line) => line.includes(imageName))
        .map((line) => line.split(',')[1]?.replace(/"/g, ''))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

const installerPath = findRealInstaller();
if (!installerPath) {
  console.log('SKIPPED: no built installer under release/ — run `npm run desktop:package` first.');
  app.exit(0);
} else {
  app.whenReady().then(async () => {
    const imageName = path.basename(installerPath);
    try {
      fs.rmSync(RESULT_FILE, { force: true });
    } catch {}

    const pidsBefore = snapshotPids(imageName);
    console.log(`pre-launch snapshot: ${pidsBefore.size} existing process(es) named ${imageName}`);

    const { launchInstaller } = await import(
      pathToFileURL(path.join(__dirname, '..', 'dist', 'main', 'updater', 'install-launcher.js')).href
    );
    console.log('launching real installer via the real, unmodified launchInstaller()...');
    await launchInstaller(installerPath);
    console.log("launchInstaller() resolved — spawning result watcher, then quitting in 1500ms (matching main/index.ts's own INSTALL_UPDATE timing exactly)...");

    // The watcher must itself survive THIS process's app.quit() — a
    // direct spawn() of node.exe, even with detached:true, was observed
    // to die on this dev machine the same way an un-launched-via-
    // shell.openPath() installer child would, so the watcher is started
    // via `cmd /c start` (ShellExecute-brokered, same reasoning as
    // install-launcher.ts's own mechanism) rather than a direct spawn.
    const beforeList = JSON.stringify([...pidsBefore]);
    const watcherScript = `
      const { execSync } = require('node:child_process');
      const fs = require('node:fs');
      const imageName = ${JSON.stringify(imageName)};
      const pidsBefore = new Set(${beforeList});
      setTimeout(() => {
        let newPids = [];
        try {
          const out = execSync('tasklist /FI "IMAGENAME eq ' + imageName + '" /FO CSV /NH', { encoding: 'utf8' });
          const pidsAfter = out.trim().split('\\n')
            .filter((l) => l.includes(imageName))
            .map((l) => l.split(',')[1]?.replace(/"/g, ''))
            .filter(Boolean);
          newPids = pidsAfter.filter((pid) => !pidsBefore.has(pid));
        } catch {}
        const survived = newPids.length > 0;
        fs.writeFileSync(${JSON.stringify(RESULT_FILE)}, JSON.stringify({ survived, newPids }));
        for (const pid of newPids) {
          try { execSync('taskkill /PID ' + pid + ' /T /F'); } catch {}
        }
        try { fs.rmSync(${JSON.stringify(WATCHER_SCRIPT_FILE)}, { force: true }); } catch {}
      }, 4000);
    `;
    fs.writeFileSync(WATCHER_SCRIPT_FILE, watcherScript, 'utf8');
    const watcher = spawn('cmd.exe', ['/c', 'start', '""', process.execPath, WATCHER_SCRIPT_FILE], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // Without this, `process.execPath` launches as a FULL Electron app
      // (it still has real Node integration in its main process, so the
      // watcher script's require()/setTimeout work either way) — but a
      // bare script with no window and no app.quit() call never
      // terminates on its own, leaking a GPU + network-service helper
      // process pair forever. Forcing plain-Node mode makes the watcher
      // exit exactly when its own event loop drains.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    watcher.unref();

    setTimeout(() => {
      app.quit();
    }, 1500);
  });
}
