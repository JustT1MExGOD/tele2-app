/**
 * Network mode/diagnostics types shared across main-process network
 * modules and (via the IPC contract) the renderer's t2Desktop API.
 */

export enum NetworkMode {
  AUTO = 'auto',
  DIRECT = 'direct',
  RELAY = 'relay',
  WINDOWS_COMPAT = 'windows_compat'
}

/** The mode the user has SET (a preference); effective state below is
 * what's actually happening right now, which for AUTO can differ.
 * `direct_only`/`relay` are REAL forced modes (§5 of the verification
 * pass — NetworkStateMachine actually honors them, not just AUTO with
 * extra labels), reachable through the same `setNetworkModePreference`
 * the UI's "Network mode" setting already exposes — not a secret/debug
 * bypass. */
export type NetworkModePreference = 'auto' | 'direct_only' | 'relay';

export type EffectiveNetworkState = 'direct' | 'relay' | 'windows_compat' | 'offline' | 'checking';

/**
 * Honest, evidence-based diagnostic categories (§12 of the brief) — never
 * a claim like "DPI detected". A timeout is TIMEOUT, not a theory about
 * why.
 */
export type DiagnosticOutcome =
  | 'OK'
  | 'DNS_FAILURE'
  | 'TCP_FAILURE'
  | 'TLS_FAILURE'
  | 'HTTP_FAILURE'
  | 'TIMEOUT'
  | 'OFFLINE'
  | 'UNKNOWN';

export interface LayerResult {
  layer: 'DNS' | 'TCP' | 'TLS' | 'HTTP';
  outcome: DiagnosticOutcome;
  durationMs: number;
}

export interface DiagnosticsReport {
  timestamp: string;
  overall: DiagnosticOutcome;
  layers: LayerResult[];
}

/** `null` — never checked yet, or no relay is configured for this build
 * (T2_RELAY_URL empty). `true`/`false` — the real outcome of the last
 * `GET {relayUrl}/healthz` reachability probe. Deliberately just a
 * boolean category, never the relay URL itself or any response body —
 * this is sanitized-diagnostics data, safe to render in the UI (§6 of
 * the acceptance-prep task). */
export type RelayReachability = 'not_configured' | 'reachable' | 'unreachable' | 'checking';

export interface NetworkStatus {
  effective: EffectiveNetworkState;
  preference: NetworkModePreference;
  lastDiagnostics: DiagnosticsReport | null;
  lastRelayReachability: RelayReachability;
  /** Sanitized hostname-only view of the configured relay (or `null` if
   * none configured) — see main/config.ts's `relayHost`. Never a full
   * URL, path, or query string. */
  relayHost: string | null;
  lastChangedAt: string;
}
