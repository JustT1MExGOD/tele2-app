/**
 * Recommend (21.0) — третий шаг конвейера Explain → Predict → Recommend →
 * Act → Learn. Act уже существовал (18.4, создание задачи из проблемы
 * Command Center) — этот файл только подставляет ЧТО написать в задачу,
 * вместо пустого поля. Детерминированно, правилом cause→действие, без
 * LLM (та же дисциплина, что Explain/Predict) — человек всё равно решает
 * сам: видит подсказку, редактирует или игнорирует, жмёт «Создать».
 * Никакого автовыполнения.
 */
import type { PossibleCause } from '../analytics/anomaly.js';

/** null — для этого типа/причины подсказки не даём (пока), вызывающий код
 * должен сам оставить прежнее поведение (заголовок алерта как есть). */
export function suggestAction(alertType: string, payload: any): string | null {
  if (alertType === 'anomaly_vs_forecast') {
    const causes: PossibleCause[] = Array.isArray(payload?.possible_causes) ? payload.possible_causes : [];
    // Приоритет: недоукомплектованность графика — это то, что можно
    // поправить ДО следующей смены, разрыв явки — сегодняшнее решение.
    // network_wide сознательно не даёт совета — весь смысл фактора
    // "вероятно не локальная причина", предлагать действие точке было бы
    // неверным сигналом (это не её недоработка).
    if (causes.some((c) => c.type === 'understaffing')) {
      return 'Проверить график на ближайшие дни — по данным точка недоукомплектована для этого дня недели, рассмотреть усиление';
    }
    if (causes.some((c) => c.type === 'shift_gap')) {
      return 'Связаться со сменой — по графику кто-то не вышел, уточнить причину и при необходимости найти замену';
    }
    return null;
  }

  if (alertType === 'plan_miss_projected') {
    const projected = Number(payload?.projectedTotal) || 0;
    const plan = Number(payload?.planTotal) || 0;
    return `Скорректировать оставшуюся часть дня — прогноз ~${projected} против плана ${plan}, время ещё есть: усилить работу с трафиком, подтолкнуть MNP/ПА`;
  }

  return null;
}
