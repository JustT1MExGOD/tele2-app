/**
 * Feature Flags — cached runtime helper (Admin Control Center, Phase 4+,
 * Area B1). Mirrors core/shared/metrics-catalog.ts's cache pattern: a
 * short-TTL in-memory cache over the DB, invalidated on write. Not wired
 * into ALLOW_INSECURE_AUTH/DATA_ENCRYPTION_ENABLED — those stay env-var
 * checks; this is for future call sites that want an org-overridable
 * runtime toggle instead.
 */
import * as repo from '../../data/repositories/feature-flags.js';

let cache: repo.FeatureFlagRow[] | null = null;
let cacheAt = 0;
const TTL = 30_000;

async function getAll(force = false): Promise<repo.FeatureFlagRow[]> {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  cache = await repo.listAll();
  cacheAt = Date.now();
  return cache;
}

/** Org override wins over the global row, else false if neither exists. */
export async function isFeatureEnabled(key: string, orgId: string | null): Promise<boolean> {
  const all = await getAll();
  const forOrg = orgId ? all.find((f) => f.key === key && f.org_id === orgId) : undefined;
  if (forOrg) return forOrg.enabled;
  const global = all.find((f) => f.key === key && f.org_id === null);
  return global ? global.enabled : false;
}

export function invalidateFeatureFlagsCache(): void {
  cache = null;
}
