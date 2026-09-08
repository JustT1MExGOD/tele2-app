/**
 * Публичная поверхность модуля analytics для других core-модулей.
 * Экспортирует только то, что реально потребляется извне (сейчас — alerts) —
 * не полный re-export содержимого модуля.
 */
export { checkAnomalyVsForecast, type PossibleCause } from './anomaly.js';
export { getStoreHourWeights, projectEndOfDay } from './insights.js';
export { evaluateOutcomes } from './learn.js';
