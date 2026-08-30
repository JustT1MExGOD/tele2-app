/**
 * Ephemeral, deterministic local HTTPS test server — replaces the
 * previous reliance on production `/healthz` and public third-party
 * hosts (badssl.com) in the relay unit/integration suite (§3 of the
 * verification pass: `npx vitest run` must not depend on production,
 * the public internet, public DNS, Railway, or any third-party host).
 *
 * Uses the fixture keypair in tests/fixtures/ (CN=localhost, self-signed,
 * test-only — see tests/fixtures/README.md).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

export const TEST_CA_CERT = fs.readFileSync(path.join(FIXTURE_DIR, 'test-cert.pem'));
const TEST_KEY = fs.readFileSync(path.join(FIXTURE_DIR, 'test-key.pem'));

export interface LocalHttpsServer {
  port: number;
  origin: string;
  close: () => Promise<void>;
}

/** Starts a real HTTPS server on 127.0.0.1 with the test fixture cert,
 * bound to an OS-assigned ephemeral port (never a fixed port — avoids
 * collisions between parallel test files). */
export async function startLocalHttpsServer(handler: https.RequestListener): Promise<LocalHttpsServer> {
  const server = https.createServer({ cert: TEST_CA_CERT, key: TEST_KEY }, handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    origin: `https://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

/** A second, genuinely untrusted self-signed server (a DIFFERENT fixture
 * keypair from the trusted one above, never added to any agent's
 * trusted CA anywhere) — for tests that need to prove TLS verification
 * actually rejects an untrusted certificate. */
export async function startUntrustedHttpsServer(handler: https.RequestListener): Promise<LocalHttpsServer> {
  const untrustedCert = fs.readFileSync(path.join(FIXTURE_DIR, 'untrusted-cert.pem'));
  const untrustedKey = fs.readFileSync(path.join(FIXTURE_DIR, 'untrusted-key.pem'));
  const server = https.createServer({ cert: untrustedCert, key: untrustedKey }, handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    origin: `https://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
