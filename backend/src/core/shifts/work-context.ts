/**
 * Replacement-shift work-context resolution (see plan). Identity/home
 * organization and current work location are separate concepts — this
 * module NEVER touches principal.orgId or resolveViewOrgId(); it resolves
 * a parallel, narrower "where is this employee actually working right now"
 * fact, checked explicitly by callers.
 *
 * NORMAL — store belongs to the employee's own org: existing behavior,
 * unchanged (same result assertStoreInOrg already gave).
 * REPLACEMENT — store belongs to a different org, but that org shares a
 * sector with the employee's home org (core/orgs/sector-membership.ts) —
 * newly allowed, restricted-access work context.
 */
import * as storesRepo from '../../data/repositories/stores.js';
import * as employeesRepo from '../../data/repositories/employees.js';
import * as shiftsRepo from '../../data/repositories/shifts.js';
import { sameSector } from '../orgs/sector-membership.js';

export type WorkMode = 'NORMAL' | 'REPLACEMENT';
export type SelectionSource = 'SCHEDULE' | 'MANUAL_CODE';

export interface WorkContext {
  employeeId: number;
  homeOrgId: string;
  storeId: string;
  workOrgId: string;
  mode: WorkMode;
}

export interface SafeStoreInfo {
  id: string;
  code: string;
  name: string;
  display_name: string | null;
  address: string | null;
}

export interface StoreEligibility {
  allowed: boolean;
  message?: string;
  store?: SafeStoreInfo;
  mode?: WorkMode;
  workOrgId?: string;
}

// 'guest' deliberately excluded — never allowed to open a shift, replacement or not.
const ROLES_ALLOWED_TO_WORK_SHIFTS = new Set(['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin']);

function toSafeStore(s: { id: string; code: string; name: string; display_name: string | null; address: string | null }): SafeStoreInfo {
  // Only what an employee needs to confirm they've got the right store — no
  // org-internal fields (org_id, plan_share, micro_report_times, etc.) ever
  // leave this function, even for a NORMAL (own-org) result.
  return { id: s.id, code: s.code, name: s.name, display_name: s.display_name, address: s.address };
}

/**
 * Resolves whether `employee` may work a shift at the given store (looked
 * up by id OR code — exactly one should be passed), and in which mode. Pure
 * read/decision — does not open or mutate anything. Used both by the
 * resolve-store preview endpoint and by /shifts/open itself (same rules,
 * checked twice is intentional: preview must reflect exactly what open will
 * enforce).
 */
export async function resolveStoreEligibility(
  employee: { employeeId: number; homeOrgId: string; role: string },
  lookup: { storeId?: string; storeCode?: string }
): Promise<StoreEligibility> {
  if (!ROLES_ALLOWED_TO_WORK_SHIFTS.has(employee.role)) {
    return { allowed: false, message: 'Этой роли смены недоступны.' };
  }

  const isActive = await employeesRepo.getIsActive(employee.employeeId);
  if (isActive !== true) {
    return { allowed: false, message: 'Сотрудник неактивен.' };
  }

  const store = lookup.storeCode
    ? await storesRepo.findByCode(lookup.storeCode)
    : lookup.storeId
      ? await storesRepo.findByIdAnyOrg(lookup.storeId)
      : null;
  if (!store) {
    return { allowed: false, message: 'Точка с таким кодом не найдена.' };
  }
  if (!store.is_active) {
    return { allowed: false, message: 'Точка неактивна.' };
  }

  const storeOrgId = store.org_id || 'default';
  const safeStore = toSafeStore(store);

  if (storeOrgId === employee.homeOrgId) {
    return { allowed: true, store: safeStore, mode: 'NORMAL', workOrgId: storeOrgId };
  }

  if (!(await sameSector(employee.homeOrgId, storeOrgId))) {
    // Deliberately generic — never reveal the foreign store's own sector/org
    // identity to an employee who isn't allowed to work there.
    return { allowed: false, message: 'Эта точка не входит в ваш сектор. Выход на замену недоступен.' };
  }

  // Same-sector foreign store — eligible for REPLACEMENT, but only if the
  // employee doesn't already have an active shift somewhere else (a shift
  // already open at THIS exact store is fine — idempotent preview/reopen).
  const openElsewhere = await shiftsRepo.findOpenForEmployee(employee.employeeId);
  if (openElsewhere && openElsewhere.store_id !== store.id) {
    return { allowed: false, message: 'У вас уже открыта смена на другой точке — сначала закройте её.' };
  }

  return { allowed: true, store: safeStore, mode: 'REPLACEMENT', workOrgId: storeOrgId };
}

/**
 * For the three sale-writing routes' "writing my own sale" branch. Existing
 * behavior for a home-org store is unchanged (same result
 * assertStoreInOrg(storeId, homeOrgId) already gave — true/false). The only
 * addition: a foreign-org store is now also accepted, but ONLY if it's
 * exactly the store of the employee's current OPEN REPLACEMENT shift — never
 * "any same-sector store", so a sale can't be spoofed to a foreign store the
 * employee merely could theoretically work at. Returns the org to attribute
 * the sale to, or null if not accessible.
 */
export async function resolveSaleStoreOrgId(
  employeeId: number, storeId: string, homeOrgId: string
): Promise<string | null> {
  if (await storesRepo.belongsToOrg(homeOrgId, storeId)) return homeOrgId;
  const openSession = await shiftsRepo.findOpenForEmployee(employeeId);
  if (openSession && openSession.store_id === storeId && openSession.work_mode === 'REPLACEMENT' && openSession.org_id) {
    return openSession.org_id;
  }
  return null;
}
