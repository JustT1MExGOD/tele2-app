/**
 * Публичная поверхность модуля analytics для других core-модулей.
 * Экспортирует только то, что реально потребляется извне (сейчас — alerts) —
 * не полный re-export содержимого модуля. checkAnomalyVsForecast/PossibleCause
 * переехали в core/alerts/anomaly.ts (20.58.0 split) — это их собственный
 * модуль, не analytics.
 */
export { getStoreHourWeights, projectEndOfDay } from './insights.js';
export { evaluateOutcomes } from './learn.js';
