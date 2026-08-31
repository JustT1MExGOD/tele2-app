/**
 * Desktop app configuration. Everything here is public by construction —
 * §33 of the brief: an installed EXE can be decompiled, so nothing in
 * this file (or anywhere else in the desktop app) is a secret. The
 * canonical origin, relay URL, and feature flags are all values a user
 * could already see by opening dev tools on the real website.
 *
 * No DESKTOP_API_KEY / embedded admin token / hardcoded bearer token /
 * universal relay password — see §8. Real authentication is always the
 * existing server-side session/MFA flow, unaffected by this file.
 */

/**
 * The one canonical default for the packaged production build's relay
 * endpoint (acceptance-hardening pass, 20.55.x). This is the ONLY place
 * this URL is hardcoded anywhere in desktop/ — main/index.ts,
 * network/manager.ts, and preload/network-overlay.ts all receive an
 * already-resolved value through DesktopConfig, never this constant
 * directly. A real, publicly reachable T2 Edge Relay
 * (RELAY_UPSTREAM_ORIGIN=https://tele2-app-production.up.railway.app on
 * that deployment — see relay/src/config.ts), verified reachable this
 * pass. `T2_RELAY_URL` always overrides it (see loadDesktopConfig below)
 * — this is a fallback default, not a forced value.
 */
export const DEFAULT_PRODUCTION_RELAY_URL = 'https://relay.vincere-mortem.ru';

export interface DesktopConfig {
  /** Same canonical origin the backend's own MINI_APP_URL already points
   * at — the BrowserWindow navigates here directly (see main/window.ts),
   * never to a packaged copy of the frontend. */
  publicAppOrigin: string;
  /** T2 Edge Relay base URL (a separate deployment, see relay/). Only
   * used when RELAY mode is active. Resolution order: explicit
   * T2_RELAY_URL env var, then — ONLY for a packaged production build
   * (see `isPackaged` param of loadDesktopConfig) — DEFAULT_PRODUCTION_RELAY_URL,
   * then '' (no relay configured; RELAY mode simply reports unreachable). */
  relayUrl: string;
  /** Sanitized hostname-only view of `relayUrl` (or null if unset) — safe
   * to surface in the desktop-only diagnostics overlay (preload/
   * network-overlay.ts): never the full URL/path/query, just the host a
   * field-test operator would want to eyeball-confirm. Derived once here
   * so no other file re-parses relayUrl for display purposes. */
  relayHost: string | null;
  /** Windows packet-level compatibility layer — disabled by default per
   * §25/§74; ships as a Noop adapter this pass regardless of this flag
   * (see main/compat/noop-adapter.ts), so flipping this alone does not
   * enable any low-level networking code. */
  windowsCompatEnabled: boolean;
  /**
   * §5 of the verification pass — the SAME network-mode preference the
   * UI's "Network mode" setting exposes via
   * t2Desktop.setNetworkModePreference(), just readable as a startup
   * default too. Not a secret debug bypass: it's a plain, documented env
   * var, defaults to 'auto', and forcing 'relay' still runs the real
   * relay-reachability check (never lies about RELAY being active if the
   * relay genuinely isn't reachable). Exists specifically so a manual or
   * automated RELAY acceptance run can reliably start already in RELAY
   * mode, rather than racing AUTO's probing/hysteresis.
   */
  initialNetworkMode: 'auto' | 'direct_only' | 'relay';
}

/**
 * Fail-closed validation, same discipline as the backend's own
 * config/validate.ts::validateProductionConfig() — a desktop build with
 * a missing/malformed canonical origin must refuse to start, not fall
 * back to something insecure like localhost or an empty string.
 */
export class DesktopConfigError extends Error {}

/**
 * `allowLoopbackHttp` is a narrow, well-precedented exception (same
 * reasoning as RFC 8252's OAuth loopback exemption) used ONLY for
 * T2_RELAY_URL during local development against a relay instance
 * running on this machine without TLS — never applicable to
 * T2_PUBLIC_APP_ORIGIN, which is never legitimately localhost in any
 * real deployment. A real production relay is always a hosted https://
 * endpoint; this exception can never be reached by a genuine desktop
 * install talking to a genuine remote relay.
 */
function assertHttpsOrigin(value: string, fieldName: string, allowLoopbackHttp = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DesktopConfigError(`${fieldName} must be a valid absolute URL, got: ${value}`);
  }
  const isLoopbackHttp = allowLoopbackHttp && url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new DesktopConfigError(`${fieldName} must use https:// (or http://127.0.0.1 for local dev), got: ${value}`);
  }
  return url.origin;
}

/**
 * Loads and validates config. Values come from environment variables read
 * at process startup (there is no build-time config injection — a
 * packaged installer's behavior is identical regardless of the values in
 * effect when it was built; only the values in effect when it is
 * LAUNCHED matter — see docs/DESKTOP-NETWORK.md).
 *
 * `isPackaged` — pass Electron's own `app.isPackaged` from main/index.ts.
 * Defaults to `false` here specifically so that calling
 * `loadDesktopConfig(env)` from a test or a dev script without thinking
 * about this parameter can NEVER silently default to the production
 * relay — dev/test isolation is the safe default, not an opt-out.
 */
export function loadDesktopConfig(env: NodeJS.ProcessEnv = process.env, isPackaged = false): DesktopConfig {
  const publicAppOrigin = assertHttpsOrigin(
    env.T2_PUBLIC_APP_ORIGIN || 'https://tele2-app-production.up.railway.app',
    'T2_PUBLIC_APP_ORIGIN'
  );

  // Precedence (§1 of the acceptance-hardening pass): explicit
  // T2_RELAY_URL always wins; otherwise a packaged production build
  // falls back to the real deployed acceptance relay; otherwise (dev,
  // tests, an unpackaged run) no relay is configured at all — RELAY mode
  // just reports unreachable rather than reaching out to production.
  const relayUrlRaw = env.T2_RELAY_URL || (isPackaged ? DEFAULT_PRODUCTION_RELAY_URL : '');
  const relayUrl = relayUrlRaw ? assertHttpsOrigin(relayUrlRaw, 'T2_RELAY_URL', true) : '';
  const relayHost = relayUrl ? new URL(relayUrl).hostname : null;

  const windowsCompatEnabled = env.T2_WINDOWS_COMPAT_ENABLED === 'true';

  const rawMode = env.T2_NETWORK_MODE || 'auto';
  const validModes = new Set(['auto', 'direct_only', 'relay']);
  if (!validModes.has(rawMode)) {
    throw new DesktopConfigError(`T2_NETWORK_MODE must be one of auto/direct_only/relay, got: ${rawMode}`);
  }
  const initialNetworkMode = rawMode as DesktopConfig['initialNetworkMode'];

  return { publicAppOrigin, relayUrl, relayHost, windowsCompatEnabled, initialNetworkMode };
}
