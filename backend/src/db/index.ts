import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

pool.on('connect', (client) => {
  client.query("SET client_encoding TO 'UTF8'").catch(() => {});
});

export async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}