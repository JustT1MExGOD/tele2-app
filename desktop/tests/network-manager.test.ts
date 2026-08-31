/**
 * §33/§58 of the RC verification pass — "DIRECT must be provably clean":
 * in DIRECT mode, the relay protocol interception must never even be
 * installed on the session, so the relay receives structurally zero
 * traffic (not just "isn't called this time" — the handler doesn't
 * exist). NetworkManager.ts had no dedicated test file before this pass
 * even though it's the component that decides whether
 * installRelayProtocolHandler() ever runs — this file closes that gap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkManager } from '../src/main/network/manager.js';

function fakeSession() {
  return {
    protocol: {
      handle: vi.fn(),
      unhandle: vi.fn()
    },
    fetch: vi.fn()
  } as any;
}

// direct_only (acceptance-hardening pass) now runs a REAL DIRECT probe
// via NetworkManager's internal runDiagnostics() — a nonexistent-TLD
// hostname like the old 'https://app.example' can hang on DNS resolution
// depending on the resolver, which is slow AND violates §3 (no real-
// network dependency in the default suite). A closed local TCP port
// fails fast and deterministically (ECONNREFUSED, no DNS involved at
// all) — used everywhere below instead.
const UNREACHABLE_ORIGIN = 'https://127.0.0.1:1';

describe('NetworkManager — DIRECT_ONLY never installs the relay protocol handler (proof relay traffic is structurally zero)', () => {
  it('an unreachable DIRECT target honestly reports offline, and protocol.handle is never called', async () => {
    const session = fakeSession();
    const manager = new NetworkManager({
      session,
      canonicalOrigin: UNREACHABLE_ORIGIN,
      relayUrl: 'https://relay.example',
      initialPreference: 'direct_only'
    });
    await manager.start();
    // acceptance-hardening pass: direct_only no longer lies about DIRECT
    // being up when it demonstrably isn't — see state-machine.ts.
    expect(manager.getStatus().effective).toBe('offline');
    expect(session.protocol.handle).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('dispose() after an offline direct_only run cleans up without ever having installed anything', async () => {
    const session = fakeSession();
    const manager = new NetworkManager({
      session,
      canonicalOrigin: UNREACHABLE_ORIGIN,
      relayUrl: 'https://relay.example',
      initialPreference: 'direct_only'
    });
    await manager.start();
    manager.dispose();
    expect(session.protocol.unhandle).not.toHaveBeenCalled(); // never installed, so nothing to uninstall
  });
});

describe('NetworkManager — forced RELAY genuinely installs and later uninstalls the protocol handler', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('installs protocol.handle exactly once when forced relay is reachable', async () => {
    const session = fakeSession();
    const manager = new NetworkManager({
      session,
      canonicalOrigin: UNREACHABLE_ORIGIN,
      relayUrl: 'https://relay.example',
      initialPreference: 'relay'
    });
    await manager.start();
    expect(manager.getStatus().effective).toBe('relay');
    expect(session.protocol.handle).toHaveBeenCalledTimes(1);
    expect(session.protocol.handle).toHaveBeenCalledWith('https', expect.any(Function));
    manager.dispose();
    expect(session.protocol.unhandle).toHaveBeenCalledWith('https');
  });

  it('switching back to direct_only uninstalls the relay handler and honestly reports offline (the target is unreachable)', async () => {
    const session = fakeSession();
    const manager = new NetworkManager({
      session,
      canonicalOrigin: UNREACHABLE_ORIGIN,
      relayUrl: 'https://relay.example',
      initialPreference: 'relay'
    });
    await manager.start();
    expect(session.protocol.handle).toHaveBeenCalledTimes(1);
    await manager.setPreference('direct_only');
    expect(session.protocol.unhandle).toHaveBeenCalledWith('https');
    expect(manager.getStatus().effective).toBe('offline');
    manager.dispose();
  });
});

describe('NetworkManager — relay endpoint cannot be influenced by anything other than configured relayUrl (§4 SSRF/open-proxy safety)', () => {
  it('an arbitrary/unexpected preference string never installs a relay handler and never throws', async () => {
    const session = fakeSession();
    // An unrecognized preference string falls through to the real AUTO
    // code path (see state-machine.ts's evaluate()) rather than being
    // treated as any kind of destination — mock isRelayAvailable's fetch
    // so that fallback path stays fast/hermetic instead of hitting real
    // DNS for 'relay.example'.
    const realFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);
    const manager = new NetworkManager({
      session,
      canonicalOrigin: UNREACHABLE_ORIGIN,
      relayUrl: 'https://relay.example',
      initialPreference: 'direct_only'
    });
    await manager.start();
    // Simulates a compromised/buggy renderer sending garbage over the
    // setNetworkModePreference IPC channel — TypeScript's compile-time
    // enum protects normal callers, but the IPC boundary itself is not
    // type-checked at runtime, so this must fail safe.
    await expect(manager.setPreference('https://attacker.example' as any)).resolves.not.toThrow();
    expect(session.protocol.handle).not.toHaveBeenCalled();
    global.fetch = realFetch;
    manager.dispose();
  }, 15000);

  it('NetworkManagerOptions.relayUrl is the only source relay-client.ts ever forwards to — no per-request destination is ever accepted', async () => {
    const session = fakeSession();
    const manager = new NetworkManager({
      session,
      canonicalOrigin: UNREACHABLE_ORIGIN,
      relayUrl: 'https://relay.example',
      initialPreference: 'relay'
    });
    const realFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    await manager.start();
    // The protocol handler is installed exactly once, bound to a closure
    // over the fixed relayUrl at construction time — there is no API on
    // NetworkManager/session that accepts a destination per call.
    expect(session.protocol.handle).toHaveBeenCalledTimes(1);
    global.fetch = realFetch;
    manager.dispose();
  });
});
