import type { ScheduleIndex } from './schedule-index.js';
import { lookupSchedule } from './schedule-index.js';
import { findOverride } from './overrides.js';

export type StoreResolutionCategory =
  | 'STORE_RESOLVED_SCHEDULE'
  | 'STORE_RESOLVED_USER_CONFIRMED'
  | 'TECHNICAL_FACT_ON_DAY_OFF'
  | 'NO_STORE_NO_SCHEDULE'
  | 'NO_STORE_DAY_OFF_CONFLICT';

export interface StoreResolution {
  employeeName: string;
  date: string;
  storeId: string | null;
  category: StoreResolutionCategory;
  resolutionSource: 'SCHEDULE_SOURCE' | 'USER_CONFIRMED' | null;
  resolutionReason: string | null;
}

export function resolveStore(
  employeeName: string,
  date: string,
  scheduleIndex: ScheduleIndex
): StoreResolution {
  const override = findOverride(employeeName, date);
  if (override) {
    return {
      employeeName,
      date,
      storeId: override.storeId,
      category: override.technicalFactOnDayOff
        ? 'TECHNICAL_FACT_ON_DAY_OFF'
        : 'STORE_RESOLVED_USER_CONFIRMED',
      resolutionSource: override.resolutionSource,
      resolutionReason: override.resolutionReason,
    };
  }

  const sched = lookupSchedule(scheduleIndex, employeeName, date);
  if (!sched) {
    return {
      employeeName,
      date,
      storeId: null,
      category: 'NO_STORE_NO_SCHEDULE',
      resolutionSource: null,
      resolutionReason: null,
    };
  }
  if (sched.status === 'working' && sched.storeId) {
    return {
      employeeName,
      date,
      storeId: sched.storeId,
      category: 'STORE_RESOLVED_SCHEDULE',
      resolutionSource: 'SCHEDULE_SOURCE',
      resolutionReason: 'SCHEDULE_MATCH',
    };
  }
  return {
    employeeName,
    date,
    storeId: null,
    category: 'NO_STORE_DAY_OFF_CONFLICT',
    resolutionSource: null,
    resolutionReason: null,
  };
}
