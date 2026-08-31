/**
 * §17 of the updater brief — a real local update-server integration
 * test: one local HTTPS static-file server serving BOTH
 * /stable/manifest.json and /releases/<installer>.exe (mirroring the
 * real VPS layout — docs/DESKTOP-UPDATES.md), exercised through the
 * REAL fetchManifest() + REAL downloadAndVerifyInstaller() together
 * (not the mocked UpdateManager tests), reaching a verified,
 * ready-to-install file on disk. Deliberately never invokes
 * launchInstaller()/installUpdate() — no real installer is ever run in
 * an automated test.
 */
import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchManifest } from '../src/main/updater/fetch-manifest.js';
import { downloadAndVerifyInstaller } from '../src/main/updater/downloader.js';
import { isNewerVersion } from '../src/main/updater/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const TEST_CA_CERT = fs.readFileSync(path.join(FIXTURE_DIR, 'test-cert.pem'));
const TEST_KEY = fs.readFileSync(path.join(FIXTURE_DIR, 'test-key.pem'));

const FAKE_INSTALLER_CONTENT = Buffer.from('T2Sales fake installer bytes for integration testing'.repeat(500));
const FAKE_INSTALLER_SHA256 = crypto.createHash('sha256').update(FAKE_INSTALLER_CONTENT).digest('hex');
const FAKE_INSTALLER_FILENAME = 'T2Sales-Setup-x64-20.99.0.exe';

describe('updater — full local integration (real manifest fetch + real download+verify, no real installer run)', () => {
  let server: import('node:https').Server;
  let origin: string;

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('mirrors the real VPS layout: /stable/manifest.json + /releases/<file>.exe, served from one static server', async () => {
    server = https.createServer({ cert: TEST_CA_CERT, key: TEST_KEY }, (req, res) => {
      if (req.url === '/stable/manifest.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            channel: 'stable',
            version: '20.99.0',
            publishedAt: new Date().toISOString(),
            mandatory: false,
            installer: {
              filename: FAKE_INSTALLER_FILENAME,
              url: `${origin}/releases/${FAKE_INSTALLER_FILENAME}`,
              sha256: FAKE_INSTALLER_SHA256,
              size: FAKE_INSTALLER_CONTENT.length
            },
            releaseNotes: 'Integration test release'
          })
        );
        return;
      }
      if (req.url === `/releases/${FAKE_INSTALLER_FILENAME}`) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(FAKE_INSTALLER_CONTENT.length) });
        res.end(FAKE_INSTALLER_CONTENT);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    origin = `https://127.0.0.1:${port}`;

    // Step 1 — real manifest fetch + real schema/origin validation.
    const manifest = await fetchManifest(origin, 'stable', 5000, TEST_CA_CERT);
    expect(manifest.version).toBe('20.99.0');
    expect(manifest.installer.sha256).toBe(FAKE_INSTALLER_SHA256);

    // Step 2 — real version comparison, as UpdateManager itself does.
    expect(isNewerVersion('20.55.0', manifest.version)).toBe(true);

    // Step 3 — real streaming download + real SHA-256/size verification.
    const cacheDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 't2-updater-integration-'));
    const result = await downloadAndVerifyInstaller(manifest, cacheDir, {
      allowedOrigin: origin,
      extraTrustedCa: TEST_CA_CERT
    });

    // Step 4 — "ready to install" state: a verified file exists at the
    // final (not .download) path, byte-for-byte correct.
    expect(path.basename(result.filePath)).toBe(FAKE_INSTALLER_FILENAME);
    const onDisk = await fsPromises.readFile(result.filePath);
    expect(onDisk.equals(FAKE_INSTALLER_CONTENT)).toBe(true);
    const entries = await fsPromises.readdir(cacheDir);
    expect(entries).toEqual([FAKE_INSTALLER_FILENAME]); // no leftover .download temp file

    // Deliberately stops here — no launchInstaller()/installUpdate()
    // call anywhere in this test. Verifying the file is ready is the
    // full extent of what an automated test should ever do.
  });
});
