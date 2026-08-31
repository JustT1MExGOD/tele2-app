// Local release-preparation tool for the updater (§11 of the updater
// brief). Takes a built installer, computes its version/SHA-256/size,
// and writes a manifest.json + copies the installer into a LOCAL
// staging directory laid out exactly like the real VPS
// (docs/DESKTOP-UPDATES.md) — so publishing later is just "copy this
// directory's contents to the server," a deliberate, separate, manual
// step this script never performs itself.
//
// Deliberately does NOT:
//   - SSH/SCP/rsync/deploy anywhere — no network access at all.
//   - Read or store any VPS credential/token.
//   - Touch a "production" manifest — it only ever writes into
//     update-staging/<channel>/, never anywhere already published.
//
// Usage:
//   node scripts/update-prepare.mjs --channel beta --installer <path>
//     [--version 20.55.1] [--mandatory] [--notes "Bug fixes"]
//     [--min-supported 20.50.0] [--update-base-url https://updates.vincere-mortem.ru]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPDATE_BASE_URL = 'https://updates.vincere-mortem.ru';
const FILENAME_VERSION_RE = /^T2Sales-Setup-x64-(\d+\.\d+\.\d+)\.exe$/;

function parseArgs(argv) {
  const args = { mandatory: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--channel') args.channel = argv[++i];
    else if (a === '--installer') args.installer = argv[++i];
    else if (a === '--version') args.version = argv[++i];
    else if (a === '--mandatory') args.mandatory = true;
    else if (a === '--notes') args.notes = argv[++i];
    else if (a === '--min-supported') args.minSupported = argv[++i];
    else if (a === '--update-base-url') args.updateBaseUrl = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`update:prepare — ${msg}`);
  process.exit(1);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.channel || !['stable', 'beta'].includes(args.channel)) {
    fail('--channel must be "stable" or "beta"');
  }
  if (!args.installer) fail('--installer <path> is required');

  const installerPath = path.resolve(args.installer);
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
    fail(`installer not found: ${installerPath}`);
  }
  const filename = path.basename(installerPath);
  if (path.extname(filename).toLowerCase() !== '.exe') fail(`installer must be a .exe, got: ${filename}`);

  let version = args.version;
  if (!version) {
    const m = filename.match(FILENAME_VERSION_RE);
    if (!m) {
      fail(
        `could not derive a version from filename "${filename}" (expected T2Sales-Setup-x64-X.Y.Z.exe) — pass --version explicitly`
      );
    }
    version = m[1];
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`--version must look like X.Y.Z, got: ${version}`);

  const updateBaseUrl = args.updateBaseUrl || DEFAULT_UPDATE_BASE_URL;
  let baseUrlOrigin;
  try {
    baseUrlOrigin = new URL(updateBaseUrl).origin;
    if (new URL(updateBaseUrl).protocol !== 'https:') throw new Error('not https');
  } catch {
    fail(`--update-base-url must be a valid https:// URL, got: ${updateBaseUrl}`);
  }

  console.log(`Hashing ${filename}…`);
  const sha256 = await sha256File(installerPath);
  const size = fs.statSync(installerPath).size;

  const manifest = {
    schemaVersion: 1,
    channel: args.channel,
    version,
    publishedAt: new Date().toISOString(),
    mandatory: args.mandatory,
    installer: {
      filename,
      url: `${baseUrlOrigin}/releases/${filename}`,
      sha256,
      size
    },
    ...(args.notes ? { releaseNotes: args.notes } : {}),
    ...(args.minSupported ? { minSupportedVersion: args.minSupported } : {})
  };

  // §11 of the security gate — the generated manifest must pass through
  // the SAME validator the client itself runs (desktop/src/main/updater/
  // manifest.js's validateManifest), not just "looks right by
  // construction". Requires `npm run desktop:build` to have produced
  // dist/ first — fails loudly rather than silently skipping the check
  // if it hasn't, since a soft-skip here would defeat the point.
  const compiledManifestModulePath = path.join(__dirname, '..', 'dist', 'main', 'updater', 'manifest.js');
  if (!fs.existsSync(compiledManifestModulePath)) {
    fail(`dist/main/updater/manifest.js not found — run "npm run desktop:build" first so this script can self-validate the generated manifest with the client's own validator`);
  }
  const { validateManifest } = await import(pathToFileURL(compiledManifestModulePath).href);
  try {
    validateManifest(manifest, args.channel, baseUrlOrigin);
  } catch (e) {
    fail(`generated manifest failed client-side validation (this should be unreachable — please report): ${e?.message || e}`);
  }

  const stagingRoot = path.join(__dirname, '..', 'update-staging');
  const channelDir = path.join(stagingRoot, args.channel);
  const releasesDir = path.join(stagingRoot, 'releases'); // shared across channels — matches the real VPS layout (one /releases/ dir)
  fs.mkdirSync(channelDir, { recursive: true });
  fs.mkdirSync(releasesDir, { recursive: true });

  const manifestPath = path.join(channelDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const stagedInstallerPath = path.join(releasesDir, filename);
  fs.copyFileSync(installerPath, stagedInstallerPath);

  console.log('');
  console.log(`Prepared ${args.channel}/manifest.json for version ${version}:`);
  console.log(`  ${manifestPath}`);
  console.log(`  ${stagedInstallerPath}  (${(size / (1024 * 1024)).toFixed(1)} MiB, sha256 ${sha256})`);
  console.log('');
  console.log('This script did NOT publish or deploy anything. To publish:');
  console.log(`  1. Review ${manifestPath}`);
  console.log(`  2. Copy update-staging/${args.channel}/manifest.json to the VPS's ${args.channel}/manifest.json`);
  console.log(`  3. Copy update-staging/releases/${filename} to the VPS's releases/${filename}`);
  console.log('  (see docs/DESKTOP-UPDATES.md for the exact VPS layout and publishing procedure)');
}

main().catch((e) => {
  console.error('update:prepare failed:', e?.message || e);
  process.exit(1);
});
