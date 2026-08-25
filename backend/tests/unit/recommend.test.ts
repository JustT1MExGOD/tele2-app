import { describe, it, expect } from 'vitest';
import { suggestAction } from '../../src/core/alerts/recommend.js';

// 21.0 Recommend — детерминированное правило cause→действие, предзаполняет
// уже существующую форму создания задачи из алерта (Command Center, 18.4).
// Никакого LLM, никакого автовыполнения — человек всё равно решает.
describe('suggestAction', () => {
  it('anomaly_vs_forecast + understaffing — совет про график', () => {
    const s = suggestAction('anomaly_vs_forecast', { possible_causes: [{ type: 'understaffing', detail: 'x' }] });
    expect(s).toContain('график');
  });

  it('anomaly_vs_forecast + shift_gap — совет связаться со сменой', () => {
    const s = suggestAction('anomaly_vs_forecast', { possible_causes: [{ type: 'shift_gap', detail: 'x' }] });
    expect(s).toContain('сменой');
  });

  it('anomaly_vs_forecast + understaffing И shift_gap разом — приоритет understaffing (можно поправить заранее)', () => {
    const s = suggestAction('anomaly_vs_forecast', {
      possible_causes: [{ type: 'shift_gap', detail: 'x' }, { type: 'understaffing', detail: 'y' }]
    });
    expect(s).toContain('график');
  });

  it('anomaly_vs_forecast + только network_wide — намеренно без совета (не локальная причина)', () => {
    const s = suggestAction('anomaly_vs_forecast', { possible_causes: [{ type: 'network_wide', detail: 'x' }] });
    expect(s).toBeNull();
  });

  it('anomaly_vs_forecast без possible_causes вообще (спайк или старый алерт) — null', () => {
    expect(suggestAction('anomaly_vs_forecast', {})).toBeNull();
    expect(suggestAction('anomaly_vs_forecast', { possible_causes: [] })).toBeNull();
  });

  it('plan_miss_projected — совет с конкретными числами прогноза/плана', () => {
    const s = suggestAction('plan_miss_projected', { projectedTotal: 5, planTotal: 20 });
    expect(s).toContain('5');
    expect(s).toContain('20');
  });

  it('неизвестный/старый тип алерта (low_mnp_ratio и т.п.) — null, не выдумываем совет', () => {
    expect(suggestAction('low_mnp_ratio', { sim: 4, mnp: 0 })).toBeNull();
    expect(suggestAction('cash_gap', { delta: 5000 })).toBeNull();
  });
});
