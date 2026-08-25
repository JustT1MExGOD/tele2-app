import { describe, it, expect } from 'vitest';
import { projectEndOfDay } from '../../src/core/analytics/insights.js';

// 21.0 Predict — чистая функция экстраполяции "факт-сейчас → итог дня" по
// типичной внутридневной форме (store_hour_profile). Общая точка входа для
// buildShiftInsight (сотрудник) и plan_miss_projected (точка, core/alerts/
// service.ts) — тестируем один раз здесь, не дублируем по потребителям.
describe('projectEndOfDay', () => {
  // Равномерные веса 10..21 (12 часов), "сейчас" 16:00 — прошло 6 часов из 12 = 50%.
  const uniformWeights = Array.from({ length: 12 }, (_, i) => ({ hour: 10 + i, weight: 1 }));

  it('нет данных о весах — null (не выдумываем прогноз без формы дня)', () => {
    expect(projectEndOfDay([], 16, 50, 100)).toBeNull();
  });

  it('все веса нулевые — null (totalWeight <= 0)', () => {
    const weights = [{ hour: 10, weight: 0 }, { hour: 11, weight: 0 }];
    expect(projectEndOfDay(weights, 16, 50, 100)).toBeNull();
  });

  it('слишком рано (< MIN_FRACTION_DONE) — null, не единичная продажа выдаёт "прогноз"', () => {
    // 10:00, только 1 час из 12 прошёл (~8%) — ниже гейта 15%.
    const result = projectEndOfDay(uniformWeights, 10, 5, 100);
    expect(result).toBeNull();
  });

  it('на темпе плана — onTrack true, проекция ~ план', () => {
    // 16:00: elapsed = часы 10..15 = 6 из 12 = 50%. factTotal=50 → projected=100.
    const result = projectEndOfDay(uniformWeights, 16, 50, 100);
    expect(result).not.toBeNull();
    expect(result!.fractionDone).toBe(0.5);
    expect(result!.projectedTotal).toBe(100);
    expect(result!.onTrack).toBe(true);
  });

  it('заметно ниже темпа — onTrack false', () => {
    // Тот же час, но втрое меньше факта — projected=60 против плана 100 (порог 90).
    const result = projectEndOfDay(uniformWeights, 16, 30, 100);
    expect(result!.projectedTotal).toBe(60);
    expect(result!.onTrack).toBe(false);
  });

  it('чуть ниже плана — всё ещё onTrack (допуск ON_TRACK_TOLERANCE)', () => {
    // projected = 95% плана — в пределах 90%-допуска, не считаем "не выйдет".
    const result = projectEndOfDay(uniformWeights, 16, 47.5, 100);
    expect(result!.projectedTotal).toBe(95);
    expect(result!.onTrack).toBe(true);
  });

  it('неравномерные веса (пик вечером) — тот же час даёт другую fractionDone', () => {
    // Пик после 18: часы 10-17 вес 1 (8ч), 18-21 вес 3 (4ч) → total=8+12=20.
    const weights = [
      ...Array.from({ length: 8 }, (_, i) => ({ hour: 10 + i, weight: 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ hour: 18 + i, weight: 3 }))
    ];
    // К 18:00 прошло 8 часов веса 1 = 8 из 20 = 40% (не 8/12=67%, как было бы равномерно).
    const result = projectEndOfDay(weights, 18, 40, 100);
    expect(result!.fractionDone).toBe(0.4);
    expect(result!.projectedTotal).toBe(100);
  });
});
