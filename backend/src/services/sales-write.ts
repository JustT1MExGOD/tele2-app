/**
 * Единая точка записи продажи — POST /sales, POST /sales/quick и
 * /sync/batch раньше каждый вели свой собственный INSERT ... ON CONFLICT,
 * разошедшийся по деталям: у /sales/quick не было GREATEST(0, ...) (мог
 * уйти в минус), ни /sales/quick, ни /sync/batch не писали sales_audit
 * или sales_events (аудит и heatmap видели только продажи через основной
 * /sales) — то есть один и тот же бизнес-факт по-разному учитывался в
 * зависимости от того, каким путём внесён.
 *
 * Аддитивно (+=, не =) — так и задумано: смысл в "прибавить N ещё", не
 * "задать итог".
 */
import { query } from '../db/index.js';
import { logSaleEvents } from './heatmap.js';

const SAFE_COLUMN = /^[a-z][a-z0-9_]{0,29}$/;

export type SaleSource = 'api' | 'quick' | 'sync';

export type AppliedMetric = { metric: string; value: number };

/**
 * true — ключ свежий, можно применять; false — уже был применён раньше
 * (тот же offline_sync_log/client_id, что и в /sync/batch — теперь
 * доступен и /sales, и /sales/quick: повторный тап "Добавить" или сетевой
 * ретрай с тем же client_id больше не удваивает сумму).
 */
export async function claimIdempotencyKey(
  key: string,
  employeeId: number,
  telegramId: number | null,
  payload: unknown
): Promise<boolean> {
  const res = await query(
    `INSERT INTO offline_sync_log (client_id, employee_id, telegram_id, payload, status)
     VALUES ($1, $2, $3, $4, 'applied')
     ON CONFLICT (client_id) DO NOTHING
     RETURNING id`,
    [key, employeeId, telegramId, JSON.stringify(payload)]
  );
  return !!res.rows[0];
}

export async function applySaleUpsert(opts: {
  employee_id: number;
  store_id: string;
  sale_date: string;
  metrics: Record<string, number>;
  source: SaleSource;
  createdByTelegramId?: number | null;
}): Promise<{ row: any; applied: AppliedMetric[] }> {
  const fields = Object.keys(opts.metrics).filter((k) => {
    const v = Number(opts.metrics[k]);
    return SAFE_COLUMN.test(k) && Number.isFinite(v) && v !== 0;
  });
  if (!fields.length) return { row: null, applied: [] };

  const insertCols = ['employee_id', 'store_id', 'sale_date', ...fields];
  const insertVals: any[] = [
    opts.employee_id,
    opts.store_id,
    opts.sale_date,
    ...fields.map((f) => Number(opts.metrics[f]))
  ];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`);
  const setParts = fields.map((f) => `${f} = GREATEST(0, sales.${f} + EXCLUDED.${f})`);
  setParts.push('updated_at = now()');

  const res = await query(
    `INSERT INTO sales (${insertCols.join(',')})
     VALUES (${placeholders.join(',')})
     ON CONFLICT (employee_id, store_id, sale_date)
     DO UPDATE SET ${setParts.join(', ')}
     RETURNING *`,
    insertVals
  );
  const row = res.rows[0];
  const applied: AppliedMetric[] = fields.map((f) => ({ metric: f, value: Number(opts.metrics[f]) }));

  try {
    for (const a of applied) {
      await query(
        `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [opts.employee_id, opts.store_id, opts.sale_date, a.metric, a.value, opts.source, opts.createdByTelegramId || null]
      );
    }
  } catch (_) {}

  try {
    const metrics: Record<string, number> = {};
    for (const a of applied) metrics[a.metric] = a.value;
    await logSaleEvents({
      employee_id: opts.employee_id,
      store_id: opts.store_id,
      sale_date: opts.sale_date,
      metrics,
      source: opts.source
    });
  } catch (e) {
    console.warn('sales_events log failed:', (e as any)?.message || e);
  }

  return { row, applied };
}
