import { describe, it, expect, vi } from 'vitest';
import { NetworkStateMachine, DEFAULT_STATE_MACHINE_CONFIG } from '../src/main/network/state-machine.js';
import type { DiagnosticsReport } from '../src/main/network/types.js';

function report(overall: DiagnosticsReport['overall']): DiagnosticsReport {
  return { timestamp: new Date().toISOString(), overall, layers: [] };
}

function fakeDeps(overrides: Partial<Parameters<typeof NetworkStateMachine.prototype.constructor>[0]> = {}) {
  const intervalCallbacks: Array<() => void> = [];
  return {
    probeDirect: vi.fn().mockResolvedValue(report('OK')),
    isRelayAvailable: vi.fn().mockResolvedValue(true),
    sleep: vi.fn().mockResolvedValue(undefined),
    setInterval: vi.fn((fn: () => void) => {
      intervalCallbacks.push(fn);
      return { unref: () => {} };
    }),
    clearInterval: vi.fn(),
    _intervalCallbacks: intervalCallbacks,
    ...overrides
  };
}

describe('NetworkStateMachine — NET-01 DIRECT preferred when healthy', () => {
  it('starts in DIRECT when the first probe succeeds', async () => {
    const deps = fakeDeps();
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(sm.getState()).toBe('direct');
    expect(deps.isRelayAvailable).not.toHaveBeenCalled();
  });
});

describe('NetworkStateMachine — NET-02 one timeout does not trigger permanent fallback', () => {
  it('one failed probe followed by a success within the confirm window stays on DIRECT', async () => {
    const deps = fakeDeps({
      probeDirect: vi.fn().mockResolvedValueOnce(report('TIMEOUT')).mockResolvedValueOnce(report('OK'))
    });
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(sm.getState()).toBe('direct');
    // Never even asked whether relay is available — one blip didn't
    // trigger a fallback decision at all.
    expect(deps.isRelayAvailable).not.toHaveBeenCalled();
  });
});

describe('NetworkStateMachine — NET-03 confirmed direct failure activates RELAY', () => {
  it('after directFailureConfirmProbes consecutive failures, switches to RELAY when available', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(sm.getState()).toBe('relay');
    expect(deps.probeDirect).toHaveBeenCalledTimes(DEFAULT_STATE_MACHINE_CONFIG.directFailureConfirmProbes);
  });
});

describe('NetworkStateMachine — NET-04 relay failure returns controlled offline state', () => {
  it('goes OFFLINE, not an unhandled error, when DIRECT fails and RELAY is unavailable', async () => {
    const deps = fakeDeps({
      probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')),
      isRelayAvailable: vi.fn().mockResolvedValue(false)
    });
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(sm.getState()).toBe('offline');
  });
});

describe('NetworkStateMachine — NET-12 mode flapping prevented (hysteresis)', () => {
  it('a single successful background probe while on RELAY does not flip back to DIRECT', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(sm.getState()).toBe('relay');

    deps.probeDirect.mockResolvedValue(report('OK'));
    // Trigger exactly one background recovery tick.
    await deps._intervalCallbacks[0]?.();
    expect(sm.getState()).toBe('relay'); // still relay — one success isn't enough
  });

  it('directRecoveryConsecutiveSuccesses consecutive successful background probes DO switch back to DIRECT', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(sm.getState()).toBe('relay');

    deps.probeDirect.mockResolvedValue(report('OK'));
    for (let i = 0; i < DEFAULT_STATE_MACHINE_CONFIG.directRecoveryConsecutiveSuccesses; i++) {
      await deps._intervalCallbacks[0]?.();
    }
    expect(sm.getState()).toBe('direct');
  });

  it('a failure resets the consecutive-success counter — flapping single successes never accumulate', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start();

    // Alternate success/failure — should never accumulate toward the
    // recovery threshold since each failure resets the streak.
    for (let i = 0; i < DEFAULT_STATE_MACHINE_CONFIG.directRecoveryConsecutiveSuccesses + 2; i++) {
      deps.probeDirect.mockResolvedValueOnce(report('OK'));
      await deps._intervalCallbacks[0]?.();
      deps.probeDirect.mockResolvedValueOnce(report('TCP_FAILURE'));
      await deps._intervalCallbacks[0]?.();
    }
    expect(sm.getState()).toBe('relay');
  });
});

describe('NetworkStateMachine — every threshold has a real default and is overridable', () => {
  it('DEFAULT_STATE_MACHINE_CONFIG values are all positive, sane numbers', () => {
    expect(DEFAULT_STATE_MACHINE_CONFIG.directFailureConfirmProbes).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_STATE_MACHINE_CONFIG.confirmProbeBackoffMs).toBeGreaterThan(0);
    expect(DEFAULT_STATE_MACHINE_CONFIG.directRecoveryConsecutiveSuccesses).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_STATE_MACHINE_CONFIG.backgroundRecheckIntervalMs).toBeGreaterThan(0);
  });

  it('a custom config overrides the defaults', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')), config: { directFailureConfirmProbes: 1 } });
    const sm = new NetworkStateMachine(deps);
    await sm.start();
    expect(deps.probeDirect).toHaveBeenCalledTimes(1);
  });
});

describe('NetworkStateMachine — onStateChange/dispose', () => {
  it('notifies listeners on state transitions and stops after dispose', async () => {
    const deps = fakeDeps();
    const sm = new NetworkStateMachine(deps);
    const seen: string[] = [];
    sm.onStateChange((s) => seen.push(s));
    await sm.start();
    expect(seen).toContain('direct');
    sm.dispose();
  });
});

// §5 of the verification pass — forced modes are REAL, not just a label:
// DIRECT_ONLY never touches relay at all; forced RELAY does an honest
// reachability check and then stays there (no AUTO hysteresis silently
// overriding a test/manual RELAY run).
//
// Acceptance-hardening pass refinement: DIRECT_ONLY used to unconditionally
// claim 'direct' without ever probing — that proved zero relay traffic
// but could silently lie about DIRECT being reachable. It now runs one
// real DIRECT probe (honest direct/offline reporting) while still NEVER
// calling isRelayAvailable() or switching to relay under any outcome.
describe('NetworkStateMachine — forced DIRECT_ONLY (§5, refined in the acceptance-hardening pass)', () => {
  it('a successful DIRECT probe reports direct, and relay is never checked', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('OK')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start('direct_only');
    expect(sm.getState()).toBe('direct');
    expect(sm.getPreference()).toBe('direct_only');
    expect(deps.probeDirect).toHaveBeenCalledTimes(1);
    expect(deps.isRelayAvailable).not.toHaveBeenCalled();
  });

  it('a failed DIRECT probe (e.g. TCP timeout) reports OFFLINE, never RELAY — no fallback under direct_only', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TIMEOUT')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start('direct_only');
    expect(sm.getState()).toBe('offline');
    expect(deps.probeDirect).toHaveBeenCalledTimes(1);
    expect(deps.isRelayAvailable).not.toHaveBeenCalled();
  });

  it('switching to direct_only from an active RELAY state re-probes DIRECT and honestly reports its real outcome — no relay fallback even though it was just active', async () => {
    const deps = fakeDeps({ probeDirect: vi.fn().mockResolvedValue(report('TCP_FAILURE')) });
    const sm = new NetworkStateMachine(deps);
    await sm.start('auto');
    expect(sm.getState()).toBe('relay');
    await sm.setPreference('direct_only');
    expect(sm.getState()).toBe('offline'); // the mocked probeDirect still fails — honest, not a lie
    expect(deps.isRelayAvailable).toHaveBeenCalledTimes(1); // only from the earlier AUTO run, not again
  });

  it('retryDirectNow() under direct_only updates state honestly (recovers to direct) and never touches relay', async () => {
    const probeDirect = vi.fn().mockResolvedValueOnce(report('TCP_FAILURE')).mockResolvedValueOnce(report('OK'));
    const deps = fakeDeps({ probeDirect });
    const sm = new NetworkStateMachine(deps);
    await sm.start('direct_only');
    expect(sm.getState()).toBe('offline');
    const ok = await sm.retryDirectNow();
    expect(ok).toBe(true);
    expect(sm.getState()).toBe('direct');
    expect(deps.isRelayAvailable).not.toHaveBeenCalled();
  });
});

describe('NetworkStateMachine — forced RELAY (§5/§6)', () => {
  it('an honest reachability check runs, then stays on relay — no probeDirect call at all', async () => {
    const deps = fakeDeps();
    const sm = new NetworkStateMachine(deps);
    await sm.start('relay');
    expect(sm.getState()).toBe('relay');
    expect(sm.getPreference()).toBe('relay');
    expect(deps.isRelayAvailable).toHaveBeenCalledTimes(1);
    expect(deps.probeDirect).not.toHaveBeenCalled();
  });

  it('never lies about RELAY being active — reports OFFLINE if the relay genuinely is not reachable', async () => {
    const deps = fakeDeps({ isRelayAvailable: vi.fn().mockResolvedValue(false) });
    const sm = new NetworkStateMachine(deps);
    await sm.start('relay');
    expect(sm.getState()).toBe('offline');
  });

  it('stays on RELAY even when DIRECT would actually succeed — no AUTO-style background recovery while forced', async () => {
    const deps = fakeDeps(); // probeDirect defaults to OK
    const sm = new NetworkStateMachine(deps);
    await sm.start('relay');
    expect(sm.getState()).toBe('relay');
    // Simulate time passing / a background tick opportunity — since no
    // interval was ever registered for forced relay, there is nothing
    // to tick, which is itself the proof: AUTO's recovery mechanism
    // never engages under a forced preference.
    expect(deps.setInterval).not.toHaveBeenCalled();
  });

  it('retryDirectNow() still probes (harmless, read-only) but never switches state while forced', async () => {
    const deps = fakeDeps();
    const sm = new NetworkStateMachine(deps);
    await sm.start('relay');
    expect(sm.getState()).toBe('relay');
    const ok = await sm.retryDirectNow();
    expect(ok).toBe(true); // the probe itself still ran and reported truthfully
    expect(sm.getState()).toBe('relay'); // but the forced mode was not overridden
  });

  it('setPreference back to auto resumes real AUTO evaluation', async () => {
    const deps = fakeDeps();
    const sm = new NetworkStateMachine(deps);
    await sm.start('relay');
    expect(sm.getState()).toBe('relay');
    await sm.setPreference('auto');
    expect(sm.getPreference()).toBe('auto');
    expect(sm.getState()).toBe('direct'); // AUTO re-evaluates: probeDirect defaults to OK
  });
});
