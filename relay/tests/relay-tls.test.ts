import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createUpstreamAgent, forwardToUpstream } from '../src/forward.js';
import { startLocalHttpsServer, startUntrustedHttpsServer, TEST_CA_CERT, type LocalHttpsServer } from './helpers/local-https-server.js';

describe('relay TLS discipline — never rejectUnauthorized:false anywhere', () => {
  it('createUpstreamAgent() does not set rejectUnauthorized:false', () => {
    const agent = createUpstreamAgent();
    // https.Agent stores its constructor options on `.options`.
    expect((agent as unknown as { options: { rejectUnauthorized?: boolean } }).options.rejectUnauthorized).not.toBe(false);
  });

  let server: LocalHttpsServer | null = null;
  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  // RELAY-09 — deterministic, local, no public internet dependency (§3
  // of the verification pass: previously used self-signed.badssl.com).
  it('RELAY-09 an untrusted upstream certificate is rejected, not silently accepted', async () => {
    server = await startUntrustedHttpsServer((_req, res) => {
      res.writeHead(200);
      res.end('should never be read');
    });
    // Deliberately NOT passing the untrusted server's cert as a trusted
    // CA — this agent only trusts the system store (empty for this
    // fixture's self-signed, never-registered cert), so the handshake
    // must fail.
    const agent = createUpstreamAgent();
    await expect(
      forwardToUpstream(
        { method: 'GET', path: '/', hadOriginHeader: false, clientHeaders: new Headers(), body: null },
        server.origin,
        agent,
        5000
      )
    ).rejects.toBeTruthy();
  });

  // Companion positive case: the SAME mechanism (real TLS handshake, no
  // rejectUnauthorized override) succeeds against a server whose cert
  // IS explicitly trusted for this one test agent — proves the failure
  // above is really about certificate trust, not e.g. a broken local
  // server setup.
  it('a trusted local HTTPS server (test fixture CA) is accepted', async () => {
    server = await startLocalHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    const agent = createUpstreamAgent(TEST_CA_CERT);
    const result = await forwardToUpstream(
      { method: 'GET', path: '/', hadOriginHeader: false, clientHeaders: new Headers(), body: null },
      server.origin,
      agent,
      5000
    );
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe('{"status":"ok"}');
  });

  it('no source file in relay/src sets rejectUnauthorized:false or NODE_TLS_REJECT_UNAUTHORIZED, outside of comments documenting the rule itself', () => {
    const srcDir = path.join(import.meta.dirname, '..', 'src');
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    // Strip /** */ block comments and // line comments before matching —
    // this file's own docblocks legitimately mention the forbidden
    // pattern as prose ("never set rejectUnauthorized:false") to explain
    // the rule; only actual code should trip this check.
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const file of files) {
      const code = stripComments(fs.readFileSync(path.join(srcDir, file), 'utf8'));
      expect(code, `${file} must not disable TLS verification`).not.toMatch(/rejectUnauthorized\s*:\s*false/);
      expect(code, `${file} must not set NODE_TLS_REJECT_UNAUTHORIZED`).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    }
  });
});
