/**
 * §ammendment 4/round 4 — multiple simultaneous Set-Cookie headers must
 * stay distinct end-to-end, including the specific regression case where
 * an Expires attribute itself contains a comma (the classic trap for
 * naive Headers-coalescing code, since `Headers.get()`/a plain object
 * merge would comma-join multiple Set-Cookie values on top of an
 * Expires value that ALREADY has a comma in it).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { toWebHeaders } from '../src/forward.js';
import { buildRelay } from '../src/index.js';

const SESSION_COOKIE = 't2_session=abc123; HttpOnly; Secure; SameSite=Lax; Path=/';
const CSRF_COOKIE_WITH_COMMA_EXPIRES = 't2_csrf=xyz789; Path=/; SameSite=Lax; Expires=Wed, 21 Oct 2026 07:28:00 GMT';

describe('toWebHeaders — raw multi-value Set-Cookie stays distinct, not comma-joined', () => {
  it('preserves two simultaneous cookies, one with a comma inside Expires', () => {
    const nodeHeaders = {
      'set-cookie': [SESSION_COOKIE, CSRF_COOKIE_WITH_COMMA_EXPIRES],
      'content-type': 'application/json'
    };
    const headers = toWebHeaders(nodeHeaders);
    const setCookies = headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    expect(setCookies).toContain(SESSION_COOKIE);
    expect(setCookies).toContain(CSRF_COOKIE_WITH_COMMA_EXPIRES);
    // The naive path this guards against — confirms the trap is real,
    // not hypothetical: a plain .get('set-cookie') DOES corrupt this.
    const naive = headers.get('set-cookie');
    expect(naive).not.toBe(SESSION_COOKIE);
    expect(naive).not.toBe(CSRF_COOKIE_WITH_COMMA_EXPIRES);
  });

  it('every cookie attribute survives intact (Secure/HttpOnly/SameSite/Path/Expires)', () => {
    const headers = toWebHeaders({ 'set-cookie': [SESSION_COOKIE, CSRF_COOKIE_WITH_COMMA_EXPIRES] });
    const [session, csrf] = headers.getSetCookie();
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Path=/');
    expect(csrf).toContain('Expires=Wed, 21 Oct 2026 07:28:00 GMT');
    expect(csrf).toContain('SameSite=Lax');
  });

  it('a single Set-Cookie value (non-array) still works', () => {
    const headers = toWebHeaders({ 'set-cookie': SESSION_COOKIE });
    expect(headers.getSetCookie()).toEqual([SESSION_COOKIE]);
  });
});

describe('relay /forward route — multiple Set-Cookie reach the actual HTTP response as distinct header lines', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a mocked upstream response with two Set-Cookie values produces two distinct set-cookie lines on the relay response', async () => {
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return {
        ...actual,
        forwardToUpstream: vi.fn().mockResolvedValue({
          status: 200,
          headers: toWebHeaders({
            'set-cookie': [SESSION_COOKIE, CSRF_COOKIE_WITH_COMMA_EXPIRES],
            'content-type': 'application/json'
          }),
          body: Buffer.from('{"ok":true}')
        })
      };
    });
    vi.resetModules();
    // forwardToUpstream is mocked below — this value is never actually
    // contacted, but kept as a plausible-looking https:// value so
    // config validation (loadRelayConfig) passes without depending on
    // any real host, per §3 of the verification pass.
    process.env.RELAY_UPSTREAM_ORIGIN = 'https://upstream.invalid';
    const { buildRelay: buildRelayFresh } = await import('../src/index.js');
    const app = await buildRelayFresh();

    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: { 'x-t2-method': 'GET', 'x-t2-path': '/api/me', 'x-t2-had-origin': 'false' }
    });

    const setCookieValues = res.headers['set-cookie'];
    expect(Array.isArray(setCookieValues)).toBe(true);
    expect(setCookieValues).toHaveLength(2);
    expect(setCookieValues).toContain(SESSION_COOKIE);
    expect(setCookieValues).toContain(CSRF_COOKIE_WITH_COMMA_EXPIRES);
    void buildRelay;
    await app.close();
  });
});

// §RC verification pass — found via a real local integration run
// (backend + relay, real login): a bare `addContentTypeParser('*', ...)`
// does not override Fastify's built-in `application/json` parser, so
// every real JSON POST (every login, every mutation) reached the
// upstream with an EMPTY body — `request.body` was Fastify's own parsed
// object, not the raw Buffer, and `(object).length` is `undefined`,
// which index.ts's `rawBody.length > 0` check treated as bodyless.
// Fixed with `removeAllContentTypeParsers()` before the wildcard buffer
// parser. This test proves the fix by asserting the exact byte content
// forwardToUpstream receives for a real `application/json` request.
describe('relay /forward route — JSON request bodies are forwarded intact, not silently dropped', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a real application/json POST body reaches forwardToUpstream byte-for-byte', async () => {
    let capturedBody: Buffer | null | undefined;
    vi.doMock('../src/forward.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/forward.js')>();
      return {
        ...actual,
        forwardToUpstream: vi.fn().mockImplementation(async (input: { body: Buffer | null }) => {
          capturedBody = input.body;
          return { status: 200, headers: new Headers(), body: Buffer.from('{"ok":true}') };
        })
      };
    });
    vi.resetModules();
    process.env.RELAY_UPSTREAM_ORIGIN = 'https://upstream.invalid';
    const { buildRelay: buildRelayFresh } = await import('../src/index.js');
    const app = await buildRelayFresh();

    const payload = JSON.stringify({ phone: '+79990000001', password: 'correct horse battery staple' });
    const res = await app.inject({
      method: 'POST',
      url: '/forward',
      headers: {
        'x-t2-method': 'POST',
        'x-t2-path': '/auth/login',
        'x-t2-had-origin': 'true',
        'content-type': 'application/json'
      },
      payload
    });

    expect(res.statusCode).toBe(200);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toBeInstanceOf(Buffer);
    expect(capturedBody!.toString('utf8')).toBe(payload);
    await app.close();
  });
});
