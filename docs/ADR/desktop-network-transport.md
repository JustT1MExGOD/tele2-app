# ADR: Desktop network transport — DIRECT → RELAY → optional WINDOWS_COMPAT

Status: Accepted (20.55.0). The brief asked for `docs/adr/` (lowercase);
this repo's existing ADRs live in `docs/ADR/` (uppercase), and Windows'
default case-insensitive filesystem resolved the lowercase path straight
into that same existing directory — so this file lives at
`docs/ADR/desktop-network-transport.md`, consistent with the project's
established convention, not a separate parallel directory.

## Context

Some users need the Windows desktop client to reach the T2 Sales origin
from networks where it's currently blocked, without manually managing a
VPN/proxy. The brief is explicit that the fix must not become a system
VPN/proxy/DNS-changer and must not touch other applications' networking.

## Decision: DIRECT first, application-scoped RELAY second, low-level
Windows packet adapter only if both prove insufficient

**DIRECT (default).** The Electron `BrowserWindow` navigates straight to
the real canonical HTTPS origin — the exact same page a browser would
load, unmodified networking. Preferred because it's indistinguishable
from normal browsing: no new attack surface, no new infrastructure, no
new failure mode versus what already works for browser/Telegram users.

**RELAY (fallback).** An application-scoped HTTP relay
(`relay/`), reached by intercepting network requests for the canonical
origin at the Electron session level (`session.protocol.handle`), not by
changing what origin the page believes it's on. This preserves
cookies/CSRF/WebAuthn RP-ID/origin exactly as DIRECT does — from
Chromium's perspective, RELAY and DIRECT are the same page, just
fulfilled differently underneath. Chosen over the alternatives below
because it is:

- **Application scoped** — the relay understands exactly one thing:
  forward this one app's requests to this one app's backend. It cannot be
  repurposed by anything else on the machine, unlike a system proxy.
- **No global networking modification** — no Windows proxy setting, no
  DNS change, no hosts file, no routes, no firewall rule. §23 of the
  brief is satisfied structurally, not by discipline alone: this
  mechanism has no code path that touches any of those.
- **Lower privilege** — runs entirely as a normal, non-elevated user
  process. No driver, no service, no admin rights (§29).
- **Easier maintenance** — an HTTP relay with a positive header allowlist
  and a single hardcoded upstream is a small, auditable amount of code
  compared to a packet-level compatibility layer.
- **Safer rollback** — disabling RELAY is deleting a session-level
  protocol handler registration; there is no system state to unwind.

**WINDOWS_COMPAT (not implemented this pass, ships as a Noop adapter).**
A low-level Windows packet/WFP-based adapter is the brief's own
explicitly last-resort option (§26/§74), gated on proof that DIRECT+RELAY
are genuinely insufficient — determined by the real-network acceptance
test in §71, run on an actual Windows machine on an actually-restricted
network. This environment (a sandboxed dev/CI context) cannot perform
that test: there is no physical machine here behind a real, restricted
ISP to observe a genuine DIRECT+RELAY failure against. Building the
packet-level layer without that evidence would mean guessing at a
justification the brief explicitly requires to be demonstrated, not
assumed — so `NoopWindowsCompatibilityAdapter` (`isSupported()` → `false`
always) is what ships, with the real interface (`NetworkCompatibilityAdapter`)
in place so a future, evidence-backed implementation has a clean seam to
fill, and the `DESKTOP_WINDOWS_COMPAT_ENABLED` flag defaults to `false`
regardless (flipping it alone cannot enable any low-level networking code,
because there isn't any this pass).

## Why not a generic TCP/SOCKS tunnel

A generic tunnel (SOCKS proxy, raw CONNECT-based tunnel, or a VPN-like
TUN/TAP adapter) was considered and rejected for this release:

- It would let *anything* on the machine that can be pointed at it
  reach the tunnel's destination — a fundamentally different, larger
  trust boundary than "this one app talks to this one backend."
- SSRF-safety becomes a blacklist problem (which hosts/ports are allowed
  through the tunnel) instead of the structural guarantee RELAY has
  (the client can never supply a destination at all — see
  `relay/src/forward.ts`'s strict origin-form path validation).
- It is closer in shape to the VPN/system-proxy pattern §80/§74 explicitly
  rule out for this release, even if scoped to one process technically —
  the operational and audit story is much harder to reason about.

## Consequences

- RELAY depends on `session.protocol.handle`'s per-session interception
  actually preserving cookies/CSRF/WebAuthn correctly — verified this
  pass (real Electron runtime, real production backend, both a targeted
  `protocol.handle`-only check and the app's full DIRECT boot verified
  with a screenshot; full RELAY-mode boot-to-login-screen not completed
  in this pass — see the final report for exactly what was and wasn't
  run end-to-end).
- If `protocol.handle` interception is ever found to have a limitation
  that breaks WebAuthn specifically, the documented fallback is a
  `session.setProxy()`-scoped local proxy (still application-scoped,
  still no global Windows change) — not a relaxation of WebAuthn's RP
  ID/origin checks, which stay untouched under every outcome.
