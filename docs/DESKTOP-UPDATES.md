# Desktop Updates

## Architecture

```
T2 Sales Desktop (main process, updater/manager.ts)
   |
   | HTTPS, direct — NEVER routed through relay.vincere-mortem.ru
   v
https://updates.vincere-mortem.ru   (separate VPS virtual host, static files only)
   |
   +-- /stable/manifest.json
   +-- /beta/manifest.json
   +-- /releases/<installer>.exe
```

**Deliberately a separate control plane from both the application origin
(Railway) and the relay** (see docs/DESKTOP-NETWORK.md). The entire reason
a relay exists is that Railway can become unreachable on an affected
network — if the updater depended on Railway (directly or via the relay)
to fetch itself out of that situation, an affected-network user would be
stuck exactly when they'd most want a fix. `updates.vincere-mortem.ru` is
a separate virtual host on the same VPS as the relay, serving static
files only (no application logic, no `/forward` endpoint, nothing that
resembles the relay's proxy behavior) — see "VPS static layout" below.

Everything updater-related lives in `desktop/src/main/updater/`:

| File | Responsibility |
|---|---|
| `version.ts` | Numeric MAJOR.MINOR.PATCH comparison (never string comparison) |
| `manifest.ts` | Manifest schema + strict validation |
| `fetch-manifest.ts` | Fetches + validates one channel's manifest.json |
| `downloader.ts` | Streams + verifies (size, SHA-256) one installer to disk |
| `signature.ts` | Authenticode verification + signing policy |
| `install-launcher.ts` | Launches the verified installer (`shell.openPath()` — no shell/command-line boundary at all, exact-filename-pin regex, fail-closed TOCTOU re-verification just before launch) |
| `manager.ts` | `UpdateManager` — orchestrates check/download/install, owns state |

`main/config.ts::loadDesktopConfig()` is the single canonical source for
`updateBaseUrl`/`updateChannel` (same file, same precedence pattern, as
the relay config — see docs/DESKTOP-NETWORK.md).

## Update channels

Two channels: `stable` (default) and `beta`. A manifest's own `channel`
field must match the channel it was fetched under — `/stable/manifest.json`
claiming `channel: "beta"` is rejected as invalid, not silently trusted.

## Config precedence

```
1. explicit env (T2_UPDATE_BASE_URL / T2_UPDATE_CHANNEL) — always wins
2. packaged production build, no env         — DEFAULT_PRODUCTION_UPDATE_BASE_URL
                                                 (https://updates.vincere-mortem.ru), stable
3. dev/test/unpackaged, no env                — updateBaseUrl: '' (checking disabled entirely)
```

`isPackaged` is Electron's own `app.isPackaged` — a genuine installed
build, not `npm run desktop:dev`. `loadDesktopConfig(env)` called without
the second parameter (exactly how every existing test/script already
calls it) can never silently reach the production update server — this
is the same safety property the relay config already has, applied here
too.

```bat
:: dev/acceptance override example
set T2_UPDATE_BASE_URL=https://staging-updates.example.com
set T2_UPDATE_CHANNEL=beta
```

`T2_UPDATE_BASE_URL` accepts `https://` (any host) or `http://127.0.0.1`/
`http://localhost` (narrow local-dev exception, same as `T2_RELAY_URL`).

## Manifest schema

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "20.55.1",
  "publishedAt": "2026-08-31T12:00:00Z",
  "mandatory": false,
  "installer": {
    "filename": "T2Sales-Setup-x64-20.55.1.exe",
    "url": "https://updates.vincere-mortem.ru/releases/T2Sales-Setup-x64-20.55.1.exe",
    "sha256": "<64 hex chars>",
    "size": 123456789
  },
  "releaseNotes": "optional, plain text, max 8000 chars",
  "minSupportedVersion": "optional, X.Y.Z"
}
```

**`minSupportedVersion` is informational only in v1** — it is schema-
validated (must parse as MAJOR.MINOR.PATCH) but nothing in
`UpdateManager` currently reads or enforces it. No client behavior
changes based on its value: there is no forced-update path, no blocked
version, no warning surfaced from it. It exists in the schema now so a
future version can add enforcement without a breaking manifest schema
change; until then, treat it as a note to publishers, not a mechanism.

Validated strictly (`main/updater/manifest.ts::validateManifest`), fail
closed on anything unexpected:

- `schemaVersion` must be exactly `1`.
- `channel` must match the channel the manifest was fetched under.
- `version`/`minSupportedVersion` must parse as MAJOR.MINOR.PATCH.
- `publishedAt` must be a parseable date.
- `installer.filename` must match `^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$` — no
  path separators, no `..`.
- `installer.url` must be `https://`, on the exact configured update
  origin (not just "https", the literal origin), under `/releases/`, and
  its filename segment must equal `installer.filename` exactly.
- `installer.sha256` must be 64 hex characters.
- `installer.size` must be a positive integer ≤ 500 MiB.

**Never present, structurally**: any executable command/arguments, any
local filesystem path, any field that could influence what runs or
where. The TypeScript type this validator returns has no slot for such a
field — there is no code path that could read one even if a manifest
somehow contained it (see the explicit regression test in
`tests/updater-manifest.test.ts` proving an injected `command`/`args`
field is silently dropped, never reaches the returned object).

## Update check

- One check ~15s after startup (never blocks boot/login).
- Then every 4 hours (not aggressive polling).
- Plus a manual "Проверить обновления" trigger (`checkForUpdates()` IPC).
- Bounded timeouts throughout (manifest fetch: 10s, download: 120s).
- **If the update server is unreachable** (DNS/TCP/TLS/HTTP failure): the
  check lands in `state: 'error'` with a short sanitized message. The
  main application is completely unaffected — DIRECT/RELAY transport,
  login, and every application feature work exactly as if the updater
  didn't exist. There is no blocking dialog, no retry-storm (the next
  attempt is the normal 4-hour interval or a manual click), no crash.

## Download + SHA-256 verification flow

1. `installer.url` re-validated against the allowlisted update origin
   AGAIN at download time (defense in depth beyond manifest validation).
2. HTTPS only, real TLS verification (Node's `https` default,
   `rejectUnauthorized` never overridden). No automatic redirect
   following — a 3xx response is a hard failure.
3. Streamed to `%LOCALAPPDATA%\T2 Sales\updates\<filename>.<random>.download`
   — never buffered fully in memory. SHA-256 computed incrementally
   alongside the write.
4. `Content-Length` (if present) checked against `manifest.installer.size`
   before any body is read; actual received bytes checked against the
   same cap DURING streaming (aborts mid-flight on overflow, not just
   after the fact) — a hard ceiling against an oversized/runaway
   response.
5. On stream completion: actual byte count AND SHA-256 both re-verified
   (`crypto.timingSafeEqual` for the hash compare) against the manifest.
6. **Only on success**: the temp file is renamed (atomic, same volume) to
   the final `T2Sales-Setup-x64-X.Y.Z.exe` name. On ANY mismatch, the
   temp file is deleted and nothing is ever renamed into a runnable
   location — state becomes `'error'`, never `'ready_to_install'`.

## TOCTOU: re-verification immediately before launch

`ready_to_install` has no timeout — the app waits on an explicit human
click, an unbounded window during which a local process with write
access to `%LOCALAPPDATA%\T2 Sales\updates\` could in principle swap the
verified file for something else. `installUpdate()` closes this gap by
re-running BOTH checks against the file as it exists at the moment of the
click, not trusting the result from download time:

1. Size + SHA-256 re-verified against the manifest (`downloader.ts`'s
   `verifyFileIntegrity`, the same streaming-hash/`timingSafeEqual`
   technique used at download time, run again against the on-disk file).
2. Authenticode status + policy re-evaluated (same `signature.ts`
   functions used at download time).

Either check failing aborts the install (state → `'error'`, the tracked
`downloadedFilePath` is cleared) — the installer is never launched. A
duplicate `installUpdate()` call (double-click, a racing second IPC
invocation) is a no-op while a launch is already in flight — the
installer is never started twice.

## Authenticode signing policy

- SHA-256 verification is **always** required, regardless of signing
  status (step 5 above) — this never changes.
- If the downloaded installer is Authenticode-signed
  (`Get-AuthenticodeSignature` via a PowerShell helper — no Node API for
  this — `main/updater/signature.ts`), its status/signer are checked and
  the signer subject is available for display/logging (a certificate
  subject is not a secret).
- **v1 policy: both `stable` and `beta` allow an unsigned installer**
  (`AUTHENTICODE_POLICY = { stable: 'warn', beta: 'warn' }` in
  `signature.ts`) — because no real code-signing certificate exists yet
  for any channel (see docs/DESKTOP-RELEASE.md's signing section). An
  unsigned installer still requires a correct SHA-256 match; the UI shows
  a visible warning ("This update is not digitally signed…") before the
  user clicks Install.
- **Exact meaning of "warn" — genuinely unsigned vs. broken signature are
  NOT the same thing, and are not treated the same.** `warn` is lenient
  only for `status === 'NotSigned'` — a file with no Authenticode
  signature block at all, which is the expected shape of every build
  today. A file whose status is `HashMismatch`, `NotTrusted`, `Invalid`,
  or `UnknownError` — i.e. one that DOES carry a signature block (or
  whose check itself failed to run) but fails verification — is **always
  rejected**, on both channels, regardless of the `warn`/`required`
  policy value. Accepting a broken-signature file under `warn` would
  defeat the point of checking at all: it's a strictly worse signal than
  having no signature claim in the first place, and `HashMismatch`
  specifically is the exact shape of a file tampered with after signing.
- **Once a real certificate exists**: flip `AUTHENTICODE_POLICY.stable`
  to `'required'` — this is the one named, documented place to do it.
  `beta` can stay `'warn'` for internal testing builds indefinitely, or
  also be flipped, at the product owner's discretion.
- Windows security is never bypassed: no SmartScreen suppression, no
  Defender changes, no `-ExecutionPolicy` change beyond the single
  PowerShell subprocess invocation used for signature *reading* (never
  execution of untrusted code).

## IPC / security boundaries

Renderer-facing API (`window.t2Desktop`, via preload) is exactly 5
methods, all parameterless:

```ts
checkForUpdates(): Promise<void>
getUpdateStatus(): Promise<UpdateStatus>
downloadUpdate(): Promise<void>
installUpdate(): Promise<void>
onUpdateStatusChanged(cb): () => void
```

No channel accepts a URL, file path, or command from the renderer — what
gets checked/downloaded/installed is entirely `UpdateManager`'s own
internal state. `installUpdate()` always launches exactly the file this
process itself downloaded and SHA-256-verified; there is no parameter
through which a caller (compromised renderer or otherwise) could redirect
it. `contextIsolation`/`nodeIntegration`/`sandbox` are unchanged (still
`true`/`false`/`true`) — the updater adds no new preload capability
beyond these 5 named methods.

The updater has **no access whatsoever** to session cookies, CSRF tokens,
TOTP secrets, Telegram auth, or any application credential — it is a
completely separate code path (`updater/*`) that never imports or shares
state with `network/relay-client.ts` or any auth-related module. It
talks to a different host entirely (`updates.vincere-mortem.ru`, never
`relay.vincere-mortem.ru` or the Railway origin).

## Installation (v1 policy)

- Install only after: manifest validation → HTTPS download → size
  verification → SHA-256 verification → signature policy check →
  **explicit user click** on "Установить сейчас".
- No silent install, ever, in v1 — the real NSIS installer UI always
  runs (`shell.openPath(installerPath)`, no arguments passed at all —
  v1 never builds a command line from manifest data, see
  `install-launcher.ts`'s own module doc comment for the full traced
  origin/security reasoning).
- `mandatory: true` in v1: shown with a visible "ВАЖНОЕ ОБНОВЛЕНИЕ" badge
  in the UI, nothing more — no force-install, no force-kill of the
  running app, no blocking the rest of the UI. A future version may
  change this policy explicitly; v1 does not.
- After the user confirms install: the installer is launched detached
  (`unref()`d — the desktop app does not wait for it), then the app
  quits itself ~1.5s later (giving the installer window time to appear)
  so it isn't holding file locks the installer needs.

## VPS static layout

```
/var/www/t2-updates/
  stable/
    manifest.json
  beta/
    manifest.json
  releases/
    T2Sales-Setup-x64-20.55.0.exe
    T2Sales-Setup-x64-20.55.1.exe
    T2Sales-Setup-x64-20.56.0-beta.1.exe
```

**Historical note**: this layout/Caddy config was originally written as
documentation/templates only, not yet deployed. It has since been
deployed for real — the production `stable` update host is live,
20.56.5 is published on it, and a real production update (20.56.4 →
20.56.5) was accepted on an affected PC through this exact
infrastructure (see `docs/DESKTOP-RELEASE.md#updates-v1--implemented-published-accepted`).
The layout/Caddy example below still documents the real, current
structure — kept as-is, not a stale claim about deployment status.

### Caddy example

```
updates.vincere-mortem.ru {
    root * /var/www/t2-updates
    file_server {
        # Directory listing MUST stay disabled — file_server's default
        # is already "no listing" as long as browse is not enabled;
        # never add `browse` to this block.
    }

    header /*/manifest.json Content-Type "application/json"
    header /*/manifest.json Cache-Control "no-cache"
    header /releases/* Content-Type "application/octet-stream"
    header /releases/* Cache-Control "public, max-age=31536000, immutable"
}
```

Recommendations:
- **HTTPS only** — Caddy's automatic HTTPS already gives this by default;
  do not add a plaintext `http://` site block for this host.
- **Directory listing disabled** — confirmed above; double-check after
  any Caddy config change (a bare `file_server` is safe, `file_server
  browse` is not).
- **manifest.json**: `Content-Type: application/json`, short/no-cache TTL
  — clients must see a just-published version promptly.
- **Installers**: `Content-Type: application/octet-stream`, long/immutable
  cache TTL is safe **because filenames are versioned** (a given filename
  never changes content once published — never overwrite an already-
  published installer file; publish a new filename instead).
- **No upload capability through this virtual host, ever** — `file_server`
  is read-only by construction (no PUT/POST handling configured); do not
  add one. Publishing is done via the operator's own deploy access to the
  VPS (SSH/SCP/rsync), never through the public HTTPS endpoint.

## Publishing workflow

```bash
cd desktop
npm run update:prepare -- --channel beta --installer path/to/T2Sales-Setup-x64-20.55.1.exe \
  --notes "Bug fixes" [--mandatory] [--min-supported 20.50.0]
```

What it does:
1. Reads the installer, computes SHA-256 (streaming) + size.
2. Derives `version` from the filename (`T2Sales-Setup-x64-X.Y.Z.exe`) or
   requires `--version` explicitly if the filename doesn't match.
3. Writes `desktop/update-staging/<channel>/manifest.json` and copies the
   installer to `desktop/update-staging/releases/<filename>`.

What it deliberately does **not** do:
- SSH/SCP/rsync/deploy anywhere — zero network access.
- Store or read any VPS credential.
- Touch a live/published manifest — it only ever writes to the local
  `update-staging/` directory (gitignored).

**Actual publishing is a separate, manual, explicitly-opted-into step**:
copy `update-staging/<channel>/manifest.json` to the VPS's
`<channel>/manifest.json`, and `update-staging/releases/<file>` to the
VPS's `releases/<file>`, via whatever deploy access the operator already
uses (SSH/SCP/rsync/Ansible/etc.) — this repo does not script that step.

## Beta → stable promotion

Once a beta build has been validated:
1. Re-run `update:prepare` with `--channel stable` against the SAME
   installer file (or re-publish; the installer itself doesn't change,
   only which channel's manifest points at it).
2. Copy the resulting `stable/manifest.json` to the VPS.
3. Stable-channel clients pick it up on their next check (≤4 hours, or
   immediately via "Проверить обновления").

There is no automatic beta→stable promotion — every promotion is a
deliberate publish of a new `stable/manifest.json`.

## Rollback

- The server should retain several previous installer files under
  `/releases/` (never delete a version another client might still be
  mid-download of, or might need to reference).
- **The desktop client never automatically downgrades** — `isNewerVersion()`
  only ever returns true for a strictly newer version; a manifest with a
  version ≤ the currently-installed one is simply ignored by the ordinary
  update check (`state` stays `'up_to_date'`).
- Rolling back in practice means either:
  a. Publishing a new PATCH version whose contents restore the desired
     behavior (the normal, recommended path — matches "roll forward, not
     back" for every other part of this project), or
  b. A manual admin action: overwrite `<channel>/manifest.json` to point
     back at an older, already-retained installer's filename/hash. This
     is an explicit, human decision — never something a client update
     check or `update:prepare` does on its own.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App never shows "update available" | Check `T2_UPDATE_BASE_URL`/`T2_UPDATE_CHANNEL` env, confirm `app.isPackaged` is true (dev builds never check), confirm the manifest's `version` is actually newer |
| "Ошибка обновления" right after check | Update server unreachable/DNS/TLS — the app itself is unaffected; check `updates.vincere-mortem.ru` connectivity independently of the relay |
| Download fails with a hash/size error | The published manifest's `sha256`/`size` doesn't match the actual file on `/releases/` — re-run `update:prepare` and republish both together, never edit one without the other |
| "not digitally signed" warning | Expected in v1 for every channel — see signing policy above; not an error |
| Update never installs | v1 requires an explicit click on "Установить сейчас" — there is no silent/automatic install by design |

## Offline / update-server-unreachable behavior

Explicitly verified (`tests/updater-manager.test.ts`): a failed manifest
fetch (DNS/TCP/TLS/HTTP, any reason) lands in `state: 'error'` with a
short sanitized message, and the manager's own state machine never
throws out of `checkNow()`. The main application (login, DIRECT/RELAY
transport, every feature) is entirely independent of the updater's
state — nothing in `main/index.ts`'s boot sequence `await`s an update
check, and the update UI simply shows nothing (`not_configured`/
`up_to_date`/`checking` all render no visible card) until there's
something actionable to show.
