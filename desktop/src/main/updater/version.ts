/**
 * Version-aware comparator for T2 Sales's MAJOR.MINOR.PATCH scheme (see
 * CLAUDE.md's versioning convention). Deliberately NOT a string
 * comparison ("20.55.1" < "20.55.99" lexicographically compares the
 * single characters '1' < '9', which is correct there but wrong for
 * "20.55.2" vs "20.55.10" — string comparison says "20.55.10" < "20.55.2").
 * No new dependency (no `semver` package) — the version scheme here is a
 * plain dotted list of non-negative integers, nothing a small hand-written
 * parser can't handle correctly and more legibly than pulling in a
 * general-purpose semver library for pre-release/build-metadata syntax
 * this project's versions never use.
 */

/** Parses "20.55.1" into [20, 55, 1]. Returns null for anything that
 * isn't a dot-separated list of non-negative integers — malformed input
 * is a hard rejection, never a best-effort guess (a manifest with a
 * garbled version string must never be silently treated as "older" or
 * "newer"; the caller decides what null means for its own flow). */
export function parseVersion(raw: string): number[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.trim().split('.');
  if (parts.length === 0 || parts.length > 10) return null; // sanity bound
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null; // no leading '-', no whitespace, no 'v' prefix, no pre-release suffix
    const n = Number(part);
    if (!Number.isSafeInteger(n)) return null;
    nums.push(n);
  }
  return nums;
}

/**
 * Returns positive if `a` > `b`, negative if `a` < `b`, zero if equal,
 * and `null` if either string fails to parse — the caller must treat
 * `null` as "cannot compare, do not act on this" rather than any
 * numeric fallback.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** True only when `candidate` is a well-formed version strictly greater
 * than `current` — a malformed candidate, an equal version, or an older
 * version all return false (never automatically downgrade — §12 of the
 * updater brief: a manifest with a lower version than what's already
 * installed is simply ignored by the ordinary client updater). */
export function isNewerVersion(current: string, candidate: string): boolean {
  const cmp = compareVersions(candidate, current);
  return cmp !== null && cmp > 0;
}
