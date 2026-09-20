/**
 * USER_CONFIRMED resolutions for the new-sources batch (Nov 2025 - Mar
 * 2026): 40 employee/date sales facts whose "График" schedule entry is
 * either day_off ('вых'/'бол') or missing entirely, confirmed by the user
 * as technical entries (corrections/backfill, not actual worked shifts —
 * "это все были технические вносы"). Store attribution per the user's
 * explicit instruction ("по ближайшему рабочему дню"): the store_id of
 * that employee's nearest working day in the same file's schedule
 * (ties broken toward the earlier date), computed once and frozen here
 * rather than recomputed at resolve time, so the resolution is auditable
 * and stable.
 *
 * Same hard constraints as lib/overrides.ts: used ONLY to set store_id on
 * the sales row. Never creates/modifies a schedules row, never implies a
 * shift_sessions/clock-in row. Schedule stays day_off/sick exactly as
 * originally recorded.
 */
import type { StoreOverride } from './overrides.js';

export const NEW_BATCH_STORE_OVERRIDES: StoreOverride[] = [
  { employeeName: "Бижонов Семен Михайлович", date: "2025-11-04", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-02", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-10", storeId: "kalinina2" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-18", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-03", storeId: "kalinina2" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-10", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-11", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-12", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-13", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-14", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-17", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-18", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-19", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-20", storeId: "kosmonavtov" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-26", storeId: "kalinina2" },
  { employeeName: "Каравашков Андрей Алексеевич", date: "2025-12-27", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-04", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-11", storeId: "kosmonavtov" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-21", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-24", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2025-12-25", storeId: "kosmonavtov" },
  { employeeName: "Вурсол Павел Алексеевич", date: "2025-12-04", storeId: "kosmonavtov" },
  { employeeName: "Вурсол Павел Алексеевич", date: "2025-12-08", storeId: "kosmonavtov" },
  { employeeName: "Вурсол Павел Алексеевич", date: "2025-12-23", storeId: "kalinina2" },
  { employeeName: "Вурсол Павел Алексеевич", date: "2025-12-24", storeId: "kosmonavtov" },
  { employeeName: "Вурсол Павел Алексеевич", date: "2025-12-28", storeId: "kosmonavtov" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-06", storeId: "kalinina2" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-07", storeId: "kalinina2" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-08", storeId: "kosmonavtov" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-09", storeId: "kosmonavtov" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-13", storeId: "kalinina2" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-14", storeId: "kalinina2" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-20", storeId: "kalinina2" },
  { employeeName: "Баранова София Андреевна", date: "2025-12-21", storeId: "kosmonavtov" },
  { employeeName: "Тутаев Никита Алексеевич", date: "2025-12-05", storeId: "kosmonavtov" },
  { employeeName: "Тутаев Никита Алексеевич", date: "2025-12-06", storeId: "kalinina2" },
  { employeeName: "Тутаев Никита Алексеевич", date: "2025-12-22", storeId: "kalinina2" },
  { employeeName: "Тутаев Никита Алексеевич", date: "2025-12-30", storeId: "kalinina2" },
  { employeeName: "Бижонов Семен Михайлович", date: "2026-03-04", storeId: "kosmonavtov" },
  { employeeName: "Степанов Алексей Юрьевич", date: "2026-03-13", storeId: "kosmonavtov" },
].map((o) => ({
  ...o,
  resolutionSource: 'USER_CONFIRMED' as const,
  resolutionReason: 'HISTORICAL_STORE_OVERRIDE' as const,
  technicalFactOnDayOff: true,
}));

export function findNewBatchOverride(employeeName: string, date: string): StoreOverride | null {
  return NEW_BATCH_STORE_OVERRIDES.find((o) => o.employeeName === employeeName && o.date === date) ?? null;
}
