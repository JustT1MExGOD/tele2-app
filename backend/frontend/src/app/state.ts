/**
 * 20.12.0 (Frontend rewrite kickoff) — typed accessor over session state.
 *
 * Not a new store: source of truth stays the legacy `me` global (set by
 * 01-core.js after GET /me) — see shared/legacy-globals.d.ts. Migrated code
 * gets a typed shape instead of reading the untyped bare global directly;
 * legacy code is unaffected and keeps writing `me` exactly as before. If
 * migrated and legacy code each kept their own copy of "who is the current
 * user," they'd drift the first time one updates and the other doesn't —
 * this reads the same live value both see.
 */
export interface SessionState {
  employeeId: number | null;
  role: string | null;
  orgId: string;
  fullName: string | null;
}

export function getSession(): SessionState | null {
  if (!me) return null;
  return {
    employeeId: me.employee_id,
    role: me.role,
    orgId: me.org_id || 'default',
    fullName: me.full_name || null
  };
}

/**
 * Typed read-only accessors for the rest of app/core.ts's/app/nav.ts's
 * shared mutable state (20.58.0 architecture split, corr. #6). Same
 * non-store pattern as getSession() above — each function reads the live
 * bare global at call time, source of truth unchanged, no new state
 * introduced. This is the "explicit compatibility/runtime boundary" the
 * architecture plan asks for: new code should call these instead of
 * reading `stores`/`employees`/etc. as bare identifiers directly, so a
 * future migration away from the bare-global mechanism only has to change
 * these 8 functions' bodies, not every call site. Existing bare-global
 * reads elsewhere are unaffected — this does not change behavior or
 * script load order, only adds a typed alternative alongside them.
 *
 * The full inventory of app/core.ts's/app/nav.ts's owned mutable state —
 * `me` (getSession above), `stores`, `employees`, `saleSelection`,
 * `scheduleMonth`, `planMonth`, `adminViewOrgId`, `METRICS`, `page` — is
 * frozen by scripts/check-frontend-legacy-globals.mjs: a new bare mutable
 * global can still be added to shared/legacy-globals.d.ts, but the
 * checker fails until its frozen list is updated to match, so the
 * decision is visible in review rather than silent drift. See
 * docs/ARCHITECTURE.md's "Legacy global state" section for the full
 * rationale on why this isn't migrated away in this pass.
 */
export function getStores(): readonly any[] {
  return stores;
}

export function getEmployees(): readonly any[] {
  return employees;
}

export function getSaleSelection(): Readonly<Record<string, number>> {
  return saleSelection;
}

export function getScheduleMonth(): string {
  return scheduleMonth;
}

export function getPlanMonth(): string {
  return planMonth;
}

export function getAdminViewOrgId(): string | null {
  return adminViewOrgId;
}

export function getMetricsCatalog(): readonly { id: string; label: string; short_label: string; unit: string }[] {
  return METRICS;
}

export function getCurrentPage(): string {
  return page;
}
