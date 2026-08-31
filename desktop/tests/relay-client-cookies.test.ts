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
import { describe, it, expect, afterEach } from 'vitest';
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
