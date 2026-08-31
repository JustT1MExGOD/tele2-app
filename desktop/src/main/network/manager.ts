/**
 * NetworkManager — the façade the main process (index.ts) and IPC
 * handlers talk to. Wires diagnostics + state machine + relay-client +
 * compat adapter together, tracks the effective NetworkStatus, and
 * exposes the operations the preload API needs.
 */
import type { Session } from 'electron';
import { runDiagnostics } from './diagnostics';
import { NetworkStateMachine } from './state-machine';
import { installRelayProtocolHandler, uninstallRelayProtocolHandler } from './relay-client';
import { NoopWindowsCompatibilityAdapter } from '../compat/noop-adapter';
import type { DiagnosticsReport, NetworkModePreference, NetworkStatus, RelayReachability } from './types';
import { logger } from '../logging';

export interface NetworkManagerOptions {
  session: Session;
  canonicalOrigin: string;
  relayUrl: string;
  /** Sanitized hostname-only view of relayUrl, for the diagnostics
   * overlay — see main/config.ts's `relayHost`. */
  relayHost?: string | null;
  /** Initial preference — defaults to 'auto'. §5 of the verification
   * pass: lets a test harness force 'relay' or 'direct_only' from
   * process startup (e.g. via T2_NETWORK_MODE env var wired in
   * index.ts), not just after the fact via setPreference(). */
  initialPreference?: NetworkModePreference;
}

export class NetworkManager {
  private readonly session: Session;
  private readonly canonicalOrigin: string;
  private readonly relayUrl: string;
  private readonly relayHost: string | null;
  private readonly compat = new NoopWindowsCompatibilityAdapter();
  private readonly stateMachine: NetworkStateMachine;
  private lastDiagnostics: DiagnosticsReport | null = null;
  private lastRelayReachability: RelayReachability = 'not_configured';
  private lastChangedAt = new Date().toISOString();
  private relayInstalled = false;
  private listeners: Array<(status: NetworkStatus) => void> = [];
  private readonly initialPreference: NetworkModePreference;

  constructor(options: NetworkManagerOptions) {
    this.session = options.session;
    this.canonicalOrigin = options.canonicalOrigin;
    this.relayUrl = options.relayUrl;
    this.relayHost = options.relayHost ?? null;
    this.initialPreference = options.initialPreference ?? 'auto';

    this.stateMachine = new NetworkStateMachine({
      probeDirect: async () => {
        const report = await runDiagnostics(this.canonicalOrigin);
        this.lastDiagnostics = report;
        return report;
      },
      isRelayAvailable: async () => {
        if (!this.relayUrl) {
          this.lastRelayReachability = 'not_configured';
          return false;
        }
        this.lastRelayReachability = 'checking';
        try {
          const res = await fetch(new URL('/healthz', this.relayUrl).toString(), { signal: AbortSignal.timeout(5000) });
          this.lastRelayReachability = res.ok ? 'reachable' : 'unreachable';
          return res.ok;
        } catch {
          this.lastRelayReachability = 'unreachable';
          return false;
        }
      }
    });

    this.stateMachine.onStateChange((state) => {
      this.lastChangedAt = new Date().toISOString();
      if (state === 'relay') {
        this.ensureRelayInstalled();
      } else if (this.relayInstalled) {
        uninstallRelayProtocolHandler(this.session);
        this.relayInstalled = false;
      }
      logger.info('network_mode_changed', { mode: state });
      this.emitStatus();
    });
  }

  private ensureRelayInstalled(): void {
    if (this.relayInstalled) return;
    installRelayProtocolHandler({ session: this.session, canonicalOrigin: this.canonicalOrigin, relayUrl: this.relayUrl });
    this.relayInstalled = true;
  }

  /** Must complete BEFORE the first navigation (see main/index.ts) —
   * whichever mode this decides (including a forced preference) is what
   * the very first page load should already use. */
  async start(): Promise<void> {
    await this.stateMachine.start(this.initialPreference);
  }

  getStatus(): NetworkStatus {
    return {
      effective: this.stateMachine.getState(),
      preference: this.stateMachine.getPreference(),
      lastDiagnostics: this.lastDiagnostics,
      lastRelayReachability: this.lastRelayReachability,
      relayHost: this.relayHost,
      lastChangedAt: this.lastChangedAt
    };
  }

  async runDiagnosticsNow(): Promise<DiagnosticsReport> {
    const report = await runDiagnostics(this.canonicalOrigin);
    this.lastDiagnostics = report;
    return report;
  }

  async retryDirect(): Promise<void> {
    await this.stateMachine.retryDirectNow();
    this.emitStatus();
  }

  /**
   * §5 of the verification pass — this now REALLY forces the mode
   * (via NetworkStateMachine.setPreference(), see state-machine.ts),
   * not just a UI-facing label as before. 'direct_only' probes DIRECT
   * for honest state reporting (direct/offline) but NEVER installs the
   * relay handler or even checks relay reachability, regardless of the
   * probe's outcome (§ acceptance-hardening pass); 'relay' does an
   * honest reachability check and then stays on RELAY without AUTO's
   * background-recovery probing overriding it mid-test.
   */
  async setPreference(mode: NetworkModePreference): Promise<void> {
    await this.stateMachine.setPreference(mode);
    this.emitStatus();
  }

  onStatusChanged(cb: (status: NetworkStatus) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const l of this.listeners) l(status);
  }

  dispose(): void {
    this.stateMachine.dispose();
    if (this.relayInstalled) {
      uninstallRelayProtocolHandler(this.session);
      this.relayInstalled = false;
    }
  }
}
