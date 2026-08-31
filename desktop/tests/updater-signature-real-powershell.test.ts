/**
 * Real, un-mocked PowerShell invocation test (§updater-postdownload-error
 * regression) — every test in updater-signature.test.ts mocks
 * `node:child_process`, which is exactly why the original `-Command
 * <script> -- <path>` invocation's real breakage on Windows PowerShell
 * 5.1 went undetected: no test ever actually shelled out to a real
 * powershell.exe. This file deliberately does NOT mock child_process —
 * it runs verifyAuthenticodeSignature() for real, against a real built
 * installer on disk, exactly as the packaged app would.
 *
 * Requires `npm run desktop:build` (compiles dist/) and
 * `npm run desktop:package` (produces a real installer under release/)
 * to have been run first — skips with a clear message if neither
 * artifact is present, rather than failing CI runs that only do
 * `npm test` without a full package build.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_SIGNATURE_MODULE = path.join(__dirname, '..', 'dist', 'main', 'updater', 'signature.js');
const RELEASE_DIR = path.join(__dirname, '..', 'release');

function findRealInstaller(): string | null {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const match = fs.readdirSync(RELEASE_DIR).find((name) => /^T2Sales-Setup-x64-.*\.exe$/.test(name));
  return match ? path.join(RELEASE_DIR, match) : null;
}

const distExists = fs.existsSync(DIST_SIGNATURE_MODULE);
const installerPath = findRealInstaller();

describe.runIf(distExists && installerPath !== null)('verifyAuthenticodeSignature — REAL PowerShell, REAL built installer (no mocks)', () => {
  it(
    'returns status: NotSigned for the real current unsigned installer — never throws/UnknownError',
    async () => {
      const { verifyAuthenticodeSignature } = await import(pathToFileURL(DIST_SIGNATURE_MODULE).href);
      const started = Date.now();
      const result = await verifyAuthenticodeSignature(installerPath as string);
      // A real PowerShell round-trip — bounded, not instant, but must not
      // hang anywhere near the 15s default timeout.
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(result.status).toBe('NotSigned');
      expect(result.signed).toBe(false);
      expect(result.subject).toBeNull();
    },
    20_000 // real powershell.exe startup (a genuinely slow process on this machine) can exceed vitest's 5s default
  );

  it(
    'completes without throwing for a real, valid path — the historical bug threw "MissingExpressionAfterOperator" on every single real call',
    async () => {
      const { verifyAuthenticodeSignature } = await import(pathToFileURL(DIST_SIGNATURE_MODULE).href);
      await expect(verifyAuthenticodeSignature(installerPath as string)).resolves.toBeDefined();
    },
    20_000
  );
});

describe.runIf(!distExists || installerPath === null)('verifyAuthenticodeSignature — REAL PowerShell test skipped', () => {
  it('skipped: run `npm run desktop:build && npm run desktop:package` first to exercise this against a real installer', () => {
    console.log(
      `[updater-signature-real-powershell] skipped — dist exists: ${distExists}, installer found: ${installerPath ?? '(none)'}`
    );
    expect(true).toBe(true);
  });
});
