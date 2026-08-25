/**
 * 20.12.0 (Frontend rewrite kickoff) — ambient declarations for globals that
 * still live in frontend/js/*.js classic scripts. Migrated code reads these
 * directly (never reimplements their logic) — the legacy script is still
 * the single source of truth for session/auth/nav until it's migrated too;
 * duplicating the logic here would just create a second place for it to
 * drift out of sync.
 *
 * Safe because Vite's iife bundle wraps only ITS OWN declarations — reads
 * of outer bare identifiers still resolve to the classic scripts' shared
 * top-level `let`/`function` scope, same as every other legacy .js file,
 * as long as this bundle's <script> tag loads after 01-core.js/02-nav-utils.js
 * in index.html.
 */
export {};

declare global {
  /** Set by 01-core.js after GET /me — null until bound/loaded. */
  const me: {
    employee_id: number | null;
    role: string | null;
    org_id?: string;
    full_name?: string | null;
    is_manager?: boolean;
  } | null;

  /** Set by 06-team-bfq.js's switchAdminOrg() — null unless admin switched
   * away from their own network via the org switcher. */
  const adminViewOrgId: string | null;

  function canManage(): boolean;
  function authHeaders(json?: boolean): Record<string, string>;
  function toast(msg: string, type?: string): void;
  function switchPage(name: string): void;
  function exportCSV(kind: string): void;
  /** '&org_id=...' if admin switched networks, '' otherwise — 01-core.js. */
  function orgQueryParam(): string;
  /** Shows the shared #overlay/#modalTitle/#modalBody modal — 07-add-sale.js. */
  function openModal(): void;
  /** Set by 02-nav-utils.js's switchPage() — current page name, e.g. 'alerts'. */
  const page: string;
  function esc(s: unknown): string;
  /** 15-tasks.js — opens the task detail modal for the given task id. */
  function openTaskDetail(id: number): void | Promise<void>;
}
