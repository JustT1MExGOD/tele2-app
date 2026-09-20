// Local release-preparation tool for the NATIVE (Compose Desktop) app's updater - the counterpart of desktop/scripts/update-prepare.mjs.
// Takes a built installer (jpackage output, e.g. "T2 Sales-1.0.1.exe"), computes its SHA-256 / size, and writes a manifest plus the
// installer into a LOCAL staging directory laid out exactly like the real update server. Publishing is a separate, manual step.
//
// It does NOT: SSH/SCP/deploy anywhere, read or store any server credential, or touch an already published manifest.
//
// Server layout (the native app has its own subtree, so it never collides with the Electron app's /stable, /beta, /releases):
//   native/stable/manifest.json      native/beta/manifest.json      native/releases/T2SalesNative-Setup-x64-X.Y.Z.exe
//
// Usage (from the native/ directory):
//   node scripts/update-prepare.mjs --channel beta --installer "desktopApp/build/compose/binaries/main/exe/T2 Sales-1.0.1.exe"
//     [--version 1.0.1] [--mandatory] [--notes "Что нового"] [--min-supported 1.0.0]
//     [--update-base-url https://updates.vincere-mortem.ru] [--out update-staging]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UPDATE_BASE_URL = 'https://updates.vincere-mortem.ru';
const MAX_INSTALLER_SIZE = 500 * 1024 * 1024;

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
    else if (a === '--out') args.out = argv[++i];
    else fail(`unknown argument: ${a}`);
  }
  return args;
}

function fail(msg) {
  console.error(`update:prepare (native) - ${msg}`);
  process.exit(1);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['stable', 'beta'].includes(args.channel)) fail('--channel must be "stable" or "beta"');
  if (!args.installer) fail('--installer <path> is required');

  const installerPath = path.resolve(args.installer);
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) fail(`installer not found: ${installerPath}`);
  const srcName = path.basename(installerPath);
  if (path.extname(srcName).toLowerCase() !== '.exe') fail(`installer must be a .exe, got: ${srcName}`);

  // version: explicit, or the trailing X.Y.Z of the jpackage / canonical name
  let version = args.version;
  if (!version) {
    const m = srcName.match(/(\d+\.\d+\.\d+)\.exe$/);
    if (!m) fail(`could not derive a version from "${srcName}" - pass --version X.Y.Z`);
    version = m[1];
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`--version must look like X.Y.Z, got: ${version}`);
  if (args.minSupported && !/^\d+\.\d+\.\d+$/.test(args.minSupported)) fail(`--min-supported must look like X.Y.Z, got: ${args.minSupported}`);
  if (args.notes && args.notes.length > 8000) fail('--notes is longer than 8000 characters');

  // canonical published name: no spaces, and it is exactly the shape the client launches (T2SalesNative-Setup-x64-X.Y.Z.exe)
  const filename = `T2SalesNative-Setup-x64-${version}.exe`;

  let origin;
  try {
    const u = new URL(args.updateBaseUrl || DEFAULT_UPDATE_BASE_URL);
    if (u.protocol !== 'https:') throw new Error('not https');
    origin = u.origin;
  } catch {
    fail(`--update-base-url must be a valid https:// URL, got: ${args.updateBaseUrl}`);
  }

  const size = fs.statSync(installerPath).size;
  if (size <= 0 || size > MAX_INSTALLER_SIZE) fail(`installer size ${size} is outside 1..${MAX_INSTALLER_SIZE} bytes`);
  console.log(`Hashing ${srcName}...`);
  const sha256 = await sha256File(installerPath);

  const manifest = {
    schemaVersion: 1,
    channel: args.channel,
    version,
    publishedAt: new Date().toISOString(),
    mandatory: args.mandatory,
    installer: { filename, url: `${origin}/native/releases/${filename}`, sha256, size },
    ...(args.notes ? { releaseNotes: args.notes } : {}),
    ...(args.minSupported ? { minSupportedVersion: args.minSupported } : {})
  };

  const stagingRoot = path.resolve(args.out || path.join(__dirname, '..', 'update-staging'));
  const channelDir = path.join(stagingRoot, 'native', args.channel);
  const releasesDir = path.join(stagingRoot, 'native', 'releases'); // shared by both channels, like the real server
  fs.mkdirSync(channelDir, { recursive: true });
  fs.mkdirSync(releasesDir, { recursive: true });

  const manifestPath = path.join(channelDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const staged = path.join(releasesDir, filename);
  fs.copyFileSync(installerPath, staged);

  console.log('');
  console.log(`Prepared native/${args.channel}/manifest.json for version ${version}:`);
  console.log(`  ${manifestPath}`);
  console.log(`  ${staged}  (${(size / (1024 * 1024)).toFixed(1)} MiB, sha256 ${sha256})`);
  console.log('');
  console.log('This script did NOT publish or deploy anything. To publish (see native/docs/UPDATES.md):');
  console.log(`  1. Copy native/releases/${filename} to the server FIRST (never overwrite an older release)`);
  console.log(`  2. Check https://.../native/releases/${filename} downloads and has the size/hash above`);
  console.log(`  3. Replace native/${args.channel}/manifest.json atomically (upload under a temp name, then rename)`);
}

main().catch((e) => fail(e?.message || String(e)));
