/**
 * Centralized CSV/export safety helpers (20.54.0, P1-F). The existing
 * per-route `csvEscape()` in api/routes/ops/export.ts only quoted
 * delimiter/quote/newline characters — it never addressed formula
 * injection: a cell whose value starts with `=`, `+`, `-`, `@`, or a
 * leading tab/CR is interpreted as a formula by Excel/LibreOffice/Sheets
 * when the file is opened (e.g. an employee full_name of
 * `=cmd|'/c calc'!A1` or `@SUM(1+1)*cmd|...`). All three CSV export
 * routes pull at least one string field an org admin (not the platform)
 * controls — employee/store display names — so this is a real,
 * reachable vector, not theoretical.
 */

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

/** CSV-encodes one cell: prefixes a leading apostrophe when the value
 * would otherwise be read as a formula by spreadsheet software, then
 * applies standard CSV quoting. The apostrophe is the same mitigation
 * OWASP recommends and that Excel/Sheets both render as literal text
 * (not part of the value) — it doesn't corrupt the exported data. */
export function csvSafeCell(v: unknown): string {
  let s = String(v ?? '');
  if (FORMULA_PREFIX_RE.test(s)) s = `'${s}`;
  if (/[;"\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Sanitizes a value for interpolation into a Content-Disposition
 * filename — only alphanumerics, dash, underscore, and dot survive.
 * Query-controlled values (from/to/month/store_id) were previously
 * interpolated into export filenames with no validation; Node itself
 * rejects raw CR/LF in header values, but this closes the remaining
 * gap (quotes, non-ASCII, path separators) rather than relying on that
 * as the only defense. */
export function safeFilenameSegment(v: unknown, fallback = 'export'): string {
  const s = String(v ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
  return s || fallback;
}
