import { describe, it, expect } from 'vitest';
import { buildUpstreamRequestHeaders, buildClientResponseHeaders, pickAllowedHeaders, RELAY_USER_AGENT } from '../src/headers.js';

describe('buildUpstreamRequestHeaders — positive allowlist, not a deny-list', () => {
  it('RELAY-04 forwards only allowlisted request headers, drops everything else', () => {
    const clientHeaders = new Headers({
      cookie: 't2_session=abc',
      'content-type': 'application/json',
      'x-csrf-token': 'tok',
      accept: 'application/json',
      'accept-language': 'ru',
      'x-evil-header': 'should-be-dropped',
      'x-forwarded-for': '1.2.3.4',
      forwarded: 'for=1.2.3.4'
    });
    const result = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(result['cookie']).toBe('t2_session=abc');
    expect(result['content-type']).toBe('application/json');
    expect(result['x-csrf-token']).toBe('tok');
    expect(result['x-evil-header']).toBeUndefined();
    expect(result['x-forwarded-for']).toBeUndefined();
    expect(result['forwarded']).toBeUndefined();
  });

  it('RELAY-03 Host is never taken from the client — this function never even reads a Host header', () => {
    const clientHeaders = new Headers({ host: 'evil.example' });
    const result = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(result['host']).toBeUndefined();
  });

  it('Origin is presence-preserving and reconstructed only from canonicalOrigin, never from the client', () => {
    // Client "claims" an Origin via headers — buildUpstreamRequestHeaders
    // never reads it; only the boolean hadOriginHeader flag matters.
    const clientHeaders = new Headers({ origin: 'https://attacker.example' });
    const withOrigin = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: true, canonicalOrigin: 'https://app.example' });
    expect(withOrigin['origin']).toBe('https://app.example');

    const withoutOrigin = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(withoutOrigin['origin']).toBeUndefined();
  });

  it('Sec-Fetch-Site is always same-origin, set by the relay, never from the client', () => {
    const clientHeaders = new Headers({ 'sec-fetch-site': 'cross-site' });
    const result = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(result['sec-fetch-site']).toBe('same-origin');
  });

  it('User-Agent is the relay\'s own fixed string, never the client\'s', () => {
    const clientHeaders = new Headers({ 'user-agent': 'Mozilla/5.0 (evil spoofed UA)' });
    const result = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(result['user-agent']).toBe(RELAY_USER_AGENT);
  });

  it('Referer is dropped, never reconstructed', () => {
    const clientHeaders = new Headers({ referer: 'https://app.example/page' });
    const result = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(result['referer']).toBeUndefined();
  });

  // §RC verification pass — found via a real local integration run: a
  // legitimate x-step-up-token was silently dropped, so every
  // step-up-gated privileged endpoint (e.g. POST
  // /auth/admin/reset-password/:id) failed closed through RELAY even
  // with a genuinely fresh MFA ticket. Fail-closed means this was never
  // a security hole, but it was a real functional gap — fixed by adding
  // x-step-up-token to REQUEST_HEADER_ALLOWLIST.
  it('x-step-up-token is forwarded — required for step-up-gated privileged endpoints to work at all through RELAY', () => {
    const clientHeaders = new Headers({ 'x-step-up-token': 'a-real-ticket' });
    const result = buildUpstreamRequestHeaders({ clientHeaders, hadOriginHeader: false, canonicalOrigin: 'https://app.example' });
    expect(result['x-step-up-token']).toBe('a-real-ticket');
  });
});

describe('buildClientResponseHeaders — response-side positive allowlist', () => {
  it('forwards load-bearing headers the app actually uses', () => {
    const upstreamHeaders = new Headers({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="sales_2026-01-01_2026-01-31.csv"',
      'cache-control': 'private, max-age=300',
      etag: '"abc123"',
      'x-railway-internal-id': 'should-not-leak'
    });
    const result = buildClientResponseHeaders(upstreamHeaders);
    expect(result['content-type']).toBe('text/csv; charset=utf-8');
    expect(result['content-disposition']).toContain('sales_2026-01-01_2026-01-31.csv');
    expect(result['cache-control']).toBe('private, max-age=300');
    expect(result['etag']).toBe('"abc123"');
    expect(result['x-railway-internal-id']).toBeUndefined();
  });

  it('RELAY-17/18 hop-by-hop headers are never in the allowlist at all', () => {
    const upstreamHeaders = new Headers({
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-length': '999999'
    });
    const result = buildClientResponseHeaders(upstreamHeaders);
    expect(result['connection']).toBeUndefined();
    expect(result['transfer-encoding']).toBeUndefined();
    expect(result['content-length']).toBeUndefined();
  });
});

describe('pickAllowedHeaders — helper correctness', () => {
  it('is case-insensitive and returns only requested names present in the source', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const result = pickAllowedHeaders(headers, ['content-type', 'accept']);
    expect(result).toEqual({ 'content-type': 'application/json' });
  });
});
