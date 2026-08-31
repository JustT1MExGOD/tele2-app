/**
 * Acceptance-prep task 5 — confirm DIRECT_ONLY / AUTO / RELAY mode
 * configuration behavior. loadDesktopConfig() had no dedicated test file
 * before this pass, even though it's the component that decides the
 * app's startup network mode and validates T2_PUBLIC_APP_ORIGIN/
 * T2_RELAY_URL — the values an acceptance-test operator sets before
 * launching the built installer.
 */
import { describe, it, expect } from 'vitest';
import { loadDesktopConfig, DesktopConfigError, DEFAULT_PRODUCTION_RELAY_URL } from '../src/main/config.js';

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
  it('defaults to empty (no relay configured) when unset and NOT packaged', () => {
    const config = loadDesktopConfig({});
    expect(config.relayUrl).toBe('');
    expect(config.relayHost).toBeNull();
  });

  it('honors an explicit https relay URL', () => {
    const config = loadDesktopConfig({ T2_RELAY_URL: 'https://relay.example.com' });
    expect(config.relayUrl).toBe('https://relay.example.com');
    expect(config.relayHost).toBe('relay.example.com');
  });

  it('allows http://127.0.0.1 (local relay dev/testing exception) but rejects other http hosts', () => {
    const local = loadDesktopConfig({ T2_RELAY_URL: 'http://127.0.0.1:8787' });
    expect(local.relayUrl).toBe('http://127.0.0.1:8787');
    expect(() => loadDesktopConfig({ T2_RELAY_URL: 'http://relay.example.com' })).toThrow(DesktopConfigError);
  });
});

// Item 1/5.A of the "make relay.vincere-mortem.ru the default" pass —
// exact precedence: explicit env wins, then packaged-production default,
// then nothing (dev/test isolation).
describe('loadDesktopConfig — default relay precedence (env > packaged default > none)', () => {
  it('explicit T2_RELAY_URL wins even when packaged=true', () => {
    const config = loadDesktopConfig({ T2_RELAY_URL: 'https://override.example.com' }, true);
    expect(config.relayUrl).toBe('https://override.example.com');
    expect(config.relayHost).toBe('override.example.com');
  });

  it('a packaged production build with NO T2_RELAY_URL falls back to the real deployed acceptance relay', () => {
    const config = loadDesktopConfig({}, true);
    expect(config.relayUrl).toBe(DEFAULT_PRODUCTION_RELAY_URL);
    expect(config.relayUrl).toBe('https://relay.vincere-mortem.ru');
    expect(config.relayHost).toBe('relay.vincere-mortem.ru');
  });

  it('an UNPACKAGED run (dev, or isPackaged omitted — the safe default) with no env gets NO relay at all, never the production default', () => {
    const configOmitted = loadDesktopConfig({});
    expect(configOmitted.relayUrl).toBe('');
    const configExplicitFalse = loadDesktopConfig({}, false);
    expect(configExplicitFalse.relayUrl).toBe('');
  });

  it('test isolation is predictable: calling loadDesktopConfig(env) exactly as existing tests always have never changes behavior after this pass', () => {
    // Regression guard — this is the exact call shape every pre-existing
    // test/tool in this repo uses; it must keep defaulting to "no relay"
    // even though loadDesktopConfig now accepts a second parameter.
    const config = loadDesktopConfig({ T2_NETWORK_MODE: 'relay' });
    expect(config.relayUrl).toBe('');
    expect(config.initialNetworkMode).toBe('relay'); // mode selection is independent of relay availability
  });
});

// Item 5.D — the relay endpoint must never be able to influence the
// canonical origin's own semantics (WebAuthn RP ID / CSRF Origin / cookie
// domain all derive from publicAppOrigin, never relayUrl — see
// main/window.ts and network/relay-client.ts's separate canonicalOrigin
// param).
describe('loadDesktopConfig — relay config cannot alter canonical origin semantics', () => {
  it('publicAppOrigin is identical regardless of what T2_RELAY_URL is set to', () => {
    const withoutRelay = loadDesktopConfig({});
    const withRelay = loadDesktopConfig({ T2_RELAY_URL: 'https://relay.example.com' });
    const withPackagedDefault = loadDesktopConfig({}, true);
    expect(withoutRelay.publicAppOrigin).toBe(withRelay.publicAppOrigin);
    expect(withoutRelay.publicAppOrigin).toBe(withPackagedDefault.publicAppOrigin);
  });

  it('T2_PUBLIC_APP_ORIGIN cannot be set via T2_RELAY_URL or any relay-related value', () => {
    // No code path reads T2_RELAY_URL when resolving publicAppOrigin —
    // this documents that as a locked-in invariant, not an assumption.
    const config = loadDesktopConfig({ T2_RELAY_URL: 'https://attacker.example.com' }, true);
    expect(config.publicAppOrigin).toBe('https://tele2-app-production.up.railway.app');
  });
});
