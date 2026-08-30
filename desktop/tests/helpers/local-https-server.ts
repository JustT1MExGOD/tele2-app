/**
 * Ephemeral, deterministic local HTTPS test server — same helper as
 * relay/tests/helpers/local-https-server.ts (duplicated rather than
 * shared, since desktop/ and relay/ are independent packages), used to
 * remove desktop's diagnostics tests' dependency on production/the
 * public internet (§3 of the verification pass).
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
