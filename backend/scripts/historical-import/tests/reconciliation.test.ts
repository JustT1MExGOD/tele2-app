import { describe, it, expect } from 'vitest';
import { loadDailyFacts } from '../lib/daily-facts.js';
import { recomputeReconciliation } from '../lib/reconciliation.js';

const dailyFactsCsv = `record_type,month,date,employee_name,role,employment_status,store,schedule_status,schedule_code_source,schedule_code_normalized,shift_start,shift_end,metric,value,source_file,source_sheet,source_row,source_column,validation_status,notes
daily_fact,2026-05,2026-05-01,Тест Тестов Тестович,продавец,,,,,,,,SIM,3.0,f.xlsx,s,1,1,OK,
daily_fact,2026-05,2026-05-02,Тест Тестов Тестович,продавец,,,,,,,,SIM,4.0,f.xlsx,s,1,1,OK,
daily_fact,2026-05,2026-05-01,Тест Тестов Тестович,продавец,,,,,,,,Комбо,1.0,f.xlsx,s,1,1,OK,
`;

const monthlyActualsCsv = `record_type,month,date,employee_name,role,employment_status,store,schedule_status,schedule_code_source,schedule_code_normalized,shift_start,shift_end,metric,value,source_file,source_sheet,source_row,source_column,validation_status,notes
monthly_actual_source,2026-05,,Тест Тестов Тестович,продавец,,,,,,,,Sim,7.0,f.xlsx,s,1,1,OK,
monthly_actual_source,2026-05,,Тест Тестов Тестович,продавец,,,,,,,,Combo,1.0,f.xlsx,s,1,1,OK,
monthly_actual_source,2026-05,,Тест Тестов Тестович,продавец,,,,,,,,wink,999.0,f.xlsx,s,1,1,OK,
`;

describe('recomputeReconciliation (canonicalization fix)', () => {
  it('joins SIM (daily_facts literal) against Sim (monthly_actuals literal) as the same metric — PASS, not a false NO_DAILY_DATA', () => {
    const facts = loadDailyFacts(dailyFactsCsv);
    const recon = recomputeReconciliation(monthlyActualsCsv, facts);
    const simRow = recon.find((r) => r.metricId === 'sim');
    expect(simRow?.status).toBe('PASS');
    expect(simRow?.dailySum).toBe(7);
  });

  it('joins Комбо against Combo the same way', () => {
    const facts = loadDailyFacts(dailyFactsCsv);
    const recon = recomputeReconciliation(monthlyActualsCsv, facts);
    const comboRow = recon.find((r) => r.metricId === 'combo');
    expect(comboRow?.status).toBe('PASS');
  });

  it('a metric with a genuine monthly-only source (no matching daily rows at all) is TRUE_NO_DAILY_DATA, not silently dropped', () => {
    const facts = loadDailyFacts(dailyFactsCsv);
    const recon = recomputeReconciliation(monthlyActualsCsv, facts);
    const winkRow = recon.find((r) => r.metricId === 'wink');
    expect(winkRow?.status).toBe('TRUE_NO_DAILY_DATA');
    expect(winkRow?.dailySum).toBeNull();
  });
});
