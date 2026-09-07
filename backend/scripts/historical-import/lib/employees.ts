/**
 * Employee name canonicalization. The only confirmed source-data typo is
 * "Степанов Алекскей Юрьевич" (April schedule xlsx) -> canonical
 * "Степанов Алексей Юрьевич" — must NOT become a separate employee.
 *
 * The single-word aliases seen only in t2_legacy_bfq.csv (АЛЕКСЕЙ, АНДРЕЙ,
 * НИКИТА, СЕМЕН, САША, СОНЯ) are intentionally left unresolved here: BFQ is
 * reference-only per the standing SOURCE_ONLY rules (never imported as
 * sales/schedule data), so misresolving them has zero import impact.
 */
export const EMPLOYEE_NAME_ALIASES: Record<string, string> = {
  'Степанов Алекскей Юрьевич': 'Степанов Алексей Юрьевич',
};

export function canonicalEmployeeName(rawName: string): string {
  // NFC normalization matters here: source files/tools sometimes produce
  // Cyrillic text with combining-character (NFD) sequences that render
  // identically but compare unequal as strings — silently breaking every
  // downstream Map key lookup keyed on employee name. Every name must pass
  // through this function before being used as (part of) a lookup key.
  const trimmed = rawName.normalize('NFC').trim();
  return EMPLOYEE_NAME_ALIASES[trimmed] ?? trimmed;
}
