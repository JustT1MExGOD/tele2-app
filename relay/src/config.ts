/**
 * T2 Edge Relay config — validated at startup, fail closed (same
 * discipline as backend/src/config/validate.ts). RELAY_UPSTREAM_ORIGIN
 * is server-side deployment config, never client input — no request path
 * in this service ever reads a destination from the client (see
 * forward.ts). "Compiled into the binary" is the wrong mental model —
 * this is an env var like any other production config value, equally
 * unreachable from a client request.
 */
export class RelayConfigError extends Error {}

export interface RelayConfig {
  upstreamOrigin: string;
  port: number;
  /** Railway (or whatever hosts this) terminates TLS at its edge — this
   * process listens plain HTTP behind that, same pattern as the main
   * backend. trustProxy is set to the actual hop count, never blindly
   * `true` (§35 of the brief). */
  trustProxyHops: number;
  maxHeaderBytes: number;
  maxBodyBytes: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  /** Basic per-IP throttle — relay's own abuse resistance, independent of
   * (and much simpler than) the backend's distributed account-based rate
   * limiter, which still applies unchanged to every relayed request once
   * it reaches the backend. */
  perIpRequestsPerMinute: number;
}

function assertHttpsOrigin(value: string | undefined, fieldName: string): string {
  if (!value) {
    throw new RelayConfigError(`${fieldName} is required`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RelayConfigError(`${fieldName} must be a valid absolute URL, got: ${value}`);
  }
  if (url.protocol !== 'https:') {
    throw new RelayConfigError(`${fieldName} must use https://, got: ${value}`);
  }
  return url.origin;
}

function intFromEnv(value: string | undefined, fallback: number, fieldName: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RelayConfigError(`${fieldName} must be a positive number, got: ${value}`);
  }
  return n;
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    upstreamOrigin: assertHttpsOrigin(env.RELAY_UPSTREAM_ORIGIN, 'RELAY_UPSTREAM_ORIGIN'),
    port: intFromEnv(env.PORT, 8787, 'PORT'),
    trustProxyHops: intFromEnv(env.RELAY_TRUST_PROXY_HOPS, 1, 'RELAY_TRUST_PROXY_HOPS'),
    maxHeaderBytes: intFromEnv(env.RELAY_MAX_HEADER_BYTES, 16 * 1024, 'RELAY_MAX_HEADER_BYTES'),
    maxBodyBytes: intFromEnv(env.RELAY_MAX_BODY_BYTES, 10 * 1024 * 1024, 'RELAY_MAX_BODY_BYTES'),
    requestTimeoutMs: intFromEnv(env.RELAY_REQUEST_TIMEOUT_MS, 30_000, 'RELAY_REQUEST_TIMEOUT_MS'),
    maxConcurrentRequests: intFromEnv(env.RELAY_MAX_CONCURRENT_REQUESTS, 200, 'RELAY_MAX_CONCURRENT_REQUESTS'),
    perIpRequestsPerMinute: intFromEnv(env.RELAY_PER_IP_RPM, 300, 'RELAY_PER_IP_RPM')
  };
}
