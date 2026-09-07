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

/** Pure — decides where the indicator lives. Exported for regression
 * coverage without needing a real DOM.
 *
 * 20.56.7: the previous approach (`position:fixed`, top offset computed
 * from `--app-header-height`) is exactly the "compensate with another
 * hard-coded top offset" pattern the redesign avoids — on a real Windows
 * machine it showed up as a displaced overlay in the content area. The
 * header's own `.header-actions` row (theme toggle / refresh icon
 * buttons, `backend/frontend/index.html`) is a stable, already-laid-out
 * location: mounting the indicator there means it participates in the
 * header's normal flex layout — never overlaps the header or content,
 * never floats at an arbitrary point, and tracks resize/DPI scaling for
 * free because it's real layout, not a computed position. The fixed
 * overlay is kept ONLY as a last-resort fallback for the (unexpected)
 * case where the header markup doesn't match, so the feature degrades
 * instead of silently disappearing. */
export function pickMountStrategy(hasHeaderActions: boolean): 'header' | 'fixed-fallback' {
  return hasHeaderActions ? 'header' : 'fixed-fallback';
}

/** Installs the overlay once the page DOM is ready. Safe to call
 * unconditionally from preload — it only activates inside this desktop
 * app (where `window.t2Desktop` exists), never affects a normal browser
 * tab loading the same production site. */
export function installNetworkStatusOverlay(api: T2DesktopAPI): void {
  const mount = () => {
    ensureVisualTokenStyle();
    const headerActions = document.querySelector('.header-actions');
    const strategy = pickMountStrategy(Boolean(headerActions));

    // Wrapper owns position:relative so the expandable detail panel can
    // anchor to IT (top:100%, right:0) instead of the viewport — a
    // popover anchored to its own trigger, not a second floating
    // coordinate to keep in sync.
    const wrapper = document.createElement('div');
    wrapper.id = 't2desktop-network-status';
    wrapper.style.cssText = 'position:relative;display:inline-flex;';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', 'Network status');
    trigger.className = 't2desktop-card';
    trigger.style.cssText =
      `width:32px;height:32px;border-radius:999px;border:none;cursor:pointer;` +
      `display:flex;align-items:center;justify-content:center;padding:0;font:11px/1 ${FONT_STACK};`;
    const dot = document.createElement('span');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#757575;display:block;';
    trigger.appendChild(dot);

    const panel = document.createElement('div');
    panel.className = 't2desktop-card';
    panel.style.cssText =
      `position:absolute;top:calc(100% + 8px);right:0;z-index:1000;display:none;` +
      `font:11px/1.4 ${FONT_STACK};padding:8px 10px;border-radius:${RADIUS_CARD};` +
      `min-width:170px;box-shadow:${SHADOW_CARD};cursor:default;user-select:text;`;

    let open = false;
    trigger.addEventListener('click', () => {
      open = !open;
      panel.style.display = open ? 'block' : 'none';
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);

    if (strategy === 'header' && headerActions) {
      headerActions.insertBefore(wrapper, headerActions.firstChild);
    } else {
      // Fallback: same fixed/header-offset placement used before
      // 20.56.7, only reached if the header markup is ever absent.
      wrapper.style.cssText += `position:fixed;top:calc(var(--app-header-height, 56px) + 8px);right:8px;z-index:2147483647;`;
      panel.style.top = 'calc(100% + 8px)';
      document.body.appendChild(wrapper);
    }

    const applyStatus = (status: NetworkStatus) => {
      const overallOutcome = status.lastDiagnostics?.overall;
      dot.style.background = OUTCOME_COLOR[overallOutcome ?? 'UNKNOWN'] ?? '#757575';
      render(panel, status);
    };

    api.getNetworkStatus().then(applyStatus);
    api.onNetworkStatusChanged(applyStatus);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
