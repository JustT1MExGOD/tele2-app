# T2 Sales Desktop (current stable: 20.56.5)

A native Windows client (`T2Sales-Setup-x64-20.56.5.exe`) that loads the
existing T2 Sales web app directly — not a second frontend. See
[docs/ADR/desktop-network-transport.md](./ADR/desktop-network-transport.md)
for why the network layer is shaped DIRECT → RELAY → optional
WINDOWS_COMPAT, [docs/DESKTOP-NETWORK.md](./DESKTOP-NETWORK.md) for how
that actually works, [docs/DESKTOP-SECURITY.md](./DESKTOP-SECURITY.md)
for the security model and threat model,
[docs/DESKTOP-TESTING.md](./DESKTOP-TESTING.md) /
[docs/DESKTOP-RELEASE.md](./DESKTOP-RELEASE.md) for how to verify and
ship a build, and [docs/DESKTOP-UPDATES.md](./DESKTOP-UPDATES.md) for the
self-update mechanism (a separate `updates.vincere-mortem.ru` control
plane, independent of both the relay and Railway).

**Versioning is independent per package, not a single shared number** —
see [DESKTOP-RELEASE.md](./DESKTOP-RELEASE.md#versioning) for why and for
each package's current version. Desktop's own updater (below) is closed
and stable at 20.56.5 regardless of what version the backend is on.

**Not to be confused with** `docs/DESKTOP-DESIGN.md`/
`docs/DESKTOP-UX-AUDIT.md` — those are about the existing responsive web
layout (sidebar/topbar at wide browser viewports, shipped in 20.40),
an unrelated older use of the word "desktop." This document and its
siblings are about the native Windows app.

## Architecture

```
T2Sales.exe
│
├── Main process (desktop/src/main/index.ts)
│   ├── single-instance lock
│   ├── hardened BrowserWindow (window.ts)
│   ├── navigation allowlist (navigation-policy.ts)
│   └── NetworkManager (network/manager.ts)
│         ├── NetworkDiagnosticsService (network/diagnostics.ts)
│         ├── NetworkStateMachine — AUTO (network/state-machine.ts)
│         ├── DIRECT (network/direct.ts — Electron's unmodified networking)
│         ├── RELAY client (network/relay-client.ts — protocol.handle interception)
│         └── NoopWindowsCompatibilityAdapter (compat/noop-adapter.ts)
│   └── UpdateManager (updater/manager.ts) — separate control plane,
│         talks directly to updates.vincere-mortem.ru, never via relay
│
├── Preload (desktop/src/preload/index.ts)
│   └── contextBridge → window.t2Desktop (typed, minimal — shared/ipc-contract.ts)
│
└── Renderer = the real production frontend, unmodified
      (BrowserWindow.loadURL(canonical origin) — no packaged copy)

T2 Edge Relay (relay/) — separate deployable Fastify service, used only
when RELAY mode is active. See DESKTOP-NETWORK.md.
```

## Why Electron

The brief asked for Electron if security/runtime requirements are met
(§4), and this project's frontend is already a plain browser app served
by the existing Fastify backend — Electron's `BrowserWindow` navigating
to the real origin costs nothing extra (no packaging, no duplication),
which is exactly the "reuse the existing frontend" requirement (§5).
WebView2/Tauri were not pursued: WebView2 would add a runtime dependency
this design doesn't need (Electron bundles its own Chromium), and Tauri
would mean rewriting the frontend's IPC/native-bridge layer for no
architectural benefit here.

## Development

```
cd desktop
npm ci
npm run desktop:typecheck
npm run desktop:test
npm run desktop:dev       # builds + launches a real window
npm run desktop:package   # produces the unsigned NSIS installer
```

**Environment note**: some sandboxed/CI shells set `ELECTRON_RUN_AS_NODE=1`,
which makes `electron <script>` run as plain Node (no `app`/
`BrowserWindow`, no window ever appears) — a real, common gotcha, not an
app bug. Unset it (`env -u ELECTRON_RUN_AS_NODE`, or check `Remove-Item
Env:ELECTRON_RUN_AS_NODE` in PowerShell) before running `desktop:dev` if
nothing appears to happen.

Config is read from environment variables at runtime (dev) / build time
(packaged) — see `desktop/src/main/config.ts`:
- `T2_PUBLIC_APP_ORIGIN` — the canonical origin (defaults to production).
- `T2_RELAY_URL` — the T2 Edge Relay's base URL (must be `https://`,
  except `http://127.0.0.1`/`localhost` which is allowed only for local
  dev against a relay running on the same machine — see config.ts's
  comment for why that narrow exception is safe).
- `T2_WINDOWS_COMPAT_ENABLED` — `true`/`false`, default `false`; has no
  effect this pass regardless (see the ADR).
- `T2_UPDATE_BASE_URL` / `T2_UPDATE_CHANNEL` — the update server and
  channel (`stable`/`beta`); see [docs/DESKTOP-UPDATES.md](./DESKTOP-UPDATES.md).
