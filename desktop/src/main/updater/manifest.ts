/**
 * Update manifest schema + strict runtime validation. The manifest is
 * untrusted input in exactly the sense any network response is — even
 * though it's served from our own configured update origin, this
 * validator is the one place that decides what a manifest is allowed to
 * mean, so it fails closed on anything unexpected rather than trusting
 * shape-adjacent JSON.
 *
 * Deliberately absent from the schema, permanently: any executable
 * command/arguments, any local filesystem path, any non-installer field
 * that could influence what runs or where. There is no code path
 * anywhere in the updater that reads such a field from a manifest,
 * because the type this function returns structurally cannot carry one.
 */
import { parseVersion } from './version.js';

export const MANIFEST_SCHEMA_VERSION = 1;
export const SUPPORTED_CHANNELS = ['stable', 'beta'] as const;
export type UpdateChannelName = (typeof SUPPORTED_CHANNELS)[number];

/** Generous but bounded — real installers are tens to a couple hundred
 * MB; this is a sanity ceiling against a misconfigured or malicious
 * manifest claiming an absurd size, not a tight fit to today's builds. */
export const MAX_INSTALLER_SIZE_BYTES = 500 * 1024 * 1024;

/** Release notes are display text, not a security boundary, but an
 * unbounded string is still a cheap resource-exhaustion vector and a
 * plausible copy-paste mistake (e.g. an entire changelog file). */
const MAX_RELEASE_NOTES_LENGTH = 8000;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
const SAFE_INSTALLER_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.exe$/;

/** Windows reserved device names (§2 of the security gate) — Windows
 * treats these as reserved for the PORTION OF THE NAME BEFORE THE FIRST
 * DOT, case-insensitively, regardless of extension ("CON.exe", "con.v2.exe"
 * are both reserved, not just bare "CON"). A manifest naming one of these
 * would produce a filename the OS itself refuses to create/open normally
 * — reject it at validation time rather than surfacing a confusing
 * filesystem error later during download. */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

export interface UpdateManifestInstaller {
  filename: string;
  url: string;
  sha256: string;
  size: number;
}

export interface UpdateManifest {
  schemaVersion: 1;
  channel: UpdateChannelName;
  version: string;
  publishedAt: string;
  mandatory: boolean;
  installer: UpdateManifestInstaller;
  releaseNotes?: string;
  minSupportedVersion?: string;
}

export class ManifestValidationError extends Error {}

function fail(reason: string): never {
  throw new ManifestValidationError(reason);
}

/**
 * Validates a parsed JSON value against the manifest schema AND against
 * the specific channel/origin this manifest was fetched for — a manifest
 * fetched from `/stable/manifest.json` claiming `channel: "beta"`, or an
 * installer URL pointing outside the configured update origin, is
 * rejected exactly the same as a malformed one; a server bug or a
 * misconfigured/compromised intermediary must never silently redirect
 * the client to installing something the server didn't intend for this
 * exact channel.
 */
export function validateManifest(raw: unknown, expectedChannel: UpdateChannelName, allowedOrigin: string): UpdateManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('manifest is not a JSON object');
  const m = raw as Record<string, unknown>;

  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) fail(`unsupported schemaVersion: ${String(m.schemaVersion)}`);

  if (typeof m.channel !== 'string' || !SUPPORTED_CHANNELS.includes(m.channel as UpdateChannelName)) {
    fail(`invalid channel: ${String(m.channel)}`);
  }
  if (m.channel !== expectedChannel) {
    fail(`manifest channel "${String(m.channel)}" does not match the requested channel "${expectedChannel}"`);
  }

  if (typeof m.version !== 'string' || !parseVersion(m.version)) fail(`invalid version: ${String(m.version)}`);

  if (typeof m.publishedAt !== 'string' || Number.isNaN(Date.parse(m.publishedAt))) {
    fail(`invalid publishedAt: ${String(m.publishedAt)}`);
  }

  if (typeof m.mandatory !== 'boolean') fail('mandatory must be a boolean');

  if (typeof m.installer !== 'object' || m.installer === null) fail('installer must be an object');
  const installer = m.installer as Record<string, unknown>;

  if (typeof installer.filename !== 'string' || !SAFE_INSTALLER_FILENAME_RE.test(installer.filename)) {
    fail(`invalid installer.filename: ${String(installer.filename)}`);
  }
  // Defense in depth beyond the regex above (which already forbids '/'
  // and '\\'): explicit path-traversal / absolute-path rejection, same
  // discipline as never trusting a single check alone elsewhere in this
  // codebase (relay/src/forward.ts's own "re-assert even though
  // validation above should already make deviation impossible").
  if (installer.filename.includes('..') || installer.filename.includes('/') || installer.filename.includes('\\')) {
    fail('installer.filename must not contain path separators or "..".');
  }
  const filenameStem = installer.filename.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(filenameStem)) {
    fail(`installer.filename "${installer.filename}" uses a reserved Windows device name`);
  }

  if (typeof installer.url !== 'string') fail('installer.url must be a string');
  let installerUrl: URL;
  try {
    installerUrl = new URL(installer.url);
  } catch {
    fail(`installer.url is not a valid absolute URL: ${installer.url}`);
  }
  if (installerUrl.protocol !== 'https:') fail(`installer.url must be https://, got: ${installer.url}`);
  if (installerUrl.origin !== allowedOrigin) {
    fail(`installer.url origin "${installerUrl.origin}" does not match the configured update origin "${allowedOrigin}"`);
  }
  // The path must land in /releases/ and the URL's own filename segment
  // must match installer.filename exactly — the manifest cannot point
  // at some other path on the same origin (e.g. a manifest.json, or a
  // path outside /releases/) even though the origin check above already
  // does the heavy lifting.
  if (!installerUrl.pathname.startsWith('/releases/')) {
    fail(`installer.url path must be under /releases/, got: ${installerUrl.pathname}`);
  }
  if (installerUrl.pathname !== `/releases/${installer.filename}`) {
    fail('installer.url filename does not match installer.filename');
  }

  if (typeof installer.sha256 !== 'string' || !SHA256_HEX_RE.test(installer.sha256)) {
    fail(`invalid installer.sha256: ${String(installer.sha256)}`);
  }

  if (typeof installer.size !== 'number' || !Number.isSafeInteger(installer.size) || installer.size <= 0) {
    fail(`invalid installer.size: ${String(installer.size)}`);
  }
  if (installer.size > MAX_INSTALLER_SIZE_BYTES) {
    fail(`installer.size ${installer.size} exceeds the maximum allowed ${MAX_INSTALLER_SIZE_BYTES} bytes`);
  }

  let releaseNotes: string | undefined;
  if (m.releaseNotes !== undefined) {
    if (typeof m.releaseNotes !== 'string') fail('releaseNotes must be a string when present');
    if (m.releaseNotes.length > MAX_RELEASE_NOTES_LENGTH) fail(`releaseNotes exceeds ${MAX_RELEASE_NOTES_LENGTH} characters`);
    releaseNotes = m.releaseNotes;
  }

  let minSupportedVersion: string | undefined;
  if (m.minSupportedVersion !== undefined) {
    if (typeof m.minSupportedVersion !== 'string' || !parseVersion(m.minSupportedVersion)) {
      fail(`invalid minSupportedVersion: ${String(m.minSupportedVersion)}`);
    }
    minSupportedVersion = m.minSupportedVersion;
  }

  return {
    schemaVersion: 1,
    channel: m.channel as UpdateChannelName,
    version: m.version,
    publishedAt: m.publishedAt,
    mandatory: m.mandatory,
    installer: {
      filename: installer.filename,
      url: installer.url,
      sha256: (installer.sha256 as string).toLowerCase(),
      size: installer.size
    },
    ...(releaseNotes !== undefined ? { releaseNotes } : {}),
    ...(minSupportedVersion !== undefined ? { minSupportedVersion } : {})
  };
}
