import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { downloadAndVerifyInstaller, verifyFileIntegrity, DownloadError } from '../src/main/updater/downloader.js';
import { startLocalHttpsServer, TEST_CA_CERT, type LocalHttpsServer } from './helpers/local-https-server.js';
import type { UpdateManifest } from '../src/main/updater/manifest.js';

const REAL_CONTENT = Buffer.from('this is a fake installer body, just for testing'.repeat(200));
const REAL_SHA256 = crypto.createHash('sha256').update(REAL_CONTENT).digest('hex');

function manifestFor(server: LocalHttpsServer, overrides: Partial<UpdateManifest['installer']> = {}): UpdateManifest {
  return {
    schemaVersion: 1,
    channel: 'stable',
    version: '20.55.1',
    publishedAt: new Date().toISOString(),
    mandatory: false,
    installer: {
      filename: 'T2Sales-Setup-x64-20.55.1.exe',
      url: `${server.origin}/releases/T2Sales-Setup-x64-20.55.1.exe`,
      sha256: REAL_SHA256,
      size: REAL_CONTENT.length,
      ...overrides
    }
  };
}

async function tempCacheDir(): Promise<string> {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), 't2-updater-test-'));
}

/** Wraps downloadAndVerifyInstaller with the test-only trusted CA — see
 * downloader.ts's `extraTrustedCa` doc comment: production never passes
 * this, only tests, to run against a real local HTTPS fixture. */
function download(manifest: UpdateManifest, cacheDir: string, server: LocalHttpsServer, extra: Record<string, unknown> = {}) {
  return downloadAndVerifyInstaller(manifest, cacheDir, { allowedOrigin: server.origin, extraTrustedCa: TEST_CA_CERT, ...extra });
}

describe('downloadAndVerifyInstaller — success', () => {
  let server: LocalHttpsServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it('downloads, verifies size + SHA-256, and renames to the final filename', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(REAL_CONTENT.length) });
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    const result = await download(manifest, cacheDir, server);
    expect(path.basename(result.filePath)).toBe(manifest.installer.filename);
    const onDisk = await fsPromises.readFile(result.filePath);
    expect(onDisk.equals(REAL_CONTENT)).toBe(true);
    const entries = await fsPromises.readdir(cacheDir);
    expect(entries.every((e) => !e.endsWith('.download'))).toBe(true);
  });

  it('reports progress as bytes arrive', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    const progressEvents: number[] = [];
    await download(manifest, cacheDir, server, { onProgress: (p: { receivedBytes: number }) => progressEvents.push(p.receivedBytes) });
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.at(-1)).toBe(REAL_CONTENT.length);
  });
});

describe('downloadAndVerifyInstaller — integrity failures', () => {
  let server: LocalHttpsServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it('rejects and cleans up the temp file on SHA-256 mismatch', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server, { sha256: 'f'.repeat(64) });
    await expect(download(manifest, cacheDir, server)).rejects.toThrow(DownloadError);
    const entries = await fsPromises.readdir(cacheDir).catch(() => []);
    expect(entries).toEqual([]);
  });

  it('rejects on wrong declared size (manifest.size does not match actual bytes)', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200); // no content-length — the byte-count check during streaming is what catches it
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server, { size: REAL_CONTENT.length + 100 });
    await expect(download(manifest, cacheDir, server)).rejects.toThrow(DownloadError);
    expect(await fsPromises.readdir(cacheDir).catch(() => [])).toEqual([]);
  });

  it('rejects an oversized response mid-stream (actual bytes exceed manifest.size) without buffering it all in memory', async () => {
    const oversized = Buffer.alloc(REAL_CONTENT.length * 3, 1);
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200);
      res.end(oversized);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server, { size: REAL_CONTENT.length }); // claims the SMALL size, server sends more
    await expect(download(manifest, cacheDir, server)).rejects.toThrow(/exceeding/);
    expect(await fsPromises.readdir(cacheDir).catch(() => [])).toEqual([]);
  });

  it('rejects when Content-Length disagrees with manifest.size before any body is read', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length + 500) });
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    await expect(download(manifest, cacheDir, server)).rejects.toThrow(/Content-Length/);
  });
});

describe('downloadAndVerifyInstaller — network failures', () => {
  let server: LocalHttpsServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it('times out and cleans up if the server never responds', async () => {
    server = await startLocalHttpsServer(() => {
      // never respond
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    const started = Date.now();
    await expect(download(manifest, cacheDir, server, { timeoutMs: 300 })).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await fsPromises.readdir(cacheDir).catch(() => [])).toEqual([]);
  });

  it('cleans up on a connection reset mid-download (interrupted)', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      res.write(REAL_CONTENT.subarray(0, 10));
      res.destroy(); // simulate an interrupted connection
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    await expect(download(manifest, cacheDir, server)).rejects.toThrow();
    expect(await fsPromises.readdir(cacheDir).catch(() => [])).toEqual([]);
  });

  it('is cancellable via AbortSignal and cleans up the temp file', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      let i = 0;
      const iv = setInterval(() => {
        if (i >= REAL_CONTENT.length) {
          clearInterval(iv);
          return;
        }
        res.write(REAL_CONTENT.subarray(i, i + 1));
        i++;
      }, 30);
      req.on('close', () => clearInterval(iv));
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    await expect(download(manifest, cacheDir, server, { signal: controller.signal })).rejects.toThrow(/aborted/);
    expect(await fsPromises.readdir(cacheDir).catch(() => [])).toEqual([]);
  }, 10000);

  it('rejects a redirect instead of following it', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(302, { location: 'https://attacker.invalid/evil.exe' });
      res.end();
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    await expect(download(manifest, cacheDir, server)).rejects.toThrow(/redirect/);
  });
});

describe('downloadAndVerifyInstaller — TLS is genuinely verified, not just assumed', () => {
  it('rejects a self-signed/untrusted certificate when no extraTrustedCa is provided — production behavior', async () => {
    const { startUntrustedHttpsServer } = await import('./helpers/local-https-server.js');
    const server = await startUntrustedHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      res.end(REAL_CONTENT);
    });
    try {
      const cacheDir = await tempCacheDir();
      const manifest = manifestFor(server);
      // Deliberately NOT passing extraTrustedCa here — this is what a
      // real production call looks like against an untrusted cert.
      await expect(downloadAndVerifyInstaller(manifest, cacheDir, { allowedOrigin: server.origin })).rejects.toThrow();
    } finally {
      await server.close();
    }
  });
});

describe('verifyFileIntegrity — TOCTOU re-check against an already-on-disk file (security gate §1)', () => {
  it('resolves when the on-disk file still matches the expected size + SHA-256', async () => {
    const cacheDir = await tempCacheDir();
    const filePath = path.join(cacheDir, 'installer.exe');
    await fsPromises.writeFile(filePath, REAL_CONTENT);
    await expect(verifyFileIntegrity(filePath, REAL_SHA256, REAL_CONTENT.length)).resolves.toBeUndefined();
  });

  it('rejects when the file was swapped for different content of the SAME size (hash changed, size did not)', async () => {
    const cacheDir = await tempCacheDir();
    const filePath = path.join(cacheDir, 'installer.exe');
    const tampered = Buffer.alloc(REAL_CONTENT.length, 0x41); // same length, different bytes
    await fsPromises.writeFile(filePath, tampered);
    await expect(verifyFileIntegrity(filePath, REAL_SHA256, REAL_CONTENT.length)).rejects.toThrow(/SHA-256/);
  });

  it('rejects when the file size changed', async () => {
    const cacheDir = await tempCacheDir();
    const filePath = path.join(cacheDir, 'installer.exe');
    await fsPromises.writeFile(filePath, Buffer.concat([REAL_CONTENT, Buffer.from('extra')]));
    await expect(verifyFileIntegrity(filePath, REAL_SHA256, REAL_CONTENT.length)).rejects.toThrow(/size changed/);
  });

  it('rejects when the file is missing entirely (deleted during the ready_to_install window)', async () => {
    const cacheDir = await tempCacheDir();
    const filePath = path.join(cacheDir, 'does-not-exist.exe');
    await expect(verifyFileIntegrity(filePath, REAL_SHA256, REAL_CONTENT.length)).rejects.toThrow(/missing/);
  });
});

describe('downloadAndVerifyInstaller — filesystem safety (security gate §2/§5)', () => {
  let server: LocalHttpsServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it('removes a stale leftover .download temp file from a previous crashed run before starting a new download', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    const staleTemp = path.join(cacheDir, `${manifest.installer.filename}.deadbeef0000.download`);
    await fsPromises.writeFile(staleTemp, Buffer.from('leftover from a crashed run'));

    await download(manifest, cacheDir, server);

    expect(fs.existsSync(staleTemp)).toBe(false);
  });

  it('safely replaces a stale FINAL-name file left over from a previous successful download of the same filename', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-length': String(REAL_CONTENT.length) });
      res.end(REAL_CONTENT);
    });
    const cacheDir = await tempCacheDir();
    const manifest = manifestFor(server);
    const finalPath = path.join(cacheDir, manifest.installer.filename);
    await fsPromises.writeFile(finalPath, Buffer.from('stale content from a prior run'));

    const result = await download(manifest, cacheDir, server);

    const onDisk = await fsPromises.readFile(result.filePath);
    expect(onDisk.equals(REAL_CONTENT)).toBe(true);
  });
});

describe('downloadAndVerifyInstaller — origin/scheme enforcement (defense in depth beyond manifest validation)', () => {
  it('refuses an http:// installer URL even if somehow passed', async () => {
    const cacheDir = await tempCacheDir();
    const manifest: UpdateManifest = {
      schemaVersion: 1,
      channel: 'stable',
      version: '20.55.1',
      publishedAt: new Date().toISOString(),
      mandatory: false,
      installer: { filename: 'x.exe', url: 'http://updates.vincere-mortem.ru/releases/x.exe', sha256: 'a'.repeat(64), size: 10 }
    };
    await expect(
      downloadAndVerifyInstaller(manifest, cacheDir, { allowedOrigin: 'https://updates.vincere-mortem.ru' })
    ).rejects.toThrow(/https only/);
  });

  it('refuses an installer URL on a different origin than allowedOrigin', async () => {
    const cacheDir = await tempCacheDir();
    const manifest: UpdateManifest = {
      schemaVersion: 1,
      channel: 'stable',
      version: '20.55.1',
      publishedAt: new Date().toISOString(),
      mandatory: false,
      installer: { filename: 'x.exe', url: 'https://attacker.example/releases/x.exe', sha256: 'a'.repeat(64), size: 10 }
    };
    await expect(
      downloadAndVerifyInstaller(manifest, cacheDir, { allowedOrigin: 'https://updates.vincere-mortem.ru' })
    ).rejects.toThrow(/does not match/);
  });
});

