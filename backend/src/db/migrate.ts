/**
 * Минимальная система миграций — пронумерованные .sql в sql/migrations/,
 * трекинг в schema_migrations. Раньше схема правилась ad hoc SQL прямо на
 * Railway без какого-либо трекинга (см. sql/*.sql за весь сеанс) — CI
 * (эпик 17.0) держался на ручном перегенерировании sql/ci-schema.sql,
 * которое легко забыть после следующего изменения схемы. Теперь: новый
 * файл в sql/migrations/, дальше применяется сам — и на CI/локальном
 * тесте (npm run migrate), и на проде (автоматически при старте сервера,
 * см. index.ts).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findMigrationsDir(): string {
  const candidates = [
    path.join(process.cwd(), '../sql/migrations'),
    path.join(process.cwd(), 'sql/migrations'),
    path.join(__dirname, '../../../sql/migrations'),
    path.join(__dirname, '../../sql/migrations')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error('sql/migrations не найдена ни по одному из ожидаемых путей');
}

export async function runMigrations(): Promise<{ applied: string[] }> {
  const dir = findMigrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // public. — намеренно схема-квалифицировано везде ниже: pg_dump в
    // 0001_baseline.sql сбрасывает search_path на '' на весь сеанс
    // соединения (set_config('search_path', '', false) — не транзакционно,
    // переживает COMMIT), и без явной схемы наш собственный SQL после
    // применения такой миграции перестаёт находить свои же таблицы.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id serial PRIMARY KEY,
        name text UNIQUE NOT NULL,
        applied_at timestamptz DEFAULT now()
      )
    `);

    const doneRes = await client.query(`SELECT name FROM public.schema_migrations`);
    const done = new Set(doneRes.rows.map((r: any) => r.name as string));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO public.schema_migrations (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (e: any) {
        await client.query('ROLLBACK');
        throw new Error(`Миграция ${file} упала: ${e?.message || e}`);
      }
    }
  } finally {
    client.release();
  }
  return { applied };
}
