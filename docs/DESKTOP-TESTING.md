# Desktop Testing

## Automated

```
cd desktop && npm ci && npx tsc --noEmit && npx vitest run
cd relay && npm ci && npx tsc --noEmit && npx vitest run
cd backend && npm ci && npx tsc --noEmit && npx vitest run   # 20.54.1 regression, unchanged
```
Exact commands/results/counts for the actual run performed this pass are
in the final report, not repeated here — this file is the procedure, not
a snapshot of one run's numbers.

Test → brief-ID mapping: `desktop/tests/desktop-security.test.ts`
(DESK-*), `desktop/tests/network-state-machine.test.ts` (NET-01..04,12),
`desktop/tests/network-diagnostics.test.ts`, `desktop/tests/navigation-policy.test.ts`,
`relay/tests/relay-ssrf.test.ts` (RELAY-01,02,05-11), `relay/tests/relay-headers.test.ts`
(RELAY-03,04,17,18), `relay/tests/relay-limits.test.ts` (RELAY-12,13,14,16),
`relay/tests/relay-tls.test.ts`, `relay/tests/relay-cookies.test.ts` +
`desktop/tests/relay-cookie-integration.test.ts` (Set-Cookie distinctness).

Four tests in `relay-cookie-integration.test.ts` are `describe.skip`'d —
they require a real windowed Electron process with a live cookie store,
which this sandboxed environment cannot run headlessly (see below). They
are not deleted or faked; they're the exact procedure for a human to run
manually (or a future CI runner with a real display) to close that gap.

## Honesty levels (§72) — use exactly these five, never blend them

**IMPLEMENTED** — code exists and typechecks.
**TESTED LOCALLY** — an automated test or a manual local run actually
executed it on this machine.
**TESTED IN CI** — a CI job (including the Windows runner) actually ran it.
**TESTED ON WINDOWS** — run on a real Windows machine (this dev machine
qualifies — confirmed `win32` — but is not the same as the affected-network
case below).
**TESTED FROM AFFECTED NETWORK** — §71's real acceptance test, on a real
Windows PC on a network where the production origin is actually currently
blocked, VPN off. Not available inside this sandboxed development
environment by itself — reaching this level requires a human with access
to the actual affected hardware/network, coordinated separately from a
normal coding session. **This level HAS since been reached for the
desktop DIRECT→RELAY transport and the updater** (real DIRECT failure →
RELAY fallback → login/MFA → a real 20.56.4→20.56.5 update, all on a real
affected PC without VPN — see `docs/DESKTOP-RELEASE.md`) — that specific
result does not automatically extend to every feature added afterward.
Each new feature (e.g. the internal chat, 20.57.0) needs its own
affected-network pass before the same claim can be made for it — see
["Internal chat" below](#internal-chat-20570--a-separate-new-acceptance-item-not-a-re-run-of-71).
Do not claim "the block is fixed" or "works on all Russian networks" for
anything that hasn't itself actually reached this level.

## A real environment gotcha, worth documenting once

`ELECTRON_RUN_AS_NODE=1` was set in this session's default shell — under
it, `electron <script>` runs as plain Node with no `app`/`BrowserWindow`
available at all (silently — no error, no window, just an inert script).
Unsetting it (`env -u ELECTRON_RUN_AS_NODE` / PowerShell
`Remove-Item Env:ELECTRON_RUN_AS_NODE`) is required for any real windowed
run, dev or manual test. If a headless CI runner exhibits the same
symptom, check this first before assuming a code bug.

## Manual RELAY acceptance checklist (§Phase 8, not automated)

Run with a real relay instance (`cd relay && RELAY_UPSTREAM_ORIGIN=https://<canonical> npm run relay:dev`)
and the packaged/dev desktop app pointed at it (`T2_RELAY_URL=https://<relay>`,
or `http://127.0.0.1:<port>` for local-only testing):

1. Initial document load renders the real login screen.
2. Static assets (CSS, the 23 JS bundles) load without console errors.
3. Log in with real credentials.
4. Complete an MFA challenge (TOTP at minimum).
5. Load an authenticated page (e.g. `/me`).
6. Perform a state-changing action (verify no `csrf_mismatch`).
7. Log out.
8. Refresh the page — still logged out correctly, or still logged in if
   that's the expected state at that point.
9. Fully quit and relaunch the app — session persists correctly
   (`persist:t2-sales` partition).
10. **WebAuthn, if the test account has it enabled** — a release blocker
    for treating RELAY as production-ready with WebAuthn users. If it
    fails, try the `session.setProxy()` fallback before concluding
    WebAuthn must be unavailable in RELAY mode; never loosen RP ID/origin
    checks to work around a failure.
11. Trigger a CSV export and confirm the file downloads correctly.

Record which of these were actually run and their outcome — don't mark
this checklist "done" from a partial pass.

## RC verification pass addendum (20.55.0 release-candidate hardening)

A fourth tier, **INTEGRATION**, was added between TESTED LOCALLY and TESTED
IN CI for this pass: the real relay (`relay/src`, unmodified production
code) pointed at a real local backend instance (real `backend/src` auth/
MFA/CSRF code, a local one-off Postgres — never production), via a
local-only TLS terminator (test fixture cert + `NODE_EXTRA_CA_CERTS`) so
relay's `https://`-only upstream validation needed zero code changes.
This genuinely exercised, over HTTP through the real relay `/forward`
route (not mocked): login (phone+password) → TOTP MFA challenge → session
cookie issuance (both `t2_session`+`t2_csrf` arriving as distinct
Set-Cookie lines, including the comma-in-`Expires` case) → authenticated
`GET /me` → a CSRF-protected mutation (missing/invalid/valid token, all
three outcomes correct) → step-up ticket issuance + a privileged
step-up-gated endpoint → logout (correct cookie-clearing headers) →
re-login. This is real **INTEGRATION**-level evidence for §6 items 1-9 and
12-14 of the brief, not NOT EXECUTED — but it is still not TESTED FROM
AFFECTED NETWORK, and did not exercise the real Electron `BrowserWindow`/
`protocol.handle` transport (that part remains DESK-level unit/structural
coverage only, see `network-manager.test.ts`).

Two real, previously-undetected bugs were found this way and fixed (see
the final report's §B for exact diffs):
1. `relay/src/index.ts` — a bare `addContentTypeParser('*', ...)` does not
   override Fastify's built-in `application/json` parser, so every real
   JSON POST (every login, every mutation) reached the upstream with an
   **empty body**. Fixed with `removeAllContentTypeParsers()` first — this
   was a release blocker (nothing worked over RELAY before the fix).
2. `x-step-up-token` was missing from both the relay's and the desktop's
   request-header allowlists, so every step-up-gated privileged action
   failed closed through RELAY even with a genuinely fresh MFA ticket.
   Fail-closed, so not a security hole — but a real functional gap, now
   fixed and covered by regression tests in both packages.

## §71 real acceptance test (network-blocked scenario)

Exact procedure from the brief, for a human with access to the actual
affected hardware/network:

1. On the target Windows PC, with VPN off, open the current production
   URL in a normal browser — confirm it fails.
2. Launch `T2Sales.exe`.
3. Confirm the app's own diagnostics detect the DIRECT failure (not a
   generic hang).
4. Confirm RELAY activates automatically.
5. Log in. 6. Complete MFA. 7. Perform normal API operations.
8. Log out. 9. Restart the app — confirm state is sane.
10. Confirm no other Windows application's networking was affected by
    having run T2 Sales (e.g. Chrome/Telegram/Discord/Steam still behave
    exactly as before).

Until this specific test has actually been run and passed, do not write
"blocked networks are fixed" or "works on all Russian networks" anywhere
in release notes or announcements.

## Internal chat (20.57.0) — a separate, NEW acceptance item, not a re-run of §71

The §71 test above and the desktop updater acceptance
(`docs/DESKTOP-RELEASE.md#updates-v1--implemented-published-accepted`)
were performed **before the chat feature existed** — they prove
DIRECT→RELAY network transport and the updater work on a real
affected-network machine, nothing about chat specifically. Do not cite
either as evidence that chat works over RELAY; they are closed, unrelated
facts, not blanket coverage for every new feature added afterward.

Current status for chat, honestly per the levels above:

- **Electron DIRECT chat acceptance**: TESTED LOCALLY (manual run against
  a real backend, real send/receive/attachment round-trip) — PASS.
- **Electron RELAY chat production smoke**: **PENDING** — not yet run on
  a real affected network without VPN. Relay's REST-forwarding
  compatibility for chat's specific endpoints is proven at the
  INTEGRATION level (`relay/tests/relay-chat-acceptance.test.ts`, 5/5,
  same mocked-`forwardToUpstream` boundary as the rest of this file's
  INTEGRATION tier) — that is evidence the wiring is correct, not a
  substitute for TESTED FROM AFFECTED NETWORK. Expected behavior to
  verify on that real run: DIRECT unavailable → RELAY active → WebSocket
  connection attempt fails/times out (relay has no upgrade handler, see
  `docs/CHAT.md`) → frontend's `RealtimeTransport` falls back to bounded
  HTTP polling (`GET /chat/messages?after=`) → message send/receive and
  attachment upload/download still work over `POST /forward`, unmodified.
  Do not mark this checklist item done from a DIRECT-only pass.
