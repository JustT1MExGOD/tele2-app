import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : undefined
});

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

/**
 * Тот же BEGIN/COMMIT/ROLLBACK, что уже есть в db/migrate.ts — первое его
 * переиспользование в прикладном коде (19.23.0, Audit Trail: мутация +
 * запись в audit_log должны либо обе пройти, либо обе откатиться). fn
 * получает query-функцию, привязанную к ОДНОМУ клиенту транзакции — если
 * внутри fn использовать обычный query() (пул), эти вызовы попадут на
 * случайное другое соединение и в транзакции не поучаствуют.
 */
export async function withTransaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const scopedQuery = ((text: string, params?: any[]) => client.query(text, params)) as typeof query;
  try {
    await client.query('BEGIN');
    const result = await fn(scopedQuery);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export { pool };
