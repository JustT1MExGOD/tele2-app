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
