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

**Verified this pass** (real Electron runtime on Windows, real
production backend, a standalone script isolating just this mechanism —
see the final report for exact evidence): a request to a deliberately
unreachable fake origin was correctly intercepted and relayed to the real
backend, returning the real `/healthz` response; a request to an
unrelated real origin correctly passed through untouched. Full
RELAY-mode boot-to-login-screen (the complete Phase 8 acceptance
checklist below) was not completed end-to-end this pass — see
DESKTOP-TESTING.md and the final report for exactly what remains.

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

## Windows networking guarantee

DIRECT and RELAY never touch `HKCU\...\Internet Settings\ProxyServer`,
WinHTTP proxy config, system DNS, hosts, routes, firewall rules, network
adapters, or any other application's settings. RELAY has no local
listening port at all (it's in-process interception, not a local proxy
process) — there is nothing for another Windows application to
accidentally discover or depend on, and nothing left running after T2
Sales closes.
