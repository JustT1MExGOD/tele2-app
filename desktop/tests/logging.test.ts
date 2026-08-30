/**
 * §37-39 of the RC verification pass — log redaction. logging.ts had no
 * dedicated test before this pass; found during the audit that
 * SENSITIVE_HEADER_NAMES was missing x-step-up-token (added to the
 * relay wire protocol allowlist earlier in this same pass) — not an
 * active leak today (redactHeaders has no call site yet), but a real
 * gap that would have silently reappeared the moment logging was wired
 * up to header data, since step-up tickets are exactly the class of
 * secret this function exists to protect.
 */
import { describe, it, expect } from 'vitest';
import { redactHeaders, redactPath } from '../src/main/logging.js';

describe('redactHeaders — every security-sensitive header the app actually sends is redacted', () => {
  it('redacts cookie, set-cookie, authorization, x-csrf-token, x-step-up-token, proxy-authorization', () => {
    const result = redactHeaders({
      cookie: 't2_session=secret',
      'set-cookie': 't2_csrf=secret2',
      authorization: 'Bearer secret3',
      'x-csrf-token': 'secret4',
      'x-step-up-token': 'secret5',
      'proxy-authorization': 'secret6'
    });
    for (const key of Object.keys(result)) {
      expect(result[key]).toBe('[redacted]');
    }
  });

  it('leaves non-sensitive headers untouched', () => {
    const result = redactHeaders({ accept: 'application/json', 'content-type': 'application/json' });
    expect(result['accept']).toBe('application/json');
    expect(result['content-type']).toBe('application/json');
  });

  it('is case-insensitive', () => {
    const result = redactHeaders({ 'X-Step-Up-Token': 'secret' });
    expect(result['X-Step-Up-Token']).toBe('[redacted]');
  });
});

describe('redactPath — never logs a query string', () => {
  it('strips everything after ?', () => {
    expect(redactPath('/auth/reset/abc?token=secret')).toBe('/auth/reset/abc?[redacted]');
  });
  it('leaves a query-free path untouched', () => {
    expect(redactPath('/me')).toBe('/me');
  });
});
