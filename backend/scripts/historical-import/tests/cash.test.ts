import { describe, it, expect } from 'vitest';
import { loadCashPlan } from '../lib/cash.js';

const csv = `record_type,month,date,employee_name,role,employment_status,store,schedule_status,schedule_code_source,schedule_code_normalized,shift_start,shift_end,metric,value,source_file,source_sheet,source_row,source_column,validation_status,notes
cash,2026-04,2026-04-01,,,,Калинина 2,,,,,,cash_1c,111346.0,f.xlsx,s,1,1,OK,
cash,2026-04,2026-04-01,,,,Калинина 2,,,,,,cash_actual,113212.0,f.xlsx,s,1,1,OK,
cash,2026-04,2026-04-01,,,,Калинина 2,,,,,,cash_variance,-134.0,f.xlsx,s,1,1,OK,
cash,2026-04,2026-04-02,,,,Космонавтов 20а,,,,,,cash_1c,5000.0,f.xlsx,s,1,1,OK,
`;

describe('loadCashPlan', () => {
  it('marks a complete cash_1c/cash_actual pair IMPORTABLE, never fabricating cash_variance into a stored column', () => {
    const rows = loadCashPlan(csv);
    const complete = rows.find((r) => r.cashDate === '2026-04-01');
    expect(complete?.category).toBe('IMPORTABLE');
    expect(complete?.cash1c).toBe(111346);
    expect(complete?.cashFact).toBe(113212);
  });

  it('marks an incomplete pair (missing cash_actual) SKIP_WITH_WARNING, never defaulting the missing value to 0', () => {
    const rows = loadCashPlan(csv);
    const incomplete = rows.find((r) => r.cashDate === '2026-04-02');
    expect(incomplete?.category).toBe('SKIP_WITH_WARNING');
    expect(incomplete?.cashFact).toBeNull();
  });
});
