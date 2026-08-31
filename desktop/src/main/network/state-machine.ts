/**
 * Network mode state machine (§14/§15 of the brief, extended in the
 * verification pass §5 with real forced-mode support). Deliberately
 * simple and fully injectable (probe function + timer functions) so
 * every threshold has a real test, not just an assumption — §15's "все
 * значения должны иметь разумные defaults и тесты".
 *
 * Three preferences, matching the brief's own naming (§5):
 *   AUTO        — the state diagram below.
 *   DIRECT_ONLY — probes DIRECT (honest direct/offline reporting) but
 *                 never probes or uses RELAY at all, regardless of the
 *                 DIRECT outcome. Real value: proves DIRECT genuinely
 *                 never touches relay (§33/§58), not just "usually
 *                 doesn't" — and (acceptance-hardening pass) never lies
 *                 about DIRECT being up when it isn't.
 *   RELAY       — forces RELAY (after an honest reachability check —
 *                 never lies and claims RELAY when the relay is
 *                 actually unreachable), and — unlike AUTO — does NOT
 *                 run background DIRECT-recovery probing while forced.
 *                 This is what §5/§6 need: a way to KEEP the desktop on
 *                 RELAY for a full manual/automated acceptance run
 *                 without AUTO's hysteresis silently flipping it back to
 *                 DIRECT mid-test. Not a secret bypass — it's the same
 *                 setNetworkModePreference() the UI's "Network mode"
 *                 setting already exposes (§69 of the original brief).
 *
 * AUTO state flow:
 *   START → DIRECT probe(s) → success → DIRECT
 *                            → confirmed failure (bounded retries) →
 *                              RELAY available? → RELAY
 *                                                → not available → OFFLINE
 *   While on RELAY (AUTO only): periodic background DIRECT re-checks;
 *   only returns to DIRECT after N consecutive successful checks
 *   (hysteresis) — never flips back on a single lucky probe (§15's
 *   flapping rule).
 */
import type { DiagnosticsReport, EffectiveNetworkState, NetworkModePreference as ModePreference } from './types';

export interface StateMachineConfig {
  /** Probes taken before declaring DIRECT failed (§14 "bounded retry"). */
  directFailureConfirmProbes: number;
  /** Delay between confirm-failure probes. */
  confirmProbeBackoffMs: number;
  /** Consecutive successful DIRECT probes required, while on RELAY,
   * before switching back to DIRECT (hysteresis — §15). AUTO only. */
  directRecoveryConsecutiveSuccesses: number;
  /** How often to re-probe DIRECT in the background while on RELAY. AUTO only. */
  backgroundRecheckIntervalMs: number;
}

export const DEFAULT_STATE_MACHINE_CONFIG: StateMachineConfig = {
  directFailureConfirmProbes: 3,
  confirmProbeBackoffMs: 1500,
  directRecoveryConsecutiveSuccesses: 3,
  backgroundRecheckIntervalMs: 30_000
};

export type ProbeFn = () => Promise<DiagnosticsReport>;
export type RelayAvailableFn = () => Promise<boolean>;

export interface StateMachineDeps {
  probeDirect: ProbeFn;
  isRelayAvailable: RelayAvailableFn;
  config?: Partial<StateMachineConfig>;
  /** Injectable so tests don't need real timers. */
  sleep?: (ms: number) => Promise<void>;
  setInterval?: (fn: () => void, ms: number) => { unref: () => void };
  clearInterval?: (handle: { unref: () => void }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class NetworkStateMachine {
  private readonly config: StateMachineConfig;
  private readonly probeDirect: ProbeFn;
  private readonly isRelayAvailable: RelayAvailableFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly setIntervalFn: NonNullable<StateMachineDeps['setInterval']>;
  private readonly clearIntervalFn: NonNullable<StateMachineDeps['clearInterval']>;

  private state: EffectiveNetworkState = 'checking';
  private preference: ModePreference = 'auto';
  private consecutiveDirectSuccesses = 0;
  private backgroundTimer: { unref: () => void } | null = null;
  private listeners: Array<(state: EffectiveNetworkState) => void> = [];

  constructor(deps: StateMachineDeps) {
    this.config = { ...DEFAULT_STATE_MACHINE_CONFIG, ...deps.config };
    this.probeDirect = deps.probeDirect;
    this.isRelayAvailable = deps.isRelayAvailable;
    this.sleep = deps.sleep ?? defaultSleep;
    this.setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms) as unknown as { unref: () => void });
    this.clearIntervalFn = deps.clearInterval ?? ((h) => clearInterval(h as unknown as NodeJS.Timeout));
  }

  getState(): EffectiveNetworkState {
    return this.state;
  }

  getPreference(): ModePreference {
    return this.preference;
  }

  onStateChange(cb: (state: EffectiveNetworkState) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private setState(next: EffectiveNetworkState): void {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** One DIRECT probe succeeding immediately clears the failure streak —
   * §14/NET-02: one timeout must not trigger a permanent fallback. */
  private async probeOnce(): Promise<boolean> {
    const report = await this.probeDirect();
    return report.overall === 'OK';
  }

  /** Entry point — evaluates whichever preference is currently set. */
  async start(preference: ModePreference = 'auto'): Promise<void> {
    this.preference = preference;
    await this.evaluate();
  }

  /** Changes the preference and immediately re-evaluates — this is what
   * makes DIRECT_ONLY/RELAY a real, live-switchable forced mode rather
   * than a value that's only read once at startup. */
  async setPreference(preference: ModePreference): Promise<void> {
    this.preference = preference;
    this.stopBackgroundDirectRecovery();
    await this.evaluate();
  }

  private async evaluate(): Promise<void> {
    if (this.preference === 'direct_only') {
      // Real DIRECT_ONLY (refined in the acceptance-hardening pass) —
      // runs ONE honest DIRECT probe so the reported state actually
      // reflects reality (a genuine DIRECT failure reports OFFLINE, not
      // a silent 'direct' lie), but NEVER calls isRelayAvailable() and
      // NEVER falls back to RELAY regardless of the outcome — so a
      // network-level trace (§58) still shows zero relay-bound traffic
      // by construction, not just by choice not to use what it found.
      // Deliberately a single probe, no bounded-retry confirm loop (that
      // debounce exists for AUTO's fallback DECISION, which direct_only
      // structurally never makes) — the honest DIRECT layer results are
      // still visible in lastDiagnostics either way.
      this.setState('checking');
      const ok = await this.probeOnce();
      this.setState(ok ? 'direct' : 'offline');
      return;
    }

    if (this.preference === 'relay') {
      // Forced RELAY — an honest reachability check (never claims RELAY
      // is active if it genuinely isn't reachable), then STAYS there —
      // no background DIRECT-recovery probing while forced, unlike AUTO.
      this.setState('checking');
      if (await this.isRelayAvailable()) {
        this.setState('relay');
      } else {
        this.setState('offline');
      }
      return;
    }

    await this.runAuto();
  }

  /** The original AUTO decision (§14's state diagram) — unchanged
   * behavior from before this pass's forced-mode support. */
  private async runAuto(): Promise<void> {
    this.setState('checking');
    if (await this.probeOnce()) {
      this.consecutiveDirectSuccesses = 1;
      this.setState('direct');
      return;
    }

    // Bounded retry before confirming failure — not one lucky/unlucky
    // probe deciding the whole session's transport.
    for (let i = 1; i < this.config.directFailureConfirmProbes; i++) {
      await this.sleep(this.config.confirmProbeBackoffMs);
      if (await this.probeOnce()) {
        this.setState('direct');
        return;
      }
    }

    if (await this.isRelayAvailable()) {
      this.setState('relay');
      this.startBackgroundDirectRecovery();
    } else {
      this.setState('offline');
    }
  }

  /** While on RELAY (AUTO only), periodically re-check DIRECT; only
   * switch back after N consecutive successes (hysteresis — never flip
   * on one probe). Never started for a forced 'relay' preference. */
  private startBackgroundDirectRecovery(): void {
    this.stopBackgroundDirectRecovery();
    this.consecutiveDirectSuccesses = 0;
    // Returns the tick's promise (rather than a `void`-wrapped fire-and-
    // forget) so an injected test `setInterval` can properly await one
    // full tick before the next — real Node `setInterval` callbacks
    // ignore a returned value regardless, so this changes nothing about
    // production behavior, only makes the tick awaitable where it
    // matters (tests).
    this.backgroundTimer = this.setIntervalFn(() => this.backgroundTick(), this.config.backgroundRecheckIntervalMs);
    this.backgroundTimer.unref?.();
  }

  private stopBackgroundDirectRecovery(): void {
    if (this.backgroundTimer) {
      this.clearIntervalFn(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  private async backgroundTick(): Promise<void> {
    if (this.state !== 'relay' || this.preference !== 'auto') return;
    const ok = await this.probeOnce();
    if (ok) {
      this.consecutiveDirectSuccesses += 1;
      if (this.consecutiveDirectSuccesses >= this.config.directRecoveryConsecutiveSuccesses) {
        this.stopBackgroundDirectRecovery();
        this.setState('direct');
      }
    } else {
      this.consecutiveDirectSuccesses = 0;
    }
  }

  /** Forces an immediate DIRECT probe without committing to a mode
   * switch on its own — mirrors the preload API's retryDirectConnection()
   * (§ IPC contract): "check now", not "force-switch now". No-ops
   * (still probes, but never switches state) under a forced preference —
   * probing is harmless (read-only), switching would defeat the point
   * of a forced mode. */
  async retryDirectNow(): Promise<boolean> {
    const ok = await this.probeOnce();
    if (this.preference === 'direct_only') {
      // Unlike 'relay' below, direct_only's reported state IS the probe
      // result (see evaluate()) — a manual retry should honestly reflect
      // a recovered/newly-failed DIRECT, never RELAY either way.
      this.setState(ok ? 'direct' : 'offline');
      return ok;
    }
    if (this.preference !== 'auto') return ok;
    if (ok && this.state !== 'direct') {
      this.consecutiveDirectSuccesses += 1;
      if (this.state !== 'relay' || this.consecutiveDirectSuccesses >= this.config.directRecoveryConsecutiveSuccesses) {
        this.stopBackgroundDirectRecovery();
        this.setState('direct');
      }
    }
    return ok;
  }

  dispose(): void {
    this.stopBackgroundDirectRecovery();
    this.listeners = [];
  }
}
