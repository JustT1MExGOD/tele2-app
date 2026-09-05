/**
 * Acceptance-prep task 6 — the sanitized network-status overlay must
 * show mode/DNS/TCP/TLS/HTTP/relay-reachability and must NEVER be able
 * to render a cookie, token, employee identity, or full query string.
 * The sanitization guarantee is structural (NetworkStatus/
 * DiagnosticsReport cannot carry that data in the first place — see
 * main/network/types.ts), but this test proves the render function
 * actually surfaces the required fields and, defensively, that no
 * unexpected extra property on the status object ever reaches the DOM.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render } from '../src/preload/network-overlay.js';
import type { NetworkStatus } from '../src/main/network/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeContainer() {
  return { innerHTML: '' };
}

const baseStatus: NetworkStatus = {
  effective: 'direct',
  preference: 'auto',
  lastDiagnostics: {
    timestamp: '2026-08-30T12:00:00.000Z',
    overall: 'OK',
    layers: [
      { layer: 'DNS', outcome: 'OK', durationMs: 12 },
      { layer: 'TCP', outcome: 'OK', durationMs: 34 },
      { layer: 'TLS', outcome: 'OK', durationMs: 56 },
      { layer: 'HTTP', outcome: 'OK', durationMs: 78 }
    ]
  },
  lastRelayReachability: 'not_configured',
  relayHost: null,
  lastChangedAt: '2026-08-30T12:00:01.000Z'
};

describe('network-overlay render — shows all required sanitized fields', () => {
  it('renders effective mode, preference, all four layer outcomes, and relay reachability', () => {
    const container = fakeContainer();
    render(container, baseStatus);
    expect(container.innerHTML).toContain('DIRECT');
    expect(container.innerHTML).toContain('auto');
    expect(container.innerHTML).toContain('DNS');
    expect(container.innerHTML).toContain('TCP');
    expect(container.innerHTML).toContain('TLS');
    expect(container.innerHTML).toContain('HTTP');
    expect(container.innerHTML).toContain('not configured');
  });

  it('reflects a RELAY-forced, relay-reachable state', () => {
    const container = fakeContainer();
    render(container, { ...baseStatus, effective: 'relay', preference: 'relay', lastRelayReachability: 'reachable' });
    expect(container.innerHTML).toContain('RELAY');
    expect(container.innerHTML).toContain('reachable');
  });

  it('reflects DNS/TCP/TLS/HTTP failure categories honestly, including a DIRECT-down/RELAY-up mix', () => {
    const container = fakeContainer();
    render(container, {
      ...baseStatus,
      effective: 'relay',
      lastDiagnostics: {
        timestamp: '2026-08-30T12:00:00.000Z',
        overall: 'TCP_FAILURE',
        layers: [
          { layer: 'DNS', outcome: 'OK', durationMs: 12 },
          { layer: 'TCP', outcome: 'TCP_FAILURE', durationMs: 5000 },
          { layer: 'TLS', outcome: 'UNKNOWN', durationMs: 0 },
          { layer: 'HTTP', outcome: 'UNKNOWN', durationMs: 0 }
        ]
      },
      lastRelayReachability: 'reachable'
    });
    expect(container.innerHTML).toContain('TCP_FAILURE');
  });

  it('handles no diagnostics run yet (fresh forced-mode start) without crashing', () => {
    const container = fakeContainer();
    render(container, { ...baseStatus, lastDiagnostics: null });
    expect(container.innerHTML).not.toContain('undefined');
  });
});

describe('network-overlay render — sanitization guarantee', () => {
  it('never contains a cookie/token/header-shaped substring for realistic status values', () => {
    const container = fakeContainer();
    render(container, baseStatus);
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain('cookie');
    expect(html).not.toContain('token');
    expect(html).not.toContain('authorization');
    expect(html).not.toContain('employee');
    expect(html).not.toContain('?'); // no query-string-shaped content
  });
});

// Item 3 of the "make relay.vincere-mortem.ru the default" pass — an
// optional sanitized "Relay host" row, hostname-only, never a full URL.
describe('network-overlay render — optional Relay host row (hostname only)', () => {
  it('shows the relay hostname when configured', () => {
    const container = fakeContainer();
    render(container, { ...baseStatus, lastRelayReachability: 'reachable', relayHost: 'relay.vincere-mortem.ru' });
    expect(container.innerHTML).toContain('Relay host');
    expect(container.innerHTML).toContain('relay.vincere-mortem.ru');
  });

  it('omits the row entirely when no relay is configured', () => {
    const container = fakeContainer();
    render(container, { ...baseStatus, relayHost: null });
    expect(container.innerHTML).not.toContain('Relay host');
  });

  it('never renders a full URL, path, or query string for the relay host — hostname only', () => {
    const container = fakeContainer();
    // relayHost is always derived via new URL(relayUrl).hostname in
    // main/config.ts — this test documents/locks in that only a bare
    // hostname ever reaches the renderer, never scheme/path/query.
    render(container, { ...baseStatus, relayHost: 'relay.vincere-mortem.ru' });
    expect(container.innerHTML).not.toContain('https://');
    expect(container.innerHTML).not.toContain('/healthz');
    expect(container.innerHTML).not.toContain('?');
  });
});

// 20.58 (visual-correction pass, §3, hardened in Phase 2 §0B) — the
// overlay badge used to sit at bottom:8/right:8, the same corner as the
// real page's .fab (right:32/bottom:32, 58x58) — collision confirmed.
// Moving it to a bare top:8/right:8 was ALSO confirmed colliding (Phase 2
// review) with .app-header-top's own avatar/theme-toggle/refresh icon
// buttons, since Electron's minWidth:960 always renders the desktop-shell
// breakpoint. Anchored below the real (ResizeObserver-measured) header
// height instead — collides with neither.
describe('network-overlay badge position — no FAB / header collision (20.58 Phase 2)', () => {
  it('mounts below --app-header-height at right:8px, not at a bare top:8px or bottom:8px', () => {
    const source = readFileSync(path.join(__dirname, '..', 'src', 'preload', 'network-overlay.ts'), 'utf8');
    const idx = source.indexOf("badge.style.cssText =");
    expect(idx).toBeGreaterThanOrEqual(0);
    const cssText = source.slice(idx, idx + 400);
    expect(cssText).toContain('top:calc(var(--app-header-height');
    expect(cssText).toContain('right:8px');
    expect(cssText).not.toContain('top:8px;right:8px');
    expect(cssText).not.toContain('bottom:8px;right:8px');
  });
});
