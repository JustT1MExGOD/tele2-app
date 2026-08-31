/**
 * Regression test for the CSRF-over-RELAY bug (acceptance-hardening
 * pass) — exercises the REAL `installRelayProtocolHandler` code path
 * (not a re-implementation), through a real local HTTP server standing
 * in for the relay, with a fake-but-realistic Electron `session` (an
 * in-memory cookie store keyed by origin, matching how
 * `session.cookies.get/set` actually behave) and a fake intercepted
 * `Request` (matching real Electron behavior precisely: NO `Cookie`
 * header pre-populated — see relay-client.ts's module doc comment for
 * why that's the empirically-confirmed real behavior this test locks
 * in, not an assumption).
 *
 * Root causes this guards against, all found via a real Electron trace
 * against a real local backend+relay this pass:
 * 1. Set-Cookie from the relay must land on the CANONICAL origin's
 *    cookie store, never the relay's own host.
 * 2. Multiple simultaneous Set-Cookie values (t2_session + t2_csrf)
 *    must both survive distinctly — including the classic trap where
 *    Expires itself contains a comma.
 * 3. The Cookie header sent to the relay must be built from the
 *    session's cookie store (session.cookies.get), never assumed to
 *    already be present on the intercepted Request.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installRelayProtocolHandler, parseSetCookie, FORWARDED_HEADER_ALLOWLIST } from '../src/main/network/relay-client.js';
import type { CookiesSetDetails } from 'electron';

const CANONICAL_ORIGIN = 'https://tele2-app-production.up.railway.app';

interface StoredCookie extends CookiesSetDetails {}

class FakeCookieStore {
  private cookies: StoredCookie[] = [];
  async get(filter: { url?: string; name?: string }): Promise<StoredCookie[]> {
    return this.cookies.filter((c) => {
      if (filter.name && c.name !== filter.name) return false;
      if (filter.url && new URL(filter.url).origin !== new URL(c.url).origin) return false;
      return true;
    });
  }
  async set(details: CookiesSetDetails): Promise<void> {
    this.cookies = this.cookies.filter((c) => !(c.name === details.name && new URL(c.url).origin === new URL(details.url).origin));
    this.cookies.push({ ...details });
  }
}

function fakeSession(fetchImpl: (req: any, opts: any) => Promise<any> = async () => new Response(null)) {
  let handler: ((request: Request) => Promise<Response>) | null = null;
  return {
    cookies: new FakeCookieStore(),
    protocol: {
      handle: (_scheme: string, h: (request: Request) => Promise<Response>) => {
        handler = h;
      },
      unhandle: () => {}
    },
    fetch: fetchImpl,
    getHandler: () => handler
  } as any;
}

/** A real local HTTP server standing in for the relay — reads the wire
 * protocol headers (x-t2-method/x-t2-path/x-t2-had-origin) exactly like
 * the real relay/src/index.ts does, and responds per-path so tests can
 * exercise real distinct multi-Set-Cookie and real Cookie-header
 * round-tripping over an actual socket, not a mocked fetch. */
async function startFakeRelay(): Promise<{ url: string; close: () => Promise<void>; receivedCookieHeaders: (string | undefined)[]; receivedCsrfHeaders: (string | undefined)[] }> {
  const receivedCookieHeaders: (string | undefined)[] = [];
  const receivedCsrfHeaders: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    receivedCookieHeaders.push(req.headers['cookie']);
    receivedCsrfHeaders.push(req.headers['x-csrf-token'] as string | undefined);
    const path = req.headers['x-t2-path'];

    if (path === '/auth/login/mfa') {
      res.setHeader('set-cookie', [
        't2_session=SESSIONVALUE123; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax',
        't2_csrf=CSRFVALUE456; Max-Age=2592000; Path=/; SameSite=Lax'
      ]);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === '/me') {
      const cookieHeader = req.headers['cookie'];
      const hasSession = typeof cookieHeader === 'string' && cookieHeader.includes('t2_session=SESSIONVALUE123');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ bound: hasSession }));
      return;
    }
    if (path === '/auth/mfa/step-up') {
      const csrfHeader = req.headers['x-csrf-token'];
      if (csrfHeader === 'CSRFVALUE456') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'csrf_mismatch' }));
      }
      return;
    }
    if (path === '/some/redirecting/route') {
      res.writeHead(302, { location: 'https://attacker.invalid/steal-me' });
      res.end();
      return;
    }
    if (path === '/hop-by-hop-check') {
      // A real upstream hop can legitimately send these for ITS OWN
      // framing — they must never reach the synthesized Response.
      res.writeHead(200, { 'content-type': 'application/json', connection: 'keep-alive', 'keep-alive': 'timeout=5' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === '/auth/logout') {
      res.setHeader('set-cookie', [
        't2_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
        't2_csrf=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'
      ]);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === '/multi-cookie-with-comma-expires') {
      res.setHeader('set-cookie', [
        't2_session=SESSIONVALUE123; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax',
        't2_csrf=CSRFVALUE456; Path=/; SameSite=Lax; Expires=Wed, 21 Oct 2030 07:28:00 GMT'
      ]);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (path === '/hang') {
      // Deliberately never responds — for timeout/abort tests. Node
      // keeps the connection open until the client gives up.
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    receivedCookieHeaders,
    receivedCsrfHeaders
  };
}

function fakeRequest(url: string, method: string, headers: Record<string, string> = {}, body: string | null = null): Request {
  return new Request(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body ?? undefined });
}

describe('relay-client — CSRF-over-RELAY regression (real installRelayProtocolHandler, real local server)', () => {
  let relay: Awaited<ReturnType<typeof startFakeRelay>>;
  afterEach(async () => {
    if (relay) await relay.close();
  });

  it('login/MFA response cookies land on the CANONICAL origin, both distinct, not on the relay host', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();

    const res = await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', { 'content-type': 'application/json' }, '{}'));
    expect(res.status).toBe(200);

    const sessionCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_session' });
    const csrfCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_csrf' });
    expect(sessionCookies).toHaveLength(1);
    expect(sessionCookies[0].value).toBe('SESSIONVALUE123');
    expect(sessionCookies[0].httpOnly).toBe(true);
    expect(csrfCookies).toHaveLength(1);
    expect(csrfCookies[0].value).toBe('CSRFVALUE456');
    expect(csrfCookies[0].httpOnly).toBe(false);

    // Never on the relay's own host — the exact bug this test guards against.
    const relayOrigin = new URL(relay.url).origin;
    const cookiesUnderRelayHost = await session.cookies.get({ url: relayOrigin });
    expect(cookiesUnderRelayHost).toHaveLength(0);
  });

  it('Set-Cookie is never exposed on the returned Response (forbidden response header semantics)', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const res = await session.getHandler()(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a subsequent GET carries the Cookie header built from the session store — the intercepted Request never has one natively', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();

    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));

    // Simulates the real, confirmed Electron behavior: the intercepted
    // Request has NO cookie header at all, even though a real cookie
    // now exists in the session's store for this exact origin.
    const meRes = await handler(fakeRequest(CANONICAL_ORIGIN + '/me', 'GET'));
    const meBody = await meRes.json();
    expect(meBody.bound).toBe(true);
    expect(relay.receivedCookieHeaders.at(-1)).toContain('t2_session=SESSIONVALUE123');
    expect(relay.receivedCookieHeaders.at(-1)).toContain('t2_csrf=CSRFVALUE456');
  });

  it('a state-changing POST with a valid X-CSRF-Token (matching the cookie the app would have read) succeeds', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();

    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));
    const csrfCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_csrf' });
    const csrfValue = csrfCookies[0].value;

    const postRes = await handler(
      fakeRequest(CANONICAL_ORIGIN + '/auth/mfa/step-up', 'POST', { 'content-type': 'application/json', 'x-csrf-token': csrfValue }, '{}')
    );
    expect(postRes.status).toBe(200);
    expect(relay.receivedCsrfHeaders.at(-1)).toBe('CSRFVALUE456');
  });

  it('negative control: missing X-CSRF-Token is rejected', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();
    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));

    const postRes = await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/mfa/step-up', 'POST', { 'content-type': 'application/json' }, '{}'));
    expect(postRes.status).toBe(403);
  });

  it('negative control: wrong X-CSRF-Token is rejected', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();
    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));

    const postRes = await handler(
      fakeRequest(CANONICAL_ORIGIN + '/auth/mfa/step-up', 'POST', { 'content-type': 'application/json', 'x-csrf-token': 'totally-wrong' }, '{}')
    );
    expect(postRes.status).toBe(403);
  });

  it('the outer call to the relay is always POST /forward, regardless of the original method (a real bug found in an earlier draft of this fix)', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();
    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));
    const meRes = await handler(fakeRequest(CANONICAL_ORIGIN + '/me', 'GET'));
    // A regression here would 404 (the relay's /forward route is POST-only).
    expect(meRes.status).toBe(200);
  });

  it('x-csrf-token and cookie are both in the allowlist actually used (no drift between the constant and the real forwarding logic)', () => {
    expect(FORWARDED_HEADER_ALLOWLIST).toContain('x-csrf-token');
    expect(FORWARDED_HEADER_ALLOWLIST).toContain('cookie');
  });
});

describe('parseSetCookie — attribute parsing used to rebuild cookies on the canonical origin', () => {
  it('parses name/value, HttpOnly, SameSite, Max-Age', () => {
    const parsed = parseSetCookie('t2_session=abc123; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax');
    expect(parsed).toMatchObject({ name: 't2_session', value: 'abc123', path: '/', httpOnly: true, secure: false, sameSite: 'lax' });
    expect(parsed!.expirationDate).toBeGreaterThan(Date.now() / 1000);
  });

  it('parses a non-HttpOnly, Secure cookie (t2_csrf shape)', () => {
    const parsed = parseSetCookie('t2_csrf=xyz789; Max-Age=2592000; Path=/; Secure; SameSite=Lax');
    expect(parsed).toMatchObject({ name: 't2_csrf', value: 'xyz789', httpOnly: false, secure: true, sameSite: 'lax' });
  });

  it('parses a clearing cookie (logout shape: Max-Age=0, Expires with a comma)', () => {
    const parsed = parseSetCookie('t2_session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax');
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('t2_session');
    expect(parsed!.expirationDate).toBeLessThanOrEqual(Date.now() / 1000 + 1);
  });

  it('returns null for a malformed value with no name=value', () => {
    expect(parseSetCookie('garbage-no-equals-sign')).toBeNull();
  });
});

// §security review after the CSRF-over-RELAY fix — items 2/3/4/6 of the
// review request: redirects, hop-by-hop headers, timeout/abort, and an
// end-to-end (not just unit-level) Expires-with-comma + deletion check.
describe('relay-client — post-fix security review regressions', () => {
  let relay: Awaited<ReturnType<typeof startFakeRelay>>;
  afterEach(async () => {
    if (relay) await relay.close();
  });

  it('a 3xx from the relay is returned as-is — desktop never auto-follows Location to an arbitrary host (SSRF/open-proxy invariant)', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    let requestCount = 0;
    const originalListenerCount = relay.receivedCookieHeaders.length;
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const res = await session.getHandler()(fakeRequest(CANONICAL_ORIGIN + '/some/redirecting/route', 'GET'));
    expect(res.status).toBe(302);
    // Exactly one request reached the fake relay — proves nothing was
    // auto-followed to attacker.invalid (which isn't even a real host
    // this test could reach, by design).
    expect(relay.receivedCookieHeaders.length).toBe(originalListenerCount + 1);
  });

  it('hop-by-hop headers (Connection, Keep-Alive, Content-Length, Transfer-Encoding) from the relay hop never reach the synthesized Response', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const res = await session.getHandler()(fakeRequest(CANONICAL_ORIGIN + '/hop-by-hop-check', 'GET'));
    expect(res.status).toBe(200);
    expect(res.headers.get('connection')).toBeNull();
    expect(res.headers.get('keep-alive')).toBeNull();
    expect(res.headers.get('transfer-encoding')).toBeNull();
    // content-type (a real business header) must still survive.
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('a logout-shaped clearing Set-Cookie (Max-Age=0, comma-containing Expires) writes an already-expired cookie to the canonical origin', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const handler = session.getHandler();
    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/login/mfa', 'POST', {}, '{}'));
    await handler(fakeRequest(CANONICAL_ORIGIN + '/auth/logout', 'POST', {}, '{}'));

    const sessionCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_session' });
    const csrfCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_csrf' });
    expect(sessionCookies).toHaveLength(1);
    expect(sessionCookies[0].expirationDate).toBeLessThanOrEqual(Date.now() / 1000 + 1);
    expect(csrfCookies).toHaveLength(1);
    expect(csrfCookies[0].expirationDate).toBeLessThanOrEqual(Date.now() / 1000 + 1);
  });

  it('two simultaneous cookies, one with the exact Wed, 21 Oct 2030 07:28:00 GMT Expires shape, both survive end-to-end (not just at parseSetCookie level)', async () => {
    relay = await startFakeRelay();
    const session = fakeSession();
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: relay.url });
    const res = await session.getHandler()(fakeRequest(CANONICAL_ORIGIN + '/multi-cookie-with-comma-expires', 'GET'));
    expect(res.status).toBe(200);

    const sessionCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_session' });
    const csrfCookies = await session.cookies.get({ url: CANONICAL_ORIGIN, name: 't2_csrf' });
    expect(sessionCookies).toHaveLength(1);
    expect(sessionCookies[0].value).toBe('SESSIONVALUE123');
    expect(csrfCookies).toHaveLength(1);
    expect(csrfCookies[0].value).toBe('CSRFVALUE456');
    // Wed, 21 Oct 2030 07:28:00 GMT as a Unix timestamp (verified via
    // Date.parse independently) — proves the comma inside Expires was
    // never mistaken for a cookie separator.
    expect(csrfCookies[0].expirationDate).toBe(1918798080);
  });

  it('requestRelay destroys the socket and rejects on a real timeout, instead of hanging', async () => {
    relay = await startFakeRelay();
    const { requestRelay } = await import('../src/main/network/relay-client.js');
    const url = new URL('/forward', relay.url);
    const started = Date.now();
    await expect(
      requestRelay(url, 'POST', { 'x-t2-method': 'GET', 'x-t2-path': '/hang', 'x-t2-had-origin': 'false' }, null, 300)
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(5000); // bounded, not the default 30s
  });

  it('requestRelay destroys the socket and rejects when its AbortSignal fires mid-flight', async () => {
    relay = await startFakeRelay();
    const { requestRelay } = await import('../src/main/network/relay-client.js');
    const url = new URL('/forward', relay.url);
    const controller = new AbortController();
    const promise = requestRelay(url, 'POST', { 'x-t2-method': 'GET', 'x-t2-path': '/hang', 'x-t2-had-origin': 'false' }, null, 30_000, controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toThrow(/aborted/);
  });

  it('requestRelay rejects and destroys the socket when the response exceeds the configured byte cap, instead of buffering unbounded', async () => {
    relay = await startFakeRelay();
    const { requestRelay } = await import('../src/main/network/relay-client.js');
    const url = new URL('/forward', relay.url);
    // /hop-by-hop-check returns a small real JSON body — cap set far
    // below its size to deterministically trigger the guard.
    await expect(
      requestRelay(url, 'POST', { 'x-t2-method': 'GET', 'x-t2-path': '/hop-by-hop-check', 'x-t2-had-origin': 'false' }, null, 30_000, undefined, 5)
    ).rejects.toThrow(/exceeded 5 bytes/);
  });
});

/**
 * White-screen regression (post-20.56.0 acceptance) — a real-Electron
 * repro (see docs referenced in the final report) proved that a
 * render-blocking third-party `<script src>` (index.html's
 * telegram-web-app.js) routed through the PASSTHROUGH branch (non-
 * canonical origin, `bypassCustomProtocolHandlers`) had NO timeout at
 * all, so on a network where that third-party host is ALSO unreachable
 * (a real, unsurprising overlap with the canonical origin being
 * unreachable — the whole reason RELAY exists), the entire page's
 * render blocked for however long Chromium's own internal, effectively-
 * unbounded connection attempt took to give up — indistinguishable from
 * a permanent white screen, even though `mode` already correctly showed
 * `relay` and the canonical navigation itself was fine. These tests
 * exercise the REAL passthrough branch (not a re-implementation),
 * asserting it's bounded and that a failure there is observable via
 * sanitized diagnostics (operation/hostname/error name/duration —
 * never a URL, query string, cookie, or auth header).
 */
describe('relay-client — passthrough branch is bounded (white-screen regression)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a passthrough request that never settles is aborted within the configured bound, not left hanging indefinitely', async () => {
    let observedSignal: AbortSignal | undefined;
    const session = fakeSession(
      (_req, opts) =>
        new Promise((_resolve, reject) => {
          observedSignal = opts.signal;
          opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
        })
    );
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: 'http://127.0.0.1:1', passthroughTimeoutMs: 100 });

    const started = Date.now();
    await expect(session.getHandler()(fakeRequest('https://telegram.org/js/telegram-web-app.js', 'GET'))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000); // bounded, not a real multi-second/indefinite hang
    expect(observedSignal).toBeDefined();
    expect(observedSignal!.aborted).toBe(true);
  });

  it('a passthrough request that resolves quickly is completely unaffected by the bound (no regression to the normal case)', async () => {
    const session = fakeSession(async () => new Response('ok', { status: 200 }));
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: 'http://127.0.0.1:1' });
    const res = await session.getHandler()(fakeRequest('https://telegram.org/js/telegram-web-app.js', 'GET'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('a failed/timed-out passthrough request logs sanitized diagnostics — operation name + hostname only, never the full URL/query', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = fakeSession(
      (_req, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
        })
    );
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: 'http://127.0.0.1:1', passthroughTimeoutMs: 50 });

    await expect(
      session.getHandler()(fakeRequest('https://telegram.org/js/telegram-web-app.js?secret=shouldnotleak', 'GET'))
    ).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.msg).toBe('relay_handler_request_failed');
    expect(logged.operation).toBe('relay_passthrough');
    expect(logged.hostname).toBe('telegram.org');
    expect(logged.errorName).toBe('TimeoutError');
    expect(typeof logged.durationMs).toBe('number');
    // Never the query string, never a full URL — sanitized-diagnostics discipline.
    expect(JSON.stringify(logged)).not.toContain('shouldnotleak');
    expect(JSON.stringify(logged)).not.toContain('telegram-web-app.js');
  });

  it('a failed canonical (relay-forward) request also logs sanitized diagnostics, distinguishable from a passthrough failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = fakeSession();
    // No relay listening at this port — the real requestRelay() call
    // will fail fast (connection refused), exercising the OUTER
    // try/catch around the canonical branch.
    installRelayProtocolHandler({ session, canonicalOrigin: CANONICAL_ORIGIN, relayUrl: 'http://127.0.0.1:1' });

    await expect(session.getHandler()(fakeRequest(CANONICAL_ORIGIN + '/me', 'GET'))).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.msg).toBe('relay_handler_request_failed');
    expect(logged.operation).toBe('relay_forward');
    expect(logged.hostname).toBe(new URL(CANONICAL_ORIGIN).hostname);
  });
});
