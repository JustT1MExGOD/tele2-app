// Real-Electron, real-installer-artifact lifecycle check
// (§updater-install-lifecycle regression). A mocked unit test cannot
// reproduce this bug at all: the failure is specific to how a REAL
// Windows Electron process's own Job Object interacts with a REAL child
// process it spawns — see install-launcher.ts's module doc comment for
// the full root-cause writeup (confirmed via `execFile`-of-the-.exe,
// with AND without `detached: true`, both killed the installer the
// instant `app.quit()` ran; `cmd.exe /c start` — ShellExecute-brokered,
// never added to the job in the first place — survives).
//
// This script:
//   1. Spawns a DETACHED watcher (itself immune to this process's own
//      exit, by the same `cmd /c start`-adjacent Windows semantics)
//      that waits past this process's own planned app.quit(), then
//      checks tasklist for the installer image name and writes a
//      PASS/FAIL result file — because by the time app.quit() has
//      actually happened, THIS process (and therefore any in-process
//      assertion) no longer exists to report a result itself.
//   2. Calls the real, shipped launchInstaller() against a real built
//      installer under release/ (skips with a clear message if none
//      exists — does not build one).
//   3. Calls app.quit() after the same 1500ms delay main/index.ts uses.
//
// Run: cd desktop && npm run desktop:build && \
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron.cmd scripts/verify-installer-lifecycle.mjs
// Cleans up the surviving installer process itself once the check is
// complete — this script's own job, not the operator's.
import { app } from 'electron';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.join(__dirname, '..', 'release');
const RESULT_FILE = path.join(__dirname, '..', '.verify-installer-lifecycle-result.json');

function findRealInstaller() {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const match = fs.readdirSync(RELEASE_DIR).find((name) => /^T2Sales-Setup-x64-.*\.exe$/.test(name));
  return match ? path.join(RELEASE_DIR, match) : null;
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

    // A small, self-contained watcher script (no dependency on this
    // process's own module graph — it will outlive it) — waits long
    // enough for THIS process's own 1500ms-delayed app.quit() to have
    // already happened, then checks tasklist, writes the result, and
    // kills whatever installer process it found (cleanup — this check
    // never completes a real install).
    const watcherScript = `
      const { execSync } = require('node:child_process');
      const fs = require('node:fs');
      setTimeout(() => {
        let survived = false;
        let pid = null;
        try {
          const out = execSync('tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH', { encoding: 'utf8' });
          const line = out.trim().split('\\n').find((l) => l.includes('${imageName}'));
          if (line) {
            survived = true;
            pid = line.split(',')[1]?.replace(/"/g, '');
          }
        } catch {}
        fs.writeFileSync(${JSON.stringify(RESULT_FILE)}, JSON.stringify({ survived, pid }));
        if (pid) {
          try { execSync('taskkill /PID ' + pid + ' /T /F'); } catch {}
        }
        try { fs.rmSync(${JSON.stringify(path.join(__dirname, '..', '.verify-installer-lifecycle-watcher.cjs'))}, { force: true }); } catch {}
      }, 4000);
    `;
    // The watcher must itself survive this process's app.quit() — a
    // direct spawn() of node.exe, even with detached:true, is subject to
    // the EXACT SAME Job Object kill-on-close behavior this whole script
    // exists to verify a fix for (confirmed the hard way while building
    // this script: a directly-spawned watcher never even reached its own
    // setTimeout). So the watcher is launched via the identical
    // `cmd /c start` mechanism as the real fix, for the same reason.
    const watcherScriptPath = path.join(__dirname, '..', '.verify-installer-lifecycle-watcher.cjs');
    fs.writeFileSync(watcherScriptPath, watcherScript, 'utf8');
    const watcher = spawn('cmd.exe', ['/c', 'start', '""', process.execPath, watcherScriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // Without this, `process.execPath` launches as a FULL Electron app
      // (it has real Node integration in its main process, so the
      // watcher script's require()/setTimeout still work) — but a bare
      // script with no window and no app.quit() call never terminates on
      // its own, leaking a GPU + network-service helper process pair
      // forever. Forcing plain-Node mode makes the watcher exit exactly
      // when its own event loop drains, same as any normal Node script.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    watcher.unref();

    const { launchInstaller } = await import(
      pathToFileURL(path.join(__dirname, '..', 'dist', 'main', 'updater', 'install-launcher.js')).href
    );
    console.log('launching real installer via the real (fixed) launchInstaller()...');
    await launchInstaller(installerPath);
    console.log('launchInstaller() resolved — quitting in 1500ms, matching main/index.ts exactly...');

    setTimeout(() => {
      app.quit();
    }, 1500);
  });
}
