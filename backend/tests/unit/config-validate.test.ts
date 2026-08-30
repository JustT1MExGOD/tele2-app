/**
 * §P1-A (20.54.0) — validateProductionConfig() (src/config/validate.ts).
 * Pure function: no DB, no app boot — mirrors the save/restore
 * process.env pattern already used by crypto-envelope.test.ts for tests
 * that manage env vars directly instead of relying on tests/setup.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { validateProductionConfig, ConfigValidationError } from '../../src/config/validate.js';

describe('validateProductionConfig()', () => {
  const original = process.env.MINI_APP_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.MINI_APP_URL;
    else process.env.MINI_APP_URL = original;
  });

  it('throws when MINI_APP_URL is unset', () => {
    delete process.env.MINI_APP_URL;
    expect(() => validateProductionConfig()).toThrow(ConfigValidationError);
  });

  it('throws when MINI_APP_URL is not a valid URL', () => {
    process.env.MINI_APP_URL = 'not-a-url';
    expect(() => validateProductionConfig()).toThrow(ConfigValidationError);
  });

  it('throws when MINI_APP_URL is not https', () => {
    process.env.MINI_APP_URL = 'http://app.example.com';
    expect(() => validateProductionConfig()).toThrow(ConfigValidationError);
  });

  it('passes for a valid https URL', () => {
    process.env.MINI_APP_URL = 'https://app.example.com';
    expect(() => validateProductionConfig()).not.toThrow();
  });
});
