/**
 * Acceptance-prep task 5 — confirm DIRECT_ONLY / AUTO / RELAY mode
 * configuration behavior. loadDesktopConfig() had no dedicated test file
 * before this pass, even though it's the component that decides the
 * app's startup network mode and validates T2_PUBLIC_APP_ORIGIN/
 * T2_RELAY_URL — the values an acceptance-test operator sets before
 * launching the built installer.
 */
import { describe, it, expect } from 'vitest';
import { loadDesktopConfig, DesktopConfigError } from '../src/main/config.js';

describe('loadDesktopConfig — T2_NETWORK_MODE (DIRECT_ONLY / AUTO / RELAY selection)', () => {
  it('defaults to auto when unset', () => {
    const config = loadDesktopConfig({});
    expect(config.initialNetworkMode).toBe('auto');
  });

  it('accepts direct_only', () => {
    const config = loadDesktopConfig({ T2_NETWORK_MODE: 'direct_only' });
    expect(config.initialNetworkMode).toBe('direct_only');
  });

  it('accepts relay', () => {
    const config = loadDesktopConfig({ T2_NETWORK_MODE: 'relay' });
    expect(config.initialNetworkMode).toBe('relay');
  });

  it('accepts auto explicitly', () => {
    const config = loadDesktopConfig({ T2_NETWORK_MODE: 'auto' });
    expect(config.initialNetworkMode).toBe('auto');
  });

  it('rejects an unrecognized value (fail-closed, not silently defaulted)', () => {
    expect(() => loadDesktopConfig({ T2_NETWORK_MODE: 'compatibility' })).toThrow(DesktopConfigError);
    expect(() => loadDesktopConfig({ T2_NETWORK_MODE: 'DIRECT' })).toThrow(DesktopConfigError); // case-sensitive, no silent normalization
  });
});

describe('loadDesktopConfig — T2_PUBLIC_APP_ORIGIN (the origin the acceptance build must point at)', () => {
  it('defaults to the real production origin when unset', () => {
    const config = loadDesktopConfig({});
    expect(config.publicAppOrigin).toBe('https://tele2-app-production.up.railway.app');
  });

  it('honors an explicit https override (acceptance-environment origin)', () => {
    const config = loadDesktopConfig({ T2_PUBLIC_APP_ORIGIN: 'https://staging.example.com' });
    expect(config.publicAppOrigin).toBe('https://staging.example.com');
  });

  it('rejects a non-https origin — never silently downgrades to http', () => {
    expect(() => loadDesktopConfig({ T2_PUBLIC_APP_ORIGIN: 'http://staging.example.com' })).toThrow(DesktopConfigError);
  });

  it('rejects a malformed URL', () => {
    expect(() => loadDesktopConfig({ T2_PUBLIC_APP_ORIGIN: 'not-a-url' })).toThrow(DesktopConfigError);
  });
});

describe('loadDesktopConfig — T2_RELAY_URL (the acceptance relay to use for RELAY mode)', () => {
  it('defaults to empty (no relay configured) when unset', () => {
    const config = loadDesktopConfig({});
    expect(config.relayUrl).toBe('');
  });

  it('honors an explicit https relay URL', () => {
    const config = loadDesktopConfig({ T2_RELAY_URL: 'https://relay.example.com' });
    expect(config.relayUrl).toBe('https://relay.example.com');
  });

  it('allows http://127.0.0.1 (local relay dev/testing exception) but rejects other http hosts', () => {
    const local = loadDesktopConfig({ T2_RELAY_URL: 'http://127.0.0.1:8787' });
    expect(local.relayUrl).toBe('http://127.0.0.1:8787');
    expect(() => loadDesktopConfig({ T2_RELAY_URL: 'http://relay.example.com' })).toThrow(DesktopConfigError);
  });
});
