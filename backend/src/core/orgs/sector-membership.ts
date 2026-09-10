/**
 * Sector membership — the single authoritative helper for "does employee X
 * belong to the same sector as store Y" (replacement-shift feature). Sector
 * lives only on `organizations` (Dealer -> Sector -> Organization ->
 * Store/Employee, see docs/ARCHITECTURE.md) — neither stores nor employees
 * carry a sector_id column directly, both resolve it transitively via their
 * own org_id. No existing helper answered this question before this file
 * (audited: supervisor-sectors.ts resolves sector -> stores for a
 * supervisor, not an arbitrary employee's org).
 */
import * as orgsRepo from '../../data/repositories/organizations.js';

/** null org_id (unassigned employee/store) resolves to 'default', matching
 * the COALESCE(org_id,'default') convention used everywhere else. */
function normalizeOrgId(orgId: string | null | undefined): string {
  return orgId || 'default';
}

export async function getOrgSectorId(orgId: string | null | undefined): Promise<string | null> {
  return orgsRepo.getSectorId(normalizeOrgId(orgId));
}

/**
 * True only when BOTH orgs have a real (non-null) sector assigned and it's
 * the same one. Two orgs with no sector configured are NOT considered
 * "same sector" — an unconfigured sector must never silently grant
 * cross-org access.
 */
export async function sameSector(orgIdA: string | null | undefined, orgIdB: string | null | undefined): Promise<boolean> {
  const a = normalizeOrgId(orgIdA);
  const b = normalizeOrgId(orgIdB);
  if (a === b) return true; // same org is trivially "same sector" (and the common case)
  const [sectorA, sectorB] = await Promise.all([orgsRepo.getSectorId(a), orgsRepo.getSectorId(b)]);
  return !!sectorA && !!sectorB && sectorA === sectorB;
}
