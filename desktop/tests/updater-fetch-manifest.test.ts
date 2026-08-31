import { describe, it, expect, afterEach } from 'vitest';
import { fetchManifest, ManifestFetchError } from '../src/main/updater/fetch-manifest.js';
import { ManifestValidationError } from '../src/main/updater/manifest.js';
import { startLocalHttpsServer, startUntrustedHttpsServer, TEST_CA_CERT, type LocalHttpsServer } from './helpers/local-https-server.js';

describe('fetchManifest — TLS is genuinely verified, not just assumed', () => {
  let server: LocalHttpsServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it('rejects a self-signed/untrusted certificate when no extraTrustedCa is provided — production behavior', async () => {
    server = await startUntrustedHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    // Deliberately not passing extraTrustedCa — matches the real
    // production call in updater/manager.ts.
    await expect(fetchManifest(server.origin, 'stable', 1000)).rejects.toThrow();
  });
});

describe('fetchManifest — real HTTP-level behavior against a trusted local server', () => {
  let server: LocalHttpsServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it('parses and validates a real manifest response', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          schemaVersion: 1,
          channel: 'stable',
          version: '20.55.1',
          publishedAt: new Date().toISOString(),
          mandatory: false,
          installer: {
            filename: 'T2Sales-Setup-x64-20.55.1.exe',
            url: `${server.origin}/releases/T2Sales-Setup-x64-20.55.1.exe`,
            sha256: 'a'.repeat(64),
            size: 1000
          }
        })
      );
    });
    const manifest = await fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT);
    expect(manifest.version).toBe('20.55.1');
  });

  it('rejects a redirect instead of following it', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(302, { location: 'https://attacker.invalid/manifest.json' });
      res.end();
    });
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(ManifestFetchError);
  });

  it('rejects a non-200 status', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(/HTTP 404/);
  });

  it('rejects malformed JSON', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{not valid json');
    });
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(/not valid JSON/);
  });

  it('rejects an oversized response body', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }));
    });
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(/exceeded/);
  });

  it('rejects a declared Content-Length over the cap BEFORE reading the body (security gate §4)', async () => {
    server = await startLocalHttpsServer((req, res) => {
      // Declares an oversized Content-Length but never actually sends
      // that much — proves the rejection happens off the header, not by
      // waiting for the (nonexistent) excess bytes to arrive.
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(5 * 1024 * 1024) });
      res.end('{}');
    });
    const started = Date.now();
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(/Content-Length/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('propagates schema validation failures as ManifestValidationError', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schemaVersion: 99 }));
    });
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(ManifestValidationError);
  });

  it('rejects a manifest whose own channel field does not match the requested channel', async () => {
    server = await startLocalHttpsServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          schemaVersion: 1,
          channel: 'beta',
          version: '20.55.1',
          publishedAt: new Date().toISOString(),
          mandatory: false,
          installer: { filename: 'x.exe', url: `${server.origin}/releases/x.exe`, sha256: 'a'.repeat(64), size: 10 }
        })
      );
    });
    await expect(fetchManifest(server.origin, 'stable', 5000, TEST_CA_CERT)).rejects.toThrow(ManifestValidationError);
  });

  it('times out against a hanging server', async () => {
    server = await startLocalHttpsServer(() => {
      // never respond
    });
    await expect(fetchManifest(server.origin, 'stable', 300, TEST_CA_CERT)).rejects.toThrow(/timed out/);
  });
});
