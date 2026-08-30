import { describe, it, expect, afterEach } from 'vitest';
import { runDiagnostics, type LookupFn } from '../src/main/network/diagnostics.js';
import { startLocalHttpsServer, startUntrustedHttpsServer, TEST_CA_CERT, type LocalHttpsServer } from './helpers/local-https-server.js';

// §12 of the brief: never claim "DPI detected" or any theory beyond
// what was actually observed. §3 of the verification pass: this suite
// must not depend on production, the public internet, public DNS, or
// any third-party host — every case below uses either a local ephemeral
// fixture server or an injected fake resolver, deterministically.
describe('runDiagnostics — honest, layered categorization (§12), fully local/deterministic (§3)', () => {
  let server: LocalHttpsServer | null = null;
  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('OK end-to-end against a local, trusted fixture server', async () => {
    server = await startLocalHttpsServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200);
        res.end('{"status":"ok"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const report = await runDiagnostics(server.origin, { timeoutMs: 3000, ca: TEST_CA_CERT });
    expect(report.overall).toBe('OK');
    expect(report.layers.map((l) => l.layer)).toEqual(['DNS', 'TCP', 'TLS', 'HTTP']);
    expect(report.layers.every((l) => l.outcome === 'OK')).toBe(true);
  });

  it('DNS_FAILURE via an injected resolver that always fails — deterministic, no real DNS involved', async () => {
    const fakeLookup: LookupFn = ((_hostname: string, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
      const err = new Error('getaddrinfo ENOTFOUND') as NodeJS.ErrnoException;
      err.code = 'ENOTFOUND';
      callback(err, '', 0);
    }) as LookupFn;
    const report = await runDiagnostics('https://this-hostname-is-never-actually-resolved.example', {
      timeoutMs: 3000,
      lookup: fakeLookup
    });
    expect(report.overall).toBe('DNS_FAILURE');
    expect(report.layers).toHaveLength(1);
    expect(report.layers[0].layer).toBe('DNS');
  });

  it('DNS_FAILURE categorization also covers a genuinely slow/hanging resolver as TIMEOUT — both are honest, neither is a false OK', async () => {
    // Never calls back — simulates a resolver that hangs, exactly the
    // real-world case that motivated this test in the first place (some
    // networks' DNS resolution for unregistered names is slow to fail,
    // not fast — observed directly during implementation).
    const hangingLookup: LookupFn = ((_hostname: string, _callback: unknown) => {}) as LookupFn;
    const report = await runDiagnostics('https://irrelevant-hostname.example', { timeoutMs: 500, lookup: hangingLookup });
    expect(report.overall).toBe('TIMEOUT');
    expect(report.layers).toHaveLength(1);
  });

  it('TCP_FAILURE against a local port with nothing listening', async () => {
    // Bind a server, read its port, then close it immediately — that
    // port is now (with overwhelming likelihood, deterministically for
    // this test's purposes) refusing connections, all on loopback.
    const probe = await startLocalHttpsServer((_req, res) => res.end());
    const deadPort = probe.port;
    await probe.close();
    const report = await runDiagnostics(`https://127.0.0.1:${deadPort}`, { timeoutMs: 3000 });
    expect(report.overall).toBe('TCP_FAILURE');
    expect(report.layers.map((l) => l.layer)).toEqual(['DNS', 'TCP']);
  });

  it('TLS_FAILURE for a host with a genuinely untrusted certificate (local fixture, not badssl.com)', async () => {
    server = await startUntrustedHttpsServer((_req, res) => res.end());
    // Deliberately NOT passing a `ca` — this probe only trusts the
    // system store, which does not include this fixture's self-signed
    // cert, so the handshake must fail.
    const report = await runDiagnostics(server.origin, { timeoutMs: 3000 });
    expect(report.overall).toBe('TLS_FAILURE');
    expect(report.layers.map((l) => l.layer)).toEqual(['DNS', 'TCP', 'TLS']);
  });

  it('HTTP_FAILURE when DNS/TCP/TLS all succeed but /healthz does not 2xx', async () => {
    server = await startLocalHttpsServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const report = await runDiagnostics(server.origin, { timeoutMs: 3000, ca: TEST_CA_CERT });
    expect(report.overall).toBe('HTTP_FAILURE');
    expect(report.layers.map((l) => l.layer)).toEqual(['DNS', 'TCP', 'TLS', 'HTTP']);
  });

  it('never produces an outcome outside the honest enum — no invented "DPI detected" category exists in the type system at all', async () => {
    server = await startLocalHttpsServer((_req, res) => {
      res.writeHead(200);
      res.end('{"status":"ok"}');
    });
    const report = await runDiagnostics(server.origin, { timeoutMs: 3000, ca: TEST_CA_CERT });
    const validOutcomes = ['OK', 'DNS_FAILURE', 'TCP_FAILURE', 'TLS_FAILURE', 'HTTP_FAILURE', 'TIMEOUT', 'OFFLINE', 'UNKNOWN'];
    expect(validOutcomes).toContain(report.overall);
  });
});
