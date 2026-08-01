import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : undefined
});

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

export { pool };
