/**
 * NetworkDiagnosticsService (§12 of the brief). Layers: DNS → TCP → TLS →
 * HTTP. No separate "APPLICATION" layer — per plan review, GET /healthz
 * already IS the application's own endpoint (backend/src/app.ts), not
 * generic infrastructure, so a duplicate layer testing the same thing
 * under a different name would add nothing. HTTP layer below IS the
 * application probe.
 *
 * Never claims a diagnosis beyond what was actually observed — no "DPI
 * detected", no theories. A timeout is TIMEOUT. UI-facing copy built on
 * top of this (not in this file) says "прямое соединение недоступна",
 * never a guessed cause.
 *
 * `lookup`/`ca` are injectable (§ verification pass round 2, §3): tests
 * run against local, ephemeral fixtures instead of real DNS/the public
 * internet — production callers simply omit both, which is exactly the
 * previous (unweakened) behavior: real system DNS, real system CA trust
 * store, `rejectUnauthorized` always `true`.
 */
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import type { DiagnosticOutcome, DiagnosticsReport, LayerResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export type LookupFn = typeof dns.lookup;

function defaultLookup(hostname: string, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void): void {
  dns.lookup(hostname, callback);
}

async function probeDns(hostname: string, timeoutMs: number, lookup: LookupFn): Promise<LayerResult> {
  const start = Date.now();
  const lookupPromise = new Promise<void>((resolve, reject) => {
    (lookup as (h: string, cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => void)(hostname, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  try {
    await withTimeout(lookupPromise, timeoutMs);
    return { layer: 'DNS', outcome: 'OK', durationMs: Date.now() - start };
  } catch (e) {
    const outcome = e instanceof Error && e.message === 'TIMEOUT' ? 'TIMEOUT' : 'DNS_FAILURE';
    return { layer: 'DNS', outcome, durationMs: Date.now() - start };
  }
}

async function probeTcp(hostname: string, port: number, timeoutMs: number): Promise<LayerResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port, timeout: timeoutMs });
    const finish = (outcome: DiagnosticOutcome) => {
      socket.destroy();
      resolve({ layer: 'TCP', outcome, durationMs: Date.now() - start });
    };
    socket.once('connect', () => finish('OK'));
    socket.once('timeout', () => finish('TIMEOUT'));
    socket.once('error', () => finish('TCP_FAILURE'));
  });
}

/**
 * Real certificate validation — never rejectUnauthorized:false (§9/§21/
 * DESK-09). A failure here is a genuine TLS_FAILURE, not swallowed.
 * `ca`, when supplied (tests only — see module docblock), ADDS a
 * trusted CA for this one probe rather than disabling verification.
 */
async function probeTls(hostname: string, port: number, timeoutMs: number, ca?: string | Buffer): Promise<LayerResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: true, ca, timeout: timeoutMs });
    const finish = (outcome: DiagnosticOutcome) => {
      socket.destroy();
      resolve({ layer: 'TLS', outcome, durationMs: Date.now() - start });
    };
    socket.once('secureConnect', () => finish('OK'));
    socket.once('timeout', () => finish('TIMEOUT'));
    socket.once('error', () => finish('TLS_FAILURE'));
  });
}

async function probeHttp(healthzUrl: string, timeoutMs: number, ca?: string | Buffer): Promise<LayerResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const req = https.get(healthzUrl, { timeout: timeoutMs, rejectUnauthorized: true, ca }, (res) => {
      res.resume(); // drain, we only care about status
      const ok = typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300;
      resolve({ layer: 'HTTP', outcome: ok ? 'OK' : 'HTTP_FAILURE', durationMs: Date.now() - start });
      req.destroy();
    });
    req.once('timeout', () => {
      req.destroy();
      resolve({ layer: 'HTTP', outcome: 'TIMEOUT', durationMs: Date.now() - start });
    });
    req.once('error', () => {
      resolve({ layer: 'HTTP', outcome: 'HTTP_FAILURE', durationMs: Date.now() - start });
    });
  });
}

export interface DiagnosticsOptions {
  timeoutMs?: number;
  /** Test-only: injects a fake DNS resolver instead of the real system
   * one. Never used by production code (NetworkManager never passes
   * this). */
  lookup?: LookupFn;
  /** Test-only: an additional trusted CA for the TLS/HTTP layers, so a
   * test can run a real, real-TLS-verified probe against a local
   * fixture server instead of a real host. Never used by production
   * code — omitted, behavior is identical to before (system trust store
   * only). */
  ca?: string | Buffer;
}

/**
 * Runs the full DNS→TCP→TLS→HTTP chain against the given origin. Stops
 * at the first failing layer (no point probing TLS if TCP already
 * failed) — `overall` reflects the first failure, or OK if all four
 * passed.
 */
export async function runDiagnostics(originUrl: string, options: DiagnosticsOptions = {}): Promise<DiagnosticsReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lookup = options.lookup ?? (defaultLookup as unknown as LookupFn);
  const url = new URL(originUrl);
  const hostname = url.hostname;
  const port = url.port ? Number(url.port) : 443;
  const layers: LayerResult[] = [];

  const dnsResult = await probeDns(hostname, timeoutMs, lookup);
  layers.push(dnsResult);
  if (dnsResult.outcome !== 'OK') {
    return { timestamp: new Date().toISOString(), overall: dnsResult.outcome, layers };
  }

  const tcpResult = await probeTcp(hostname, port, timeoutMs);
  layers.push(tcpResult);
  if (tcpResult.outcome !== 'OK') {
    return { timestamp: new Date().toISOString(), overall: tcpResult.outcome, layers };
  }

  const tlsResult = await probeTls(hostname, port, timeoutMs, options.ca);
  layers.push(tlsResult);
  if (tlsResult.outcome !== 'OK') {
    return { timestamp: new Date().toISOString(), overall: tlsResult.outcome, layers };
  }

  const healthzUrl = new URL('/healthz', url).toString();
  const httpResult = await probeHttp(healthzUrl, timeoutMs, options.ca);
  layers.push(httpResult);

  return { timestamp: new Date().toISOString(), overall: httpResult.outcome, layers };
}
