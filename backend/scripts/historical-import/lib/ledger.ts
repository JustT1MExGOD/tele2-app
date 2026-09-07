import { query } from '../../../src/data/db/index.js';

export type LedgerEntity = 'sales' | 'schedules' | 'employee_month_plans' | 'store_cash' | 'employees';
export type LedgerOperation = 'insert' | 'update';

export interface LedgerRecord {
  batchId: string;
  entity: LedgerEntity;
  naturalKey: Record<string, unknown>;
  operation: LedgerOperation;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
  sourceRow: Record<string, unknown>;
}

/**
 * Records one applied write to import_ledger. Must be called inside the
 * SAME transaction as the actual business write (withTransaction) so the
 * ledger entry and the write commit/rollback atomically together — an
 * apply that fails partway must never leave an orphaned ledger row or an
 * unrecorded write.
 */
export async function recordLedgerEntry(rec: LedgerRecord): Promise<void> {
  await query(
    `INSERT INTO import_ledger (batch_id, entity, natural_key, operation, before_state, after_state, source_row)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      rec.batchId,
      rec.entity,
      JSON.stringify(rec.naturalKey),
      rec.operation,
      rec.beforeState ? JSON.stringify(rec.beforeState) : null,
      JSON.stringify(rec.afterState),
      JSON.stringify(rec.sourceRow),
    ]
  );
}

/**
 * Rolls back a batch: for each ledger row (most recent first, per natural
 * key), restores before_state (update) or deletes the row (insert) — only
 * if the row's CURRENT state still matches after_state (optimistic
 * concurrency: refuses to clobber a real edit made after the import).
 * Returns counts so a partial/blocked rollback is never silently reported
 * as complete.
 */
export interface RollbackResult {
  restored: number;
  deleted: number;
  skippedConcurrentEdit: number;
}

const TABLE_BY_ENTITY: Record<LedgerEntity, string> = {
  sales: 'sales',
  schedules: 'schedules',
  employee_month_plans: 'employee_month_plans',
  store_cash: 'store_cash',
  employees: 'employees',
};

export async function rollbackBatch(batchId: string): Promise<RollbackResult> {
  const result: RollbackResult = { restored: 0, deleted: 0, skippedConcurrentEdit: 0 };
  const { rows } = await query(
    `SELECT id, entity, natural_key, operation, before_state, after_state
     FROM import_ledger
     WHERE batch_id = $1 AND rolled_back_at IS NULL
     ORDER BY id DESC`,
    [batchId]
  );

  for (const row of rows) {
    const table = TABLE_BY_ENTITY[row.entity as LedgerEntity];
    if (!table) continue;
    const naturalKey = row.natural_key as Record<string, unknown>;
    const afterState = row.after_state as Record<string, unknown>;
    const beforeState = row.before_state as Record<string, unknown> | null;

    const keyCols = Object.keys(naturalKey);
    const whereKey = keyCols.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
    const keyVals = keyCols.map((c) => naturalKey[c]);

    const current = await query(`SELECT * FROM ${table} WHERE ${whereKey}`, keyVals);
    const currentRow = current.rows[0];

    const matchesAfter = currentRow && Object.keys(afterState).every(
      (c) => String(currentRow[c]) === String(afterState[c])
    );
    if (row.operation === 'insert') {
      if (!currentRow) continue; // already gone
      if (!matchesAfter) {
        result.skippedConcurrentEdit += 1;
        continue;
      }
      await query(`DELETE FROM ${table} WHERE ${whereKey}`, keyVals);
      result.deleted += 1;
    } else {
      if (!currentRow || !beforeState) continue;
      if (!matchesAfter) {
        result.skippedConcurrentEdit += 1;
        continue;
      }
      const setCols = Object.keys(beforeState);
      const setClause = setCols.map((c, i) => `${c} = $${i + 1 + keyCols.length}`).join(', ');
      await query(
        `UPDATE ${table} SET ${setClause} WHERE ${whereKey}`,
        [...keyVals, ...setCols.map((c) => beforeState[c])]
      );
      result.restored += 1;
    }
    await query(`UPDATE import_ledger SET rolled_back_at = now() WHERE id = $1`, [row.id]);
  }
  return result;
}
