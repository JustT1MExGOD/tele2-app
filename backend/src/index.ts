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
  const saleDate = date || new Date().toISOString().slice(0, 10);

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
  const {
    employee_id,
    store_id,
    sale_date,
    sim = 0, mnp = 0, pa = 0, combo = 0,
    settings = 0, accessories = 0, insurance = 0, phones = 0,
    wink = 0, shpd = 0, focus = 0,
    credit_request = 0, credit_issued = 0,
    plotter = 0, hb = 0,
  } = body;

  const res = await query(
    `INSERT INTO sales (
      employee_id, store_id, sale_date,
      sim, mnp, pa, combo, settings, accessories, insurance, phones,
      wink, shpd, focus, credit_request, credit_issued, plotter, hb
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (employee_id, store_id, sale_date)
    DO UPDATE SET
      sim = EXCLUDED.sim, mnp = EXCLUDED.mnp, pa = EXCLUDED.pa,
      combo = EXCLUDED.combo, settings = EXCLUDED.settings,
      accessories = EXCLUDED.accessories, insurance = EXCLUDED.insurance,
      phones = EXCLUDED.phones, wink = EXCLUDED.wink, shpd = EXCLUDED.shpd,
      focus = EXCLUDED.focus, credit_request = EXCLUDED.credit_request,
      credit_issued = EXCLUDED.credit_issued, plotter = EXCLUDED.plotter,
      hb = EXCLUDED.hb, updated_at = now()
    RETURNING *`,
    [
      employee_id, store_id, sale_date,
      sim, mnp, pa, combo, settings, accessories, insurance, phones,
      wink, shpd, focus, credit_request, credit_issued, plotter, hb,
    ]
  );
  return res.rows[0];
});

app.get('/schedules', async (request) => {
  const { date } = request.query as { date?: string };
  const workDate = date || new Date().toISOString().slice(0, 10);

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