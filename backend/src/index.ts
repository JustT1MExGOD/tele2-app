import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from './db/index.js';
import { startBot } from './bot/index.js';
import { startReportCron } from './cron/report.js';
import { todayMoscow } from './utils/date.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Ищем папку frontend в нескольких местах (локально и на Railway)
function findFrontendDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'frontend'),           // /app/frontend
    path.join(process.cwd(), '../frontend'),         // monorepo
    path.join(__dirname, '../frontend'),             // dist -> backend/frontend
    path.join(__dirname, '../../frontend'),          // dist -> tele2-app/frontend
    path.join(__dirname, '../public'),
    path.join(process.cwd(), 'public'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
      console.log('Frontend found:', dir);
      return dir;
    }
  }
  console.warn('Frontend folder not found, static files disabled');
  return null;
}

const frontendDir = findFrontendDir();
if (frontendDir) {
  await app.register(fastifyStatic, {
    root: frontendDir,
    prefix: '/',
  });
}

app.get('/health', async () => {
  return { status: 'ok', time: new Date().toISOString() };
});

app.get('/stores', async () => {
  const res = await query('SELECT * FROM stores ORDER BY hours');
  return res.rows;
});

app.get('/employees', async () => {
  const res = await query(
    'SELECT id, full_name, short_name FROM employees WHERE is_active = true ORDER BY id'
  );
  return res.rows;
});

app.get('/sales', async (request) => {
  const { date } = request.query as { date?: string };
  const saleDate = date || todayMoscow();;

  const res = await query(
    `SELECT s.*, e.full_name, st.name as store_name
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     JOIN stores st ON st.id = s.store_id
     WHERE s.sale_date = $1
     ORDER BY e.full_name`,
    [saleDate]
  );
  return res.rows;
});

app.post('/sales', async (request) => {
  const body = request.body as any;
  const { employee_id, store_id, sale_date, ...metrics } = body;

  const fields = [
    'sim','mnp','pa','combo','settings','accessories','insurance',
    'phones','wink','shpd','focus','credit_request','credit_issued','plotter','hb'
  ];

  // берём только переданные метрики
  const setParts: string[] = [];
  const insertCols = ['employee_id', 'store_id', 'sale_date'];
  const insertVals: any[] = [employee_id, store_id, sale_date];
  const placeholders = ['$1', '$2', '$3'];
  let i = 4;

  for (const f of fields) {
    if (metrics[f] !== undefined && metrics[f] !== null) {
      insertCols.push(f);
      insertVals.push(Number(metrics[f]) || 0);
      placeholders.push('$' + i);
      setParts.push(`${f} = sales.${f} + EXCLUDED.${f}`);
      i++;
    }
  }

  setParts.push('updated_at = now()');

  const sql = `
    INSERT INTO sales (${insertCols.join(',')})
    VALUES (${placeholders.join(',')})
    ON CONFLICT (employee_id, store_id, sale_date)
    DO UPDATE SET ${setParts.join(', ')}
    RETURNING *
  `;

  const res = await query(sql, insertVals);
  return res.rows[0];
});

app.get('/schedules', async (request) => {
  const { date } = request.query as { date?: string };
  const workDate = date || todayMoscow();;

  const res = await query(
    `SELECT sch.*, e.full_name, st.name as store_name
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date = $1
     ORDER BY st.hours, e.full_name`,
    [workDate]
  );
  return res.rows;
});

app.post('/schedules', async (request) => {
  const body = request.body as any;
  const { employee_id, store_id, work_date, shift_text, hours } = body;

  const res = await query(
    `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, work_date)
     DO UPDATE SET
       store_id = EXCLUDED.store_id,
       shift_text = EXCLUDED.shift_text,
       hours = EXCLUDED.hours
     RETURNING *`,
    [employee_id, store_id, work_date, shift_text, hours]
  );
  return res.rows[0];
});

app.get('/plans', async () => {
  const res = await query(`
    SELECT store_id, plan_date,
           sim, mnp, pa, combo, settings, accessories, insurance,
           phones, wink, shpd, focus, credit_request, credit_issued
    FROM store_plans
    WHERE plan_date IS NULL
    ORDER BY store_id
  `);
  return res.rows;
});

// ===== ВАЖНО: порт и host =====
const port = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Сервер запущен на 0.0.0.0:${port}`);

  // Бот не должен ронять весь сервер
  startBot().catch((err) => {
    console.error('Бот не запустился:', err.message || err);
  });

  startReportCron();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}