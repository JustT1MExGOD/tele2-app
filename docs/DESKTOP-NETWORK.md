# Desktop Network Layer

See [docs/ADR/desktop-network-transport.md](./ADR/desktop-network-transport.md)
for *why* this is shaped the way it is. This document is *how* it
actually works.

## Modes

```ts
enum NetworkMode { AUTO = 'auto', DIRECT = 'direct', RELAY = 'relay', WINDOWS_COMPAT = 'windows_compat' }
```
User preference (`t2Desktop.setNetworkModePreference`) defaults to
`AUTO`. Effective runtime state (`network/types.ts::EffectiveNetworkState`)
is `direct | relay | windows_compat | offline | checking` — the
distinction matters because AUTO's actual behavior can differ from the
preference at any moment.

## Relay endpoint configuration (`main/config.ts`)

The relay endpoint is resolved once, at startup, by `loadDesktopConfig()`
— the single canonical source for this value; no other file in
`desktop/` hardcodes a relay URL. Precedence:

1. **`T2_RELAY_URL` environment variable, if set** — always wins,
   regardless of build type. Accepts `https://` (any host) or
   `http://127.0.0.1`/`http://localhost` (a narrow local-dev exception,
   never applicable to a real deployment).
2. **A packaged production build with no `T2_RELAY_URL`** — falls back to
   `DEFAULT_PRODUCTION_RELAY_URL` (`https://relay.vincere-mortem.ru`), the
   real, publicly deployed T2 Edge Relay (`RELAY_UPSTREAM_ORIGIN=https://
   tele2-app-production.up.railway.app` on that deployment). "Packaged"
   means Electron's own `app.isPackaged` is `true` — a genuine installed/
   built app, not `npm run desktop:dev`.
3. **Anything else (dev mode, tests, an unpackaged run) with no
   `T2_RELAY_URL`** — no relay configured at all (`relayUrl: ''`). RELAY
   mode simply reports `not_configured`/unreachable rather than
   unexpectedly reaching out to the production relay. This is the safe
   default specifically so dev/test runs never silently depend on a real
   external service — `loadDesktopConfig(env)` called without the second
   parameter (exactly how every pre-existing test and script already
   calls it) always resolves to "no relay."

This means **the BAT-file workaround from the initial acceptance test
(`T2_RELAY_URL=https://relay.vincere-mortem.ru`) is no longer required**
for a real packaged build — it still works as an explicit override (e.g.
to point a build at a different relay for a specific test), but a stock
installer now uses the production relay automatically when DIRECT fails.

`main/config.ts` also derives `relayHost` (hostname only, via `new
URL(relayUrl).hostname`) alongside `relayUrl` — this is what the
diagnostics overlay displays; see "Sanitized diagnostics overlay" below.

## AUTO state machine (`network/state-machine.ts`)

```
START → DIRECT probe
  success → DIRECT
  failure → bounded retry (default 3 probes, 1.5s backoff)
    still failing → RELAY available? → RELAY (+ background DIRECT recheck)
                                      → not available → OFFLINE
```
While on RELAY, a background timer (default every 30s) re-probes DIRECT;
returning to DIRECT requires **3 consecutive** successful probes
(hysteresis), not one — this is what stops DIRECT↔RELAY flapping (NET-12).
Every threshold is a named constant in `DEFAULT_STATE_MACHINE_CONFIG`
with its own test in `desktop/tests/network-state-machine.test.ts`.

**`direct_only` preference** (`t2Desktop.setNetworkModePreference('direct_only')`
or `T2_NETWORK_MODE=direct_only`): runs the same single DIRECT probe and
reports the honest result (`direct` or `offline`), but **never** calls
`isRelayAvailable()` and **never** falls back to RELAY, regardless of the
outcome — a network-level trace shows zero relay-bound traffic by
construction. Use this to hard-disable RELAY entirely (see "Temporarily
disable relay" below).

**`relay` preference**: does one honest reachability check, then forces
RELAY (or `offline` if the relay genuinely isn't reachable) — no AUTO
background recovery while forced, so it won't silently flip back to
DIRECT mid-session.

## Diagnostics (`network/diagnostics.ts`)

Layered: DNS → TCP → TLS → HTTP, stopping at the first failure. HTTP is
sourced from the existing `GET /healthz` (backend/src/app.ts) — no
separate "APPLICATION" layer, since `/healthz` already is the
application's own endpoint. Outcomes are one of `OK / DNS_FAILURE /
TCP_FAILURE / TLS_FAILURE / HTTP_FAILURE / TIMEOUT / OFFLINE / UNKNOWN` —
never a claim like "DPI detected"; the UI built on top of this says
"прямое соединение недоступно," not a guessed cause.

## RELAY transport (`network/relay-client.ts` + `relay/`)

The `BrowserWindow` **never navigates to a different URL for RELAY** —
doing so would change the page's origin and break WebAuthn/cookies/CSRF.
Instead:

1. A dedicated, named, persisted session partition (`persist:t2-sales`,
   `main/window.ts`) is used for everything — never Electron's default
   session.
2. When RELAY activates, `session.protocol.handle('https', handler)` is
   registered on that session. Every `https:` request in that session
   now passes through the handler first.
3. Requests whose origin matches the canonical origin are wrapped
   (`method`/`path`/`hadOriginHeader` as headers, original body
   byte-for-byte) and POSTed to the T2 Edge Relay's `/forward` endpoint.
   The relay's real response (status/headers/body) is mirrored back
   directly as the `Response` the handler returns — no envelope on
   either side, binary-safe by construction (multipart/binary bodies
   pass through untouched, never base64/JSON-wrapped).
4. Requests to any OTHER origin (the external `telegram.org` script,
   Electron's own internal requests) are passed through via
   `session.fetch(request, { bypassCustomProtocolHandlers: true })` —
   never bare `net.fetch()`, which risks re-entering the same
   scheme-wide handler.

**Affected-network acceptance result (real hardware, no VPN):** on a
Windows PC where the production origin is genuinely blocked, the full
chain `Windows Desktop → relay.vincere-mortem.ru → Railway` was confirmed
working end-to-end:

```
DNS (production host)       OK
DIRECT TCP connect          TIMEOUT
Mode                        RELAY (preference: auto)
Relay                       reachable
Login page                  loaded
Authentication               succeeded
Authenticated home page     loaded (via relay)
```

This is real, on-hardware confirmation that AUTO correctly detects a
confirmed DIRECT failure and falls back to RELAY, and that the deployed
relay correctly proxies real authenticated traffic. This pass additionally
re-confirmed the packaged-default relay config (no `T2_RELAY_URL`, no
BAT file) resolves to `relay.vincere-mortem.ru` and is genuinely
reachable, via a real Electron process (see the acceptance-hardening
report for exact evidence/screenshots). Still not exercised: a real
WebAuthn ceremony over RELAY (see item 10 of the checklist below) and the
full Phase 8 item list beyond login/auth/home-page.

### Phase 8 acceptance checklist (for the next verification pass / manual QA)

1. Initial document load. 2. Static assets. 3. Login. 4. MFA challenge.
5. Authenticated GET. 6. State-changing POST + CSRF. 7. Logout.
8. Refresh. 9. Restart (session persists via `persist:t2-sales`).
10. **WebAuthn — a release blocker for transparent RELAY**: if it fails
    under `protocol.handle`, the `session.setProxy()` local-proxy
    fallback must be tried before accepting any functionality reduction;
    RP ID/origin verification is never loosened under any outcome.
11. Export/download paths (CSV).

## Relay server (`relay/`)

Single job: forward one wrapped request at a time to one hardcoded
upstream. See [docs/DESKTOP-SECURITY.md](./DESKTOP-SECURITY.md) for the
full security model (SSRF prevention, header allowlists, TLS, limits).

## Sanitized diagnostics overlay (`preload/network-overlay.ts`)

A small, collapsible, desktop-only badge (bottom-right corner, click to
collapse) injected by the preload script — the shared production
frontend is never modified. It shows, live: effective mode + preference,
each DNS/TCP/TLS/HTTP layer outcome, relay reachability
(`not_configured`/`checking`/`reachable`/`unreachable`), the configured
relay's **hostname only** (`Relay host: relay.vincere-mortem.ru` — never
the full URL/path/query), and a last-updated timestamp.

Sanitization is structural, not just a rendering choice: the overlay only
ever reads `NetworkStatus`/`DiagnosticsReport` fields (outcome categories,
durations, ISO timestamps, a bare hostname) — there is no code path by
which a cookie, token, `Authorization` header, CSRF value, request body,
credential, or stack trace could reach it, because the `t2Desktop` IPC
surface it consumes never carries any of those in the first place. See
`desktop/tests/network-overlay.test.ts`'s "sanitization guarantee" tests.

## Temporarily override or disable relay

- **Point at a different relay** (e.g. a staging deployment): launch with
  `T2_RELAY_URL=https://<other-relay>` — always wins over the packaged
  default.
- **Disable relay entirely** (DIRECT only, hard fail if DIRECT is down,
  never falls back): launch with `T2_NETWORK_MODE=direct_only`.
- **Force relay for testing**: launch with `T2_NETWORK_MODE=relay` (still
  honors `T2_RELAY_URL` if also set).
- These are plain environment variables — no rebuild needed. A `.bat`
  wrapper next to the installed `T2 Sales.exe` is a convenient way to set
  them for a specific test run, but is no longer required for normal use.

## Rollback

Uninstall (`Uninstall T2 Sales.exe`, or via Windows Settings → Apps) — no
system proxy/DNS/hosts/firewall state exists to roll back, since none is
ever created (`WINDOWS_COMPAT` remains a stub). Confirmed this pass: a
clean uninstall leaves 0 files, 0 services, 0 scheduled tasks, 0 firewall
rules. Reverting only the relay default (without an uninstall) is just
launching with `T2_NETWORK_MODE=direct_only` or `T2_RELAY_URL=` pointed
elsewhere — no code change needed.

## Windows networking guarantee

DIRECT and RELAY never touch `HKCU\...\Internet Settings\ProxyServer`,
WinHTTP proxy config, system DNS, hosts, routes, firewall rules, network
adapters, or any other application's settings. RELAY has no local
listening port at all (it's in-process interception, not a local proxy
process) — there is nothing for another Windows application to
accidentally discover or depend on, and nothing left running after T2
Sales closes.
