/**
 * Learn (21.x) — пятый и последний шаг конвейера Explain → Predict →
 * Recommend → Act → Learn: сработала ли рекомендация? Детерминированно,
 * без LLM — та же дисциплина, что у первых четырёх шагов. Два независимых
 * измерения, для двух типов алертов, где вообще есть чем измерить исход:
 *
 *  - plan_miss_projected (Predict/Recommend) — однодневное: реальный итог
 *    дня против projectedTotal, зафиксированного В МОМЕНТ алерта (тот
 *    самый пессимистичный read, который видел менеджер, не пересчитанный
 *    задним числом прогноз).
 *  - anomaly_vs_forecast (Explain), только "тихие" дни (payload.z < 0) —
 *    рецидив: была ли у ТОЙ ЖЕ точки ещё одна просадка в следующие
 *    RECURRENCE_WINDOW_DAYS дней. Оцениваем только алерты СТАРШЕ окна —
 *    рецидив в будущем ещё физически не мог случиться раньше.
 *
 * Оба измерения дополнительно фиксируют had_task — была ли по этому
 * алерту создана И ДОВЕДЕНА до конца (status='done') задача — отвечает на
 * отдельный вопрос "помогает ли вообще Act", не только "стало ли лучше
 * само по себе" (могло стать лучше и без всякого вмешательства).
 */
import { todayMoscow } from '../../utils/date.js';
import * as alertsRepo from '../../data/repositories/alerts.js';
import * as salesRepo from '../../data/repositories/sales.js';
import * as tasksRepo from '../../data/repositories/tasks.js';

function num(v: any) {
  return Number(v) || 0;
}

const RECURRENCE_WINDOW_DAYS = 7;

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export async function evaluatePlanMissOutcomes(date: string): Promise<{ evaluated: number }> {
  const alerts = await alertsRepo.findUnevaluatedPlanMiss(date);
  if (!alerts.length) return { evaluated: 0 };
  // id — bigint, pg возвращает строкой; нормализуем сразу, иначе
  // completedAlertIds.has(a.id) сравнивает number с string и всегда лжёт.
  for (const a of alerts) a.id = Number(a.id);

  const storeIds = [...new Set(alerts.map((a) => a.store_id as string))];
  const actualRows = await salesRepo.findTotalsForDate(storeIds, date);
  const actualByStore = new Map<string, number>();
  for (const r of actualRows) actualByStore.set(r.store_id, num(r.total));

  const completedAlertIds = new Set(await tasksRepo.findCompletedAlertIds(alerts.map((a) => a.id)));

  for (const a of alerts) {
    const actual = actualByStore.get(a.store_id) || 0;
    const projected = num(a.payload?.projectedTotal);
    const outcome = actual >= projected ? 'recovered' : 'still_missed';
    await alertsRepo.mergeOutcome(a.id, outcome, completedAlertIds.has(a.id));
  }
  return { evaluated: alerts.length };
}

export async function evaluateAnomalyRecurrence(today: string): Promise<{ evaluated: number }> {
  const cutoff = addDays(today, -RECURRENCE_WINDOW_DAYS);
  const alerts = await alertsRepo.findUnevaluatedAnomalyDips(cutoff);
  if (!alerts.length) return { evaluated: 0 };
  for (const a of alerts) a.id = Number(a.id);

  const completedAlertIds = new Set(await tasksRepo.findCompletedAlertIds(alerts.map((a) => a.id)));

  for (const a of alerts) {
    const windowEnd = addDays(a.alert_date, RECURRENCE_WINDOW_DAYS);
    const recurred = await alertsRepo.hasRecurringDip(a.store_id, a.alert_date, windowEnd);
    const outcome = recurred ? 'recurred' : 'recovered';
    await alertsRepo.mergeOutcome(a.id, outcome, completedAlertIds.has(a.id));
  }
  return { evaluated: alerts.length };
}

/** Дневной тик (alerts/service.ts) — оба измерения разом, "вчера" для
 * plan_miss (день только что закрылся), "сегодня" как точка отсчёта окна
 * рецидива для anomaly. */
export async function evaluateOutcomes(): Promise<{ planMiss: number; anomaly: number }> {
  const today = todayMoscow();
  const yesterdayDate = new Date(today + 'T12:00:00');
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  const planMiss = await evaluatePlanMissOutcomes(yesterday);
  const anomaly = await evaluateAnomalyRecurrence(today);
  return { planMiss: planMiss.evaluated, anomaly: anomaly.evaluated };
}

export interface OutcomeBucket {
  recovered: number;
  still_missed?: number;
  recurred?: number;
}

export interface EffectivenessSummary {
  plan_miss_projected: { with_task: OutcomeBucket; without_task: OutcomeBucket };
  anomaly_vs_forecast: { with_task: OutcomeBucket; without_task: OutcomeBucket };
}

export async function getEffectivenessSummary(): Promise<EffectivenessSummary> {
  const rows = await alertsRepo.summarizeOutcomes();
  const summary: EffectivenessSummary = {
    plan_miss_projected: { with_task: {}, without_task: {} } as any,
    anomaly_vs_forecast: { with_task: {}, without_task: {} } as any
  };
  for (const r of rows) {
    const bucket = (summary as any)[r.alert_type];
    if (!bucket) continue;
    const key = r.had_task ? 'with_task' : 'without_task';
    bucket[key][r.outcome] = (bucket[key][r.outcome] || 0) + r.cnt;
  }
  return summary;
}
