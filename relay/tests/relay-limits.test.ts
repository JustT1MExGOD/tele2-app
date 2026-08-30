import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter, PerIpThrottle } from '../src/limits.js';
import { loadRelayConfig, RelayConfigError } from '../src/config.js';

describe('ConcurrencyLimiter — RELAY-16 connection exhaustion controls', () => {
  it('allows up to the configured max, then rejects', () => {
    const limiter = new ConcurrencyLimiter(2);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false); // 3rd rejected
    expect(limiter.activeCount).toBe(2);
  });

  it('releasing frees a slot for a subsequent acquire', () => {
    const limiter = new ConcurrencyLimiter(1);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('release() never goes negative on double-release', () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.release();
    limiter.release();
    expect(limiter.activeCount).toBe(0);
  });
});

describe('PerIpThrottle — basic abuse resistance, independent of backend rate limiting', () => {
  it('allows up to the per-minute cap for one IP, then blocks within the same window', () => {
    const throttle = new PerIpThrottle(3);
    const now = Date.now();
    expect(throttle.allow('1.2.3.4', now)).toBe(true);
    expect(throttle.allow('1.2.3.4', now)).toBe(true);
    expect(throttle.allow('1.2.3.4', now)).toBe(true);
    expect(throttle.allow('1.2.3.4', now)).toBe(false);
  });

  it('different IPs are tracked independently', () => {
    const throttle = new PerIpThrottle(1);
    const now = Date.now();
    expect(throttle.allow('1.1.1.1', now)).toBe(true);
    expect(throttle.allow('2.2.2.2', now)).toBe(true);
  });

  it('a new window resets the count', () => {
    const throttle = new PerIpThrottle(1);
    const now = Date.now();
    expect(throttle.allow('1.2.3.4', now)).toBe(true);
    expect(throttle.allow('1.2.3.4', now)).toBe(false);
    expect(throttle.allow('1.2.3.4', now + 61_000)).toBe(true);
  });
});

describe('loadRelayConfig — fail-closed on missing/invalid config (RELAY-12/13 size limits, RELAY-14 timeouts sourced from here)', () => {
  it('throws when RELAY_UPSTREAM_ORIGIN is missing', () => {
    expect(() => loadRelayConfig({})).toThrow(RelayConfigError);
  });

  it('throws when RELAY_UPSTREAM_ORIGIN is not https', () => {
    expect(() => loadRelayConfig({ RELAY_UPSTREAM_ORIGIN: 'http://example.com' })).toThrow(RelayConfigError);
  });

  it('applies sane defaults when only the required value is set', () => {
    const config = loadRelayConfig({ RELAY_UPSTREAM_ORIGIN: 'https://example.com' });
    expect(config.upstreamOrigin).toBe('https://example.com');
    expect(config.maxBodyBytes).toBeGreaterThan(0);
    expect(config.requestTimeoutMs).toBeGreaterThan(0);
    expect(config.maxConcurrentRequests).toBeGreaterThan(0);
  });

  it('respects overrides for size/timeout/concurrency limits', () => {
    const config = loadRelayConfig({
      RELAY_UPSTREAM_ORIGIN: 'https://example.com',
      RELAY_MAX_BODY_BYTES: '1024',
      RELAY_REQUEST_TIMEOUT_MS: '5000',
      RELAY_MAX_CONCURRENT_REQUESTS: '10'
    });
    expect(config.maxBodyBytes).toBe(1024);
    expect(config.requestTimeoutMs).toBe(5000);
    expect(config.maxConcurrentRequests).toBe(10);
  });
});
