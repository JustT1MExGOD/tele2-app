import pg from 'pg';
import { Gauge } from 'prom-client';
import { metricsRegistry } from '../../platform/observability/metrics.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const transactions = new AsyncLocalStorage<pg.PoolClient>();
// Calendar dates are not instants: keep YYYY-MM-DD throughout SQL/HTTP/CSV.
pg.types.setTypeParser(1082, (value: string) => value);
function setting(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
import { dbQueryDuration, dbQueryErrorsTotal } from '../../platform/observability/metrics.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: setting('PG_POOL_MAX', 8),
  connectionTimeoutMillis: setting('PG_CONNECT_TIMEOUT_MS', 5000),
  statement_timeout: setting('PG_STATEMENT_TIMEOUT_MS', 30000),
  idle_in_transaction_session_timeout: setting('PG_IDLE_TRANSACTION_TIMEOUT_MS', 30000),
  ssl: process.env.PGSSL === 'false' ? false : undefined
});

for (const [name, read] of [
  ['total',()=>pool.totalCount],['idle',()=>pool.idleCount],['waiting',()=>pool.waitingCount]
] as const) new Gauge({name:`db_pool_${name}`,help:`PostgreSQL pool ${name}`,registers:[metricsRegistry],collect(){this.set(read());}});

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
  return timedQuery(() => (transactions.getStore() || pool).query(text, params));
}

/** Nested repository calls join the current transaction through AsyncLocalStorage.
 * Do not start detached asynchronous work inside this callback: await all work. */
export async function withTransaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  if (transactions.getStore()) return fn(query);
  const client = await pool.connect();
  const scopedQuery = ((text: string, params?: any[]) => timedQuery(() => client.query(text, params))) as typeof query;
  try {
    await client.query('BEGIN');
    const result = await transactions.run(client, () => fn(scopedQuery));
    const committed=await client.query('COMMIT');
    if(committed.command !== 'COMMIT') throw new Error('Transaction was rolled back');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export { pool };
