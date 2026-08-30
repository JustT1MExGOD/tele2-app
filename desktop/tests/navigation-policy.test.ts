import { describe, it, expect } from 'vitest';
import { isSameOrigin, isSafeExternalUrl } from '../src/main/navigation-policy.js';

const CANONICAL = 'https://tele2-app-production.up.railway.app';

describe('isSameOrigin — DESK-05 arbitrary domain navigation blocked', () => {
  it('accepts the canonical origin, any path', () => {
    expect(isSameOrigin('https://tele2-app-production.up.railway.app/some/path', CANONICAL)).toBe(true);
  });

  it('rejects a different domain', () => {
    expect(isSameOrigin('https://evil.example/', CANONICAL)).toBe(false);
  });

  it('rejects a lookalike domain (subdomain confusion)', () => {
    expect(isSameOrigin('https://tele2-app-production.up.railway.app.evil.example/', CANONICAL)).toBe(false);
  });

  it('rejects a different scheme on the same host', () => {
    expect(isSameOrigin('http://tele2-app-production.up.railway.app/', CANONICAL)).toBe(false);
  });

  it('DESK-06 javascript: navigation is rejected (fails URL parse against an origin)', () => {
    expect(isSameOrigin('javascript:alert(1)', CANONICAL)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(() => isSameOrigin('not a url at all', CANONICAL)).not.toThrow();
    expect(isSameOrigin('not a url at all', CANONICAL)).toBe(false);
  });
});

describe('isSafeExternalUrl — §42 external link scheme allowlist', () => {
  it('allows https:', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
  });

  it('allows mailto:', () => {
    expect(isSafeExternalUrl('mailto:support@example.com')).toBe(true);
  });

  it('DESK-06 rejects javascript:', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects file:', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects data:', () => {
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects a custom/arbitrary scheme', () => {
    expect(isSafeExternalUrl('myapp://do-something')).toBe(false);
  });

  it('rejects http: (not https)', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(() => isSafeExternalUrl('  javascript:alert(1)')).not.toThrow();
  });
});
