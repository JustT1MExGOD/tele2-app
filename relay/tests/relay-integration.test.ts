/**
 * §RC verification pass, §58-68 — end-to-end integration tests against
 * the real Fastify app (buildRelay()), not just the unit-level pieces
 * already covered by relay-limits.test.ts/relay-headers.test.ts. Each
 * test exercises the real request → Fastify → forward.ts call boundary;
 * forwardToUpstream itself is mocked (deterministic, no real network),
 * everything ABOVE that boundary (body parsing, limits, concurrency,
 * header/status passthrough) is real.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

async function freshApp(env: Record<string, string> = {}) {
  process.env.RELAY_UPSTREAM_ORIGIN = 'https://upstream.invalid';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  const { buildRelay } = await import('../src/index.js');
  return buildRelay();
}

describe('relay /forward — body size limits (RELAY-12/13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.RELAY_MAX_BODY_BYTES;
  });

  it('a within-limit body is accepted and reaches forwardToUpstream intact', async () => {
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), body: Buffer.from('ok') }) };
    });
    const app = await freshApp({ RELAY_MAX_BODY_BYTES: '1024' });
    const payload = 'x'.repeat(500);
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'POST', 'x-t2-path': '/api/thing', 'x-t2-had-origin': 'false', 'content-type': 'text/plain' },
      payload
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('an over-limit body is cleanly rejected — no crash, no forwardToUpstream call', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), body: Buffer.from('ok') });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp({ RELAY_MAX_BODY_BYTES: '1024' });
    const payload = 'x'.repeat(5000);
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'POST', 'x-t2-path': '/api/thing', 'x-t2-had-origin': 'false', 'content-type': 'text/plain' },
      payload
    });
    expect(res.statusCode).toBe(413);
    expect(forwardSpy).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('relay /forward — default bodyLimit vs 20 MiB chat attachments (hotfix 20.57.1, finding #2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RELAY_MAX_BODY_BYTES;
  });

  // backend/src/core/chat/attachment-validation.ts::MAX_ATTACHMENT_BYTES —
  // relay is a separate package (no dependency on backend), so the
  // real attachment ceiling is duplicated here deliberately, not imported.
  const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

  it('a just-under-20MiB multipart body (default RELAY_MAX_BODY_BYTES, unset) is accepted, not rejected by the relay', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), body: Buffer.from('ok') });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp(); // no RELAY_MAX_BODY_BYTES override — real production default
    const payload = 'x'.repeat(MAX_ATTACHMENT_BYTES - 1024); // file content + a little multipart overhead headroom
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'POST', 'x-t2-path': '/chat/attachments', 'x-t2-had-origin': 'true', 'content-type': 'multipart/form-data; boundary=x' },
      payload
    });
    expect(res.statusCode).toBe(200);
    expect(forwardSpy).toHaveBeenCalled();
    await app.close();
  });

  it('a body far above any real attachment size is still rejected — relay stays a bounded fixed-upstream proxy, not unbounded', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({ status: 200, headers: new Headers(), body: Buffer.from('ok') });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp(); // real production default
    const payload = 'x'.repeat(60 * 1024 * 1024); // 60 MiB — well above any legitimate chat attachment
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'POST', 'x-t2-path': '/chat/attachments', 'x-t2-had-origin': 'true', 'content-type': 'multipart/form-data; boundary=x' },
      payload
    });
    expect(res.statusCode).toBe(413);
    expect(forwardSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('a small JSON payload is unaffected by the raised default (no regression for ordinary requests)', async () => {
    const forwardSpy = vi.fn().mockResolvedValue({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: Buffer.from('{"ok":true}') });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardSpy };
    });
    const app = await freshApp();
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/me', 'x-t2-had-origin': 'false' }
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('relay /forward — concurrency cap with real backpressure (RELAY-16)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RELAY_MAX_CONCURRENT_REQUESTS;
  });

  it('a request beyond the concurrency cap is rejected while one is in-flight, then a slot frees up after completion', async () => {
    let releaseInFlight: () => void = () => {};
    const inFlightGate = new Promise<void>((resolve) => { releaseInFlight = resolve; });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return {
        ...actual,
        forwardToUpstream: vi.fn().mockImplementation(async () => {
          await inFlightGate;
          return { status: 200, headers: new Headers(), body: Buffer.from('ok') };
        })
      };
    });
    const app = await freshApp({ RELAY_MAX_CONCURRENT_REQUESTS: '1' });

    const first = app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/api/slow', 'x-t2-had-origin': 'false' }
    });
    // Give the first request a tick to actually acquire its concurrency slot.
    await new Promise((r) => setTimeout(r, 20));

    const second = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/api/slow', 'x-t2-had-origin': 'false' }
    });
    expect(second.statusCode).toBe(503);

    releaseInFlight();
    const firstRes = await first;
    expect(firstRes.statusCode).toBe(200);

    // Slot freed — a third request now succeeds instead of being rejected.
    const third = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/api/slow', 'x-t2-had-origin': 'false' }
    });
    expect(third.statusCode).toBe(200);
    await app.close();
  });
});

describe('relay /forward — upstream failure cleans up the concurrency slot (timeout/crash resilience)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a rejected/timed-out upstream call still releases its concurrency slot for the next request', async () => {
    const forwardMock = vi.fn()
      .mockRejectedValueOnce(new Error('simulated upstream timeout'))
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), body: Buffer.from('ok') });
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return { ...actual, forwardToUpstream: forwardMock };
    });
    const app = await freshApp({ RELAY_MAX_CONCURRENT_REQUESTS: '1' });

    const failed = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/api/timeout', 'x-t2-had-origin': 'false' }
    });
    expect(failed.statusCode).toBe(502);

    // If the slot leaked, this second request would get 503 (relay_overloaded).
    const next = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/api/ok', 'x-t2-had-origin': 'false' }
    });
    expect(next.statusCode).toBe(200);
    await app.close();
  });
});

describe('relay /forward — upstream redirect does not turn the relay into an SSRF redirect follower', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a 302 with Location from upstream passes the status through but strips Location (not on the response allowlist)', async () => {
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return {
        ...actual,
        forwardToUpstream: vi.fn().mockResolvedValue({
          status: 302,
          headers: new Headers({ location: 'http://127.0.0.1:1/attacker-controlled' }),
          body: Buffer.alloc(0)
        })
      };
    });
    const app = await freshApp();
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/some/redirecting/route', 'x-t2-had-origin': 'false' }
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBeUndefined();
    await app.close();
  });
});
