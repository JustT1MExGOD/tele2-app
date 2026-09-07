/**
 * USER_CONFIRMED resolutions for the 10 employee/date cases that could not
 * be resolved from any schedule source (8 Рогожин NO_SCHEDULE_DATA cases)
 * or conflicted with the schedule (2 DAY_OFF_CONFLICT / technical-entry
 * cases). Each entry carries explicit provenance so the dry-run/importer
 * can show why a given historical sales row got its store_id, distinct
 * from ordinary SCHEDULE_SOURCE resolutions.
 *
 * Hard constraints (per explicit user instruction): these overrides are
 * used ONLY to set store_id on the corresponding `sales` row. They must
 * NEVER create/modify a `schedules` row, and must NEVER create a
 * `shift_sessions` row or any clock-in. Presence of a sales fact is not
 * treated as proof a shift occurred.
 */
export type ResolutionSource = 'SCHEDULE_SOURCE' | 'USER_CONFIRMED';
export type ResolutionReason =
  | 'HISTORICAL_STORE_OVERRIDE'
  | 'TECHNICAL_FACT_AFTER_STORE_CLOSE';

export interface StoreOverride {
  employeeName: string;
  date: string; // YYYY-MM-DD
  storeId: string;
  resolutionSource: ResolutionSource;
  resolutionReason: ResolutionReason;
  /** true if the schedule for this employee/date says day_off and must stay day_off (no schedule mutation). */
  technicalFactOnDayOff: boolean;
}

export const USER_CONFIRMED_STORE_OVERRIDES: StoreOverride[] = [
  // 8 Рогожин Вячеслав Александрович NO_SCHEDULE_DATA cases, June 2026 -> Калинина 2
  ...[
    '2026-06-03', '2026-06-05', '2026-06-06', '2026-06-09',
    '2026-06-13', '2026-06-22', '2026-06-25', '2026-06-26',
  ].map((date): StoreOverride => ({
    employeeName: 'Рогожин Вячеслав Александрович',
    date,
    storeId: 'kalinina2',
    resolutionSource: 'USER_CONFIRMED',
    resolutionReason: 'HISTORICAL_STORE_OVERRIDE',
    technicalFactOnDayOff: false,
  })),
  // Technical entries made after the store's actual closure — sales fact
  // importable, schedule stays day_off, no shift/clock-in fabricated.
  {
    employeeName: 'Каравашков Андрей Алексеевич',
    date: '2026-06-30',
    storeId: 'kalinina2',
    resolutionSource: 'USER_CONFIRMED',
    resolutionReason: 'TECHNICAL_FACT_AFTER_STORE_CLOSE',
    technicalFactOnDayOff: true,
  },
  {
    employeeName: 'Степанов Алексей Юрьевич',
    date: '2026-06-06',
    storeId: 'kalinina2',
    resolutionSource: 'USER_CONFIRMED',
    resolutionReason: 'TECHNICAL_FACT_AFTER_STORE_CLOSE',
    technicalFactOnDayOff: true,
  },
];

export function findOverride(employeeName: string, date: string): StoreOverride | null {
  return USER_CONFIRMED_STORE_OVERRIDES.find(
    (o) => o.employeeName === employeeName && o.date === date
  ) ?? null;
}
