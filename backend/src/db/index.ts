import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Принудительно ставим UTF-8 при каждом подключении
pool.on('connect', async (client) => {
  await client.query("SET client_encoding TO 'UTF8'");
});

export async function query(text: string, params?: any[]) {
  const result = await pool.query(text, params);
  return result;
}

export async function testConnection() {
  const res = await query('SELECT id, code, name FROM stores ORDER BY hours');
  console.log('Точки из базы:');
  console.table(res.rows);
  return res.rows;
}
