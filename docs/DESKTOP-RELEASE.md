# Desktop Release

## Versioning (§53)

Single version across `desktop/package.json`, `relay/package.json`, the
installer filename, and (via `app.getVersion()`, surfaced through
`t2Desktop.getVersion()`) the app's own about/version display — all
`20.56.0` this release, bumped together, never independently.

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
Produces `desktop/release/T2Sales-Setup-x64-20.56.0.exe` (NSIS,
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

## Updates (v1 — implemented, not yet published)

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
Not yet published to the update server this pass — see that doc's
"Publishing workflow" for the (manual, separate) next step.

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
