/**
 * Hotfix 20.57.1 PASS 2, finding #8 — RELAY_MAX_HEADER_BYTES was parsed
 * into RelayConfig but never applied anywhere (FastifyServerOptions has no
 * maxHeaderSize field), so oversized request headers were never actually
 * rejected by this limit regardless of what the env var was set to. Fixed
 * via Fastify's `serverFactory` hook, which hands us the real
 * http.createServer({ maxHeaderSize }) call Fastify itself doesn't expose.
 *
 * This must be a real listening server + a real raw socket request — light-
 * my-request's app.inject() bypasses Node's actual HTTP parser entirely
 * (no socket, no header-size enforcement), so it cannot prove this one way
 * or the other.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

async function freshApp(env: Record<string, string> = {}) {
  process.env.RELAY_UPSTREAM_ORIGIN = 'https://upstream.invalid';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  const { buildRelay } = await import('../src/index.js');
  return buildRelay();
}

function rawRequestWithHeader(port: number, headerValueSize: number): Promise<{ statusCode?: number; errored: boolean }> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/healthz',
        method: 'GET',
        headers: { 'x-oversized': 'x'.repeat(headerValueSize) }
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ statusCode: res.statusCode, errored: false }));
      }
    );
    req.on('error', () => resolve({ statusCode: undefined, errored: true }));
    req.end();
  });
}

describe('relay — RELAY_MAX_HEADER_BYTES actually enforced (finding #8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RELAY_MAX_HEADER_BYTES;
  });

  it('a request whose headers exceed the configured RELAY_MAX_HEADER_BYTES is rejected (431 or connection error), never reaches the route handler', async () => {
    const app = await freshApp({ RELAY_MAX_HEADER_BYTES: String(1024) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;

    const result = await rawRequestWithHeader(port, 4096);
    // Node either completes the socket with a 431 response, or aborts the
    // connection outright before a response can be written — both are
    // acceptable proof the oversized header never reached a route handler;
    // what would FAIL this test is a 200 (i.e. the limit being ignored).
    if (!result.errored) {
      expect(result.statusCode).toBe(431);
    }

    await app.close();
  });

  it('a request within the configured RELAY_MAX_HEADER_BYTES is accepted normally', async () => {
    const app = await freshApp({ RELAY_MAX_HEADER_BYTES: String(64 * 1024) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;

    const result = await rawRequestWithHeader(port, 100);
    expect(result.errored).toBe(false);
    expect(result.statusCode).toBe(200);

    await app.close();
  });
});
