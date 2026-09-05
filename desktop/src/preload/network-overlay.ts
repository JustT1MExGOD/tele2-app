/**
 * Sanitized network-status overlay — acceptance-prep task 6. The
 * desktop app loads the real production frontend unmodified (no shared
 * frontend source is touched by this file), so there is otherwise no
 * visible way for a field-test operator to see which transport mode is
 * active or which diagnostic layer failed. This renders a small,
 * desktop-only, collapsible badge directly from the preload script
 * (which has DOM access under contextIsolation, unlike the isolated
 * main-world context) using ONLY the already-sanitized `NetworkStatus`/
 * `DiagnosticsReport` shapes from shared/ipc-contract.ts.
 *
 * Sanitization guarantee, by construction: this file never reads
 * `document.cookie`, never touches request/response headers, and the
 * only data it renders is `NetworkStatus`/`DiagnosticsReport` fields —
 * which are themselves already limited to outcome categories
 * (OK/DNS_FAILURE/TCP_FAILURE/TLS_FAILURE/HTTP_FAILURE/TIMEOUT/OFFLINE/
 * UNKNOWN), a duration in ms, and ISO timestamps (see
 * main/network/types.ts). No cookie value, token, employee identity, or
 * full URL/query string ever passes through the t2Desktop API surface
 * this overlay consumes, so none can reach this UI either.
 */
import type { T2DesktopAPI } from '../shared/ipc-contract';
import type { NetworkStatus, LayerResult } from '../main/network/types';
import { FONT_STACK, RADIUS_CARD, SHADOW_CARD, ensureVisualTokenStyle } from './electron-visual-tokens';

const OUTCOME_COLOR: Record<string, string> = {
  OK: '#2e7d32',
  DNS_FAILURE: '#c62828',
  TCP_FAILURE: '#c62828',
  TLS_FAILURE: '#c62828',
  HTTP_FAILURE: '#c62828',
  TIMEOUT: '#ef6c00',
  OFFLINE: '#c62828',
  UNKNOWN: '#757575'
};

const RELAY_LABEL: Record<string, { text: string; color: string }> = {
  not_configured: { text: 'not configured', color: '#757575' },
  checking: { text: 'checking…', color: '#ef6c00' },
  reachable: { text: 'reachable', color: '#2e7d32' },
  unreachable: { text: 'unreachable', color: '#c62828' }
};

/** relayHost is already a validated hostname (main/config.ts derives it
 * via `new URL(relayUrl).hostname`, which cannot contain HTML-breaking
 * characters) — escaped anyway as cheap defense-in-depth since it's
 * interpolated into innerHTML. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function layerRow(layer: string, outcome: string | undefined): string {
  const color = OUTCOME_COLOR[outcome ?? 'UNKNOWN'] ?? '#757575';
  return `<div style="display:flex;justify-content:space-between;gap:8px;">
    <span>${layer}</span>
    <span style="color:${color};font-weight:600;">${outcome ?? '—'}</span>
  </div>`;
}

/** Exported for testing — pure function, only needs an object with a
 * settable `innerHTML` string, not a real DOM. */
export function render(container: { innerHTML: string }, status: NetworkStatus): void {
  const layers = status.lastDiagnostics?.layers ?? [];
  const byLayer = (name: LayerResult['layer']) => layers.find((l) => l.layer === name)?.outcome;
  const relay = RELAY_LABEL[status.lastRelayReachability] ?? RELAY_LABEL.not_configured;

  container.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">
      Mode: ${status.effective.toUpperCase()} <span style="opacity:.6;font-weight:400;">(preference: ${status.preference})</span>
    </div>
    ${layerRow('DNS', byLayer('DNS'))}
    ${layerRow('TCP', byLayer('TCP'))}
    ${layerRow('TLS', byLayer('TLS'))}
    ${layerRow('HTTP', byLayer('HTTP'))}
    <div style="display:flex;justify-content:space-between;gap:8px;">
      <span>Relay</span>
      <span style="color:${relay.color};font-weight:600;">${relay.text}</span>
    </div>
    ${status.relayHost ? `<div style="display:flex;justify-content:space-between;gap:8px;opacity:.75;">
      <span>Relay host</span>
      <span>${esc(status.relayHost)}</span>
    </div>` : ''}
    <div style="opacity:.5;font-size:10px;margin-top:4px;">updated ${status.lastChangedAt}</div>
  `;
}

/** Installs the overlay once the page DOM is ready. Safe to call
 * unconditionally from preload — it only activates inside this desktop
 * app (where `window.t2Desktop` exists), never affects a normal browser
 * tab loading the same production site. */
export function installNetworkStatusOverlay(api: T2DesktopAPI): void {
  const mount = () => {
    ensureVisualTokenStyle();
    const badge = document.createElement('div');
    badge.id = 't2desktop-network-status';
    badge.className = 't2desktop-card';
    // Not bottom:8px;right:8px — that's where the real page's own FAB
    // (.fab, right:32/bottom:32, 58x58) and update-card (bottom:8/left:8)
    // live. Also NOT a bare top:8px;right:8px (20.58 Phase 1 first
    // attempt) — Electron's minWidth:960 keeps the app always on the
    // desktop-shell breakpoint (>=860px), whose .app-header-top row
    // (avatar + theme-toggle + refresh icon buttons) sits right there,
    // confirmed colliding in Phase 2 review. Anchored just BELOW the real
    // header instead, via the same --app-header-height custom property
    // Phase 1 already exposes on document.body (core.ts, ResizeObserver) —
    // preload has real DOM/CSSOM access to the loaded page, so this value
    // is live and correct even if header height ever changes (DPI, fonts),
    // with a sane fallback for the split second before core.ts sets it.
    // Colors come from the .t2desktop-card class (electron-visual-tokens.ts)
    // — light/dark via prefers-color-scheme — everything else (position,
    // spacing, radius/shadow rhythm matching the app's own card look)
    // stays inline since it's specific to this badge's placement.
    badge.style.cssText =
      `position:fixed;top:calc(var(--app-header-height, 56px) + 8px);right:8px;z-index:2147483647;` +
      `font:11px/1.4 ${FONT_STACK};` +
      `padding:8px 10px;border-radius:${RADIUS_CARD};min-width:170px;` +
      `box-shadow:${SHADOW_CARD};cursor:pointer;user-select:none;`;
    const body = document.createElement('div');
    badge.appendChild(body);

    let collapsed = false;
    badge.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'block';
    });

    document.body.appendChild(badge);

    api.getNetworkStatus().then((status) => render(body, status));
    api.onNetworkStatusChanged((status) => render(body, status));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
