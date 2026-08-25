import pg from 'pg';
import { dbQueryDuration, dbQueryErrorsTotal } from '../../platform/observability/metrics.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : undefined
});

/** Замеряет длительность/ошибки любого раунд-трипа к Postgres, каким бы
 * клиентом он ни выполнялся (пул напрямую или клиент транзакции внутри
 * withTransaction ниже) — единственная точка, через которую физически идут
 * все запросы. Агрегатно (без лейбла по домену/операции) — см. комментарий
 * в metrics.ts о том, почему per-repository разбивка отложена. */
async function timedQuery<T>(exec: () => Promise<T>): Promise<T> {
  const end = dbQueryDuration.startTimer();
  try {
    const result = await exec();
    end();
    return result;
  } catch (e) {
    end();
    dbQueryErrorsTotal.inc();
    throw e;
  }
}

export async function query(text: string, params?: any[]) {
  return timedQuery(() => pool.query(text, params));
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
  const scopedQuery = ((text: string, params?: any[]) => timedQuery(() => client.query(text, params))) as typeof query;
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
