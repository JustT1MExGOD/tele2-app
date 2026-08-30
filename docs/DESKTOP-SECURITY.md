# Desktop Security Model

## Core principle: the desktop client is an untrusted client

Nothing about running inside `T2Sales.exe` grants privileged access.
There is no `X-Desktop-Trusted` header, no device-trust mechanism, no
`if (desktop) allow()` anywhere in `backend/src`. Every request the
desktop app makes — DIRECT or via RELAY — is authenticated and
authorized by the exact same 20.54.1 machinery (`requireActive`,
`checkPrivilegedAssurance`, CSRF, WebAuthn origin/RP checks, TOTP replay
protection, distributed rate limits) that a browser or Telegram request
goes through. This pass makes **zero changes** to `backend/src/auth/**`,
`backend/src/security/**`, or any route guard — confirmed by re-running
the full 20.54.1 auth regression suite unchanged (see the final report).

## Electron hardening (§4)

`desktop/src/main/window.ts` is the one place a `BrowserWindow` is ever
created:
```
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
```
Never `nodeIntegration:true`, `contextIsolation:false`,
`webSecurity:false`, `allowRunningInsecureContent`,
`--ignore-certificate-errors`, or the `remote` module (removed from
Electron entirely, not just left disabled). Asserted by
`desktop/tests/desktop-security.test.ts` against the real object passed
to the real `BrowserWindow` constructor (via a mocked Electron module),
not just by reading source text.

## Preload API — the only bridge (§6)

`window.t2Desktop` (`desktop/src/shared/ipc-contract.ts`) is a closed,
typed set of methods: `getVersion`, `getPlatformInfo`,
`getNetworkStatus`, `runNetworkDiagnostics`, `retryDirectConnection`,
`setNetworkModePreference`, `onNetworkStatusChanged`. No `exec`/`spawn`/
`readFile`/`writeFile`/`fetch(url)`/`openSocket`/generic
`invoke(command, args)`. The renderer — the real, unmodified T2 Sales web
app — has no Node/OS capability beyond this list.

## Navigation policy (§42/§43)

`desktop/src/main/navigation-policy.ts`: `will-navigate` and
`setWindowOpenHandler` allow only the canonical origin in-window; every
other navigation is blocked. External links go through
`shell.openExternal` only after real `new URL()` parsing confirms the
scheme is `https:` or `mailto:` — `javascript:`/`file:`/`data:`/custom
schemes are rejected, and same-origin popups never get a privileged
Electron window of their own.

## Cookies/session (§8/§39)

The session cookie stays `HttpOnly` and browser-owned. The renderer never
extracts it — there is no code path that could (contextIsolation +
sandbox + no `document.cookie` special-casing). No persistent tokens are
embedded in the installer: no `DESKTOP_API_KEY`, no embedded admin token,
no hardcoded bearer token, no universal relay password (§33 — an
installed EXE can be decompiled; nothing in it is treated as a secret).

## Telegram AAL2 (§9 of the desktop brief)

The desktop app does not automatically receive Telegram AAL2. If a
desktop session authenticates via the browser/phone login flow, the
existing browser MFA/AAL rules apply unchanged. If it ever authenticates
via a Telegram-specific flow, the existing `mfa_telegram_grants`/
`t2_tg_aal2` rules (20.53.0/20.54.1) apply exactly as they do for a
regular browser — desktop is not a new trust class.

## RELAY security model

See [docs/DESKTOP-NETWORK.md](./DESKTOP-NETWORK.md) for the mechanism.
Security properties, precisely stated (not overclaimed):

- **Not an open proxy.** The client never supplies a
  host/port/URL/scheme — only `method` + strict origin-form `path`
  (`relay/src/forward.ts::validateOriginFormPath`, rejects absolute URLs,
  protocol-relative references, CR/LF, fragments) + an allowlisted subset
  of headers + body. The upstream is always
  `RELAY_UPSTREAM_ORIGIN`, validated server-side config, re-asserted
  against the constructed request URL's origin before every forward
  (defense in depth, not trusting the path validation alone).
- **SSRF, stated precisely**: client-controlled SSRF is structurally
  prevented (no code path accepts a client-supplied destination at all).
  `RELAY_UPSTREAM_ORIGIN` itself is a trusted deployment-config boundary
  (same as any other `*_ORIGIN` value in this project), not a
  client-facing one. Defended in depth regardless: the outbound HTTPS
  agent uses a custom DNS `lookup` (`relay/src/ssrf-guard.ts`) that
  re-validates the resolved address against loopback/RFC1918/link-local/
  metadata ranges on **every connection**, not just once at startup —
  closing the DNS-rebinding gap a one-time check would leave open.
- **Two-way positive header allowlist**, not a deny-list
  (`relay/src/headers.ts`): `Host`/`Origin` are always relay-set, never
  client-supplied (`Origin` isn't even carried as a string through the
  wire protocol — the desktop sends only a boolean, the relay
  reconstructs from its own config); `Sec-Fetch-Site: same-origin` is
  always relay-set (never taken from the client), which is what lets the
  backend's existing CSRF check take its strong branch instead of the
  weaker Origin-comparison fallback; `User-Agent` is the relay's own
  fixed string, never used anywhere as an auth/trust signal;
  `Forwarded`/`X-Forwarded-*`/`X-Real-IP`/`Proxy-Authorization` are
  always stripped; `Connection`/`Transfer-Encoding`/`Content-Length` are
  hop-by-hop and always recomputed, never copied (request-smuggling
  defense).
- **Multiple `Set-Cookie` headers stay distinct** end to end — verified
  with a dedicated regression case (an `Expires` attribute containing a
  comma, alongside a simultaneous second cookie) at both the relay's own
  response construction and the desktop's protocol-handler response
  construction, using `Headers.getSetCookie()` throughout rather than
  the naive `.get()`/constructor path that would comma-corrupt them.
- **TLS**: Desktop↔Relay and Relay↔Upstream both require real,
  certificate-verified HTTPS — no `rejectUnauthorized:false`, no
  `NODE_TLS_REJECT_UNAUTHORIZED`, anywhere (enforced by a source-scan
  test in `relay/tests/relay-tls.test.ts` and
  `desktop/tests/desktop-security.test.ts`, not just by convention). The
  relay process itself listens plain HTTP behind a trusted TLS-terminating
  ingress (Railway or equivalent) — the same topology the main backend
  already uses — with `trustProxy` set to the actual hop count, never
  blindly `true`.
- **Binary-safe.** The wire protocol carries the original request/response
  bytes directly as the HTTP body (no JSON+base64 envelope), so
  multipart/binary payloads pass through unmodified.
- **Limits**: header/body size caps, request/idle timeouts, a concurrency
  cap with backpressure, and a basic per-IP throttle
  (`relay/src/limits.ts`) — independent of, and much simpler than, the
  backend's own distributed account-based rate limiting, which still
  applies unchanged to every relayed request once it reaches the backend.
- **CONNECT is never implemented** — the relay is an application HTTP
  relay, not a generic tunnel; a `connect` event on the raw server
  immediately destroys the socket.

## Threat model (§67)

| Threat | Mitigation |
|---|---|
| Compromised renderer / XSS in the loaded web app | Same CSP the web app already ships (unmodified — the desktop client doesn't loosen it); contextIsolation+sandbox mean even a compromised renderer has no Node/OS access, only the closed `t2Desktop` IPC surface |
| Reverse-engineered EXE | No secrets embedded (§33) — canonical origin/relay URL are public by construction, same as anything visible via browser dev tools |
| Malicious local user (same machine) | No elevated component ships this pass; RELAY has no local listening port to attack; session partition is a normal per-user Electron profile, same protection level as any browser profile |
| Malicious relay client (impersonating the desktop app) | The relay has no notion of desktop-client identity in this MVP — it's a structural allowlist proxy to one upstream with basic per-IP throttling; real authorization is entirely the backend's job, unaffected by who's talking to the relay |
| Compromised relay | Can see/modify relayed traffic (same blast radius as any TLS-terminating reverse proxy) but cannot reach anywhere except the one configured upstream, cannot forge a valid session without the backend's cooperation, and TLS to the upstream is still certificate-verified |
| MITM | TLS required and verified at both hops; DIRECT mode has no relay in the path at all |
| Stolen cookies | Same risk profile as a stolen browser cookie — HttpOnly/Secure/SameSite unchanged, no new exposure from the desktop client |
| Update-chain compromise | Auto-update ships disabled this pass (§49) — nothing to compromise yet; see DESKTOP-RELEASE.md |
| IPC abuse from the renderer | Closed, typed IPC surface (§6) — no generic command execution channel exists to abuse |
| SSRF via the relay | See above — structurally prevented for client input, defended in depth for the trusted upstream config |
| Windows-helper privilege escalation | N/A this pass — no elevated helper ships (WINDOWS_COMPAT is a no-op) |
| Malicious remote config | No remote-executed config exists — feature flags/relay URL are static build-time values, not fetched/executed at runtime |
