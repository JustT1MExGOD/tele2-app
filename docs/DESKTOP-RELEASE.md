# Desktop Release

## Versioning (§53)

**Historical note**: §53 of the original brief called for a single
version bumped together across `desktop/package.json`,
`relay/package.json`, and the installer filename. That model did not
survive contact with real independent release cadences — `desktop/`
shipped four patch hotfixes (20.56.1 → 20.56.5) for updater-specific
fixes with zero corresponding backend/relay changes, and the backend's
20.57.0 (internal chat, release candidate) touches neither `desktop/`
nor `relay/`'s production code at all. Forcing a version bump on an
untouched package to preserve a "single number" fiction would itself be
the anti-pattern this project avoids elsewhere (never change code "just
to sync a version").

**Actual model, as of 20.57.0**: each package (`backend`, `desktop`,
`relay`) carries its own independent MAJOR.MINOR.PATCH, following the
same convention as everywhere else in this repo (MAJOR = epoch, MINOR =
feature, PATCH = hotfix) — just evaluated per package, not project-wide.
A package's version only moves when that package's own production code
changes. Current state:

| Package | Version | Why |
|---|---|---|
| `backend`/`frontend` | `20.57.0` (release candidate) | Internal employee chat — see `docs/CHAT.md`, `CHANGELOG.md` |
| `desktop` | `20.56.5` | Stable, accepted — updater P0 closed; untouched by the chat release |
| `relay` | `20.56.0` | Unchanged — chat's REST traffic passes through relay's existing `POST /forward` unmodified, proven by `relay/tests/relay-chat-acceptance.test.ts`; no relay code changed |

`app.getVersion()` / `t2Desktop.getVersion()` continue to report the
Electron app's own `desktop/package.json` version — that has not changed
and still correctly reflects what's actually installed.

## Build

```
cd desktop
npm ci
npm run desktop:package   # desktop:build (tsc + preload bundling) && electron-builder --win --x64
```
`desktop:build` runs `tsc` then bundles the compiled preload entry into a
single file via esbuild (`scripts/bundle-preload.mjs`) — Electron's
sandboxed preload cannot load multi-file `require()` output at all (found
and fixed in the acceptance-hardening pass; see `scripts/
verify-preload-sandbox.mjs` for the permanent regression check).
Produces `desktop/release/T2Sales-Setup-x64-<version>.exe` (NSIS,
per-user install, no admin required — see `desktop/electron-builder.yml`)
plus a `.blockmap` file. Compute the release SHA-256 with
`Get-FileHash -Algorithm SHA256` (PowerShell) or `sha256sum` — the exact
hash for this pass's build is in the final report, not repeated here
since it changes every build.

## Code signing (§50) — not set up this pass

No Authenticode certificate is configured. `desktop/electron-builder.yml`
has the signing config slot (`win.` block) ready for CI secrets
(`CSC_LINK`/`CSC_KEY_PASSWORD`, standard electron-builder convention) to
populate once a real certificate exists, but this pass's builds are
genuinely, verifiably unsigned (`Get-AuthenticodeSignature` → `NotSigned`
— checked, not assumed). **A production release requires signing before
distribution** — an unsigned installer will trigger SmartScreen/AV
warnings on end-user machines. The private key must never be committed
to the repository — CI secrets only, same discipline as every other
secret in this project.

## Updates (v1 — implemented, published, accepted)

A custom updater (`desktop/src/main/updater/`) checks
`https://updates.vincere-mortem.ru` — a separate control plane from both
Railway and the relay, so it keeps working even when the application
origin is affected-network-blocked. Full architecture, manifest schema,
signing policy, VPS layout, and publishing workflow:
[docs/DESKTOP-UPDATES.md](./DESKTOP-UPDATES.md). Not `electron-builder`'s
own `autoUpdater` (that mechanism was the originally-considered default
but was superseded by this custom implementation, which needed to satisfy
the "independent of Railway/relay" and "explicit user confirmation, never
silent" requirements more directly than the stock NSIS differential-update
flow does). No auto-download-and-silently-run mechanism exists — every
install requires an explicit user click (§8 of docs/DESKTOP-UPDATES.md).

**Current status**: the production stable update host is live, 20.56.5
is published on the `stable` channel, and a real production update
(20.56.4 → 20.56.5) was accepted on an affected PC through the real
stable/beta update infrastructure — the updater P0 investigation from
earlier in this desktop epoch is closed. This is a fact about the
**desktop updater specifically**, unrelated to the backend's 20.57.0
chat release candidate below — see [DESKTOP-TESTING.md](./DESKTOP-TESTING.md)
for why these two are tracked separately, not blended into one status.

## CI (§63/§64)

`.github/workflows/desktop-ci.yml` — `windows-latest`, SHA-pinned
actions, `permissions: contents: read`. Steps: install, typecheck, test,
package (unsigned), compute SHA-256, upload as a build artifact
(`t2sales-desktop-installer`) — never published/released automatically.
`.github/workflows/ci.yml` gained a second `relay` job (Linux, typecheck
+ test) — kept in the same file rather than a new workflow since it's
small and Node-only, no service containers needed.

## Deployment (relay hosting)

The T2 Edge Relay is deployed on a separate VPS at
`https://relay.vincere-mortem.ru`, configured with `RELAY_UPSTREAM_ORIGIN=
https://tele2-app-production.up.railway.app` — verified reachable
(`/healthz` → 200 OK) and, separately, confirmed to correctly proxy real
authenticated traffic during a real affected-network acceptance test (see
docs/DESKTOP-NETWORK.md). It is a real, publicly reachable service —
whoever controls that VPS/DNS record controls this deployment; this repo
does not manage or deploy it.

Packaged desktop builds now use this relay **automatically** when
`T2_RELAY_URL` is not explicitly set (see docs/DESKTOP-NETWORK.md's
"Relay endpoint configuration") — the earlier manual `.bat`-file
workaround is no longer required for normal acceptance testing, only for
overriding to a different relay.

## Rollback

- **Desktop app**: uninstalling via the NSIS uninstaller removes
  everything the installer placed — no service, no proxy, no registry
  global state, no leftover process (RELAY has no local listening port
  to clean up; it's in-process session interception, not an external
  process). A user can also simply not update — the app has no
  forced-update mechanism this pass.
- **Relay**: a fully independent deployment unit — rolling it back or
  taking it offline entirely only removes the RELAY fallback path;
  DIRECT continues to work for every user for whom it already works, and
  existing desktop installs degrade to "DIRECT or OFFLINE," never to a
  broken/insecure state (no fallback to weakened auth, no silent
  degradation of any security property).
- **Web/Telegram clients** are entirely unaffected by any of the above —
  this release touches no shared backend auth/security code (verified by
  re-running the 20.54.1 regression suite unchanged).
- **Updates**: the client never auto-downgrades (a manifest with a
  version ≤ installed is ignored); see docs/DESKTOP-UPDATES.md's own
  "Rollback" section for the full procedure.
