import { describe, it, expect } from 'vitest';
import { buildSesModel, projectDay } from '../../src/services/forecast.js';

// 19.1 Forecast v2 — числовая сердцевина, вынесенная из трёх раньше
// раздельных копий (forecastStore, forecastRemainingOfMonth, и до этой
// правки задел под BFQ). Регресс-гварды на баги, уже однажды найденные
// визуальной проверкой в одной из копий, но не в других.
describe('buildSesModel / projectDay', () => {
  it('пустая история — уровень 0, прогноз 0 на любой день', () => {
    const model = buildSesModel([]);
    expect(model.level).toBe(0);
    expect(projectDay(model, 1)).toBe(0);
  });

  it('холодный старт на денежной метрике (тысячи) не взрывается после серии нулей', () => {
    // Раньше (баг, найденный визуально): level стартовал с rows[0], и
    // первый ненулевой день после нулей делил сам себя на фолбэк "1",
    // разгоняя ratio до десятков тысяч. Здесь — 20 нулевых дней, потом
    // один день на 5000 (правдоподобная выручка "Телефоны").
    const rows = Array.from({ length: 20 }, (_, i) => ({ dow: i % 7, value: 0 }));
    rows.push({ dow: 0, value: 5000 });
    const model = buildSesModel(rows);
    // Клэмп ratio <= 10 гарантирует, что ни один сезонный коэффициент не
    // может быть безумно большим независимо от масштаба метрики.
    for (const dow of Object.keys(model.seasonal)) {
      expect(model.seasonal[Number(dow)]).toBeLessThan(11);
    }
    expect(Number.isFinite(model.level)).toBe(true);
    expect(projectDay(model, 0)).toBeGreaterThanOrEqual(0);
  });

  it('явные нули между продажами тянут сглаженный уровень вниз, а не застревают на старом пике', () => {
    // 10 дней подряд по 100, затем 10 дней подряд по 0 (гап-филл) — если
    // бы нули молча пропускались (старый баг), уровень остался бы у 100.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ dow: i % 7, value: 100 })),
      ...Array.from({ length: 10 }, (_, i) => ({ dow: i % 7, value: 0 }))
    ];
    const model = buildSesModel(rows);
    expect(model.level).toBeLessThan(50);
  });

  it('один экстремальный день не определяет сезонный коэффициент дня недели целиком', () => {
    // Будни стабильно ~10, но один конкретный будний день внезапно 100 —
    // без клэмпа его ratio (~10x) мог бы один утащить сезонный
    // коэффициент этого дня недели далеко от соседних дней.
    const rows: { dow: number; value: number }[] = [];
    for (let week = 0; week < 8; week++) {
      for (let dow = 1; dow <= 5; dow++) {
        rows.push({ dow, value: dow === 3 && week === 7 ? 1000 : 10 });
      }
    }
    const model = buildSesModel(rows);
    // Соседние будние дни (без выброса) должны остаться в разумных пределах
    // около нейтрального 1.0, не утянутые в сторону выбросом дня 3.
    expect(model.seasonal[1]).toBeLessThan(3);
    expect(model.seasonal[5]).toBeLessThan(3);
  });

  it('projectDay никогда не уходит в отрицательные числа', () => {
    const model = buildSesModel([{ dow: 1, value: 5 }]);
    for (let dow = 0; dow <= 6; dow++) {
      expect(projectDay(model, dow)).toBeGreaterThanOrEqual(0);
    }
  });

  // 19.2 Anomaly Detection — spread/sampleCount кормят z-score в
  // services/anomaly.ts, регресс на то, что они вообще осмысленные.
  it('spread у идеально ровной истории близок к нулю (стабильная точка)', () => {
    const rows = Array.from({ length: 56 }, (_, i) => ({ dow: i % 7, value: 10 }));
    const model = buildSesModel(rows);
    for (let dow = 0; dow <= 6; dow++) {
      expect(model.spread[dow]).toBeLessThan(0.1);
    }
  });

  it('spread у шумной истории заметно выше, чем у ровной', () => {
    const stable = Array.from({ length: 56 }, (_, i) => ({ dow: i % 7, value: 10 }));
    // Тот же день недели (dow=1), но значения скачут 2..18 вместо ровных 10.
    const noisy = Array.from({ length: 56 }, (_, i) => ({
      dow: i % 7,
      value: i % 7 === 1 ? (i % 2 === 0 ? 2 : 18) : 10
    }));
    const stableModel = buildSesModel(stable);
    const noisyModel = buildSesModel(noisy);
    expect(noisyModel.spread[1]).toBeGreaterThan(stableModel.spread[1]);
  });

  it('sampleCount считает все обработанные наблюдения на день недели, включая гап-филл-нули', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ dow: i % 7, value: i < 14 ? 5 : 0 }));
    const model = buildSesModel(rows);
    // 21 день / 7 дней недели = 3 наблюдения на каждый dow.
    for (let dow = 0; dow <= 6; dow++) {
      expect(model.sampleCount[dow]).toBe(3);
    }
  });
});
