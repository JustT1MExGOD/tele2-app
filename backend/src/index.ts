import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { query } from './db/index.js';
import { startBot, notifyChat } from './bot/index.js';
import { startReportCron } from './cron/reports.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
import { registerV3Routes } from './routes-v3.js';
import { registerPlansV5Routes } from './routes-plans-v5.js';
import { registerV8Routes } from './routes-v8.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

function findFrontendDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'frontend'),
    path.join(process.cwd(), '../frontend'),
    path.join(__dirname, '../frontend'),
    path.join(__dirname, '../../frontend'),
    path.join(process.cwd(), 'public'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      console.log('Frontend found:', dir);
      return dir;
    }
  }
  console.warn('Frontend not found');
  return null;
}

const frontendDir = findFrontendDir();
if (frontendDir) {
  await app.register(fastifyStatic, { root: frontendDir, prefix: '/' });
}

// ===== HEALTH =====
app.get('/health', async () => ({
  status: 'ok',
  time: new Date().toISOString(),
  today: todayMoscow(),
}));

// ===== STORES =====
app.get('/stores', async () => {
  const res = await query('SELECT * FROM stores ORDER BY hours');
  return res.rows;
});

// ===== PLANS =====
// ?date=YYYY-MM-DD → дневные планы на дату (если есть), иначе шаблон plan_date IS NULL
app.get('/plans', async (request) => {
  const { date } = (request.query || {}) as { date?: string };
  if (date) {
    const day = await query(
      `SELECT store_id, plan_date,
              sim, mnp, pa, combo, settings, accessories, insurance,
              phones, wink, shpd, focus, credit_request, credit_issued, plotter, hb
       FROM store_plans
       WHERE plan_date = $1
       ORDER BY store_id`,
      [date]
    );
    if (day.rows.length) return day.rows;
  }
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

// ===== EMPLOYEES =====
app.get('/employees', async () => {
  const res = await query(
    `SELECT id, full_name, short_name, telegram_id, is_active, role
     FROM employees
     WHERE is_active = true
     ORDER BY id`
  );
  return res.rows;
});

// ===== SALES =====
app.get('/sales', async (request) => {
  const { date } = request.query as { date?: string };
  const saleDate = date || todayMoscow();

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

// Прибавление метрик, без обнуления остальных
app.post('/sales', async (request, reply) => {
  const body = request.body as any;
  const employee_id = Number(body.employee_id);
  const store_id = body.store_id;
  const sale_date = body.sale_date || todayMoscow();

  if (!employee_id || !store_id) {
    return reply.code(400).send({ error: 'employee_id and store_id required' });
  }

  const fields = [
    'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
    'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued', 'plotter', 'hb',
  ];

  const insertCols = ['employee_id', 'store_id', 'sale_date'];
  const insertVals: any[] = [employee_id, store_id, sale_date];
  const placeholders = ['$1', '$2', '$3'];
  const setParts: string[] = [];
  let i = 4;

  for (const f of fields) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
      insertCols.push(f);
      insertVals.push(Number(body[f]) || 0);
      placeholders.push('$' + i);
      setParts.push(`${f} = sales.${f} + EXCLUDED.${f}`);
      i++;
    }
  }

  if (setParts.length === 0) {
    return reply.code(400).send({ error: 'no metrics' });
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
  const row = res.rows[0];

  // audit
  try {
    const metric = fields.find((f) => body[f] !== undefined && body[f] !== null && body[f] !== '');
    if (metric) {
      await query(
        `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source)
         VALUES ($1, $2, $3, $4, $5, 'api')`,
        [employee_id, store_id, sale_date, metric, Number(body[metric]) || 0]
      );
    }
  } catch (_) {}

  // уведомление в чат
  try {
    const info = await query(
      `SELECT e.full_name, st.name as store_name
       FROM employees e, stores st
       WHERE e.id = $1 AND st.id = $2`,
      [employee_id, store_id]
    );
    const metric = fields.find((f) => body[f] !== undefined && body[f] !== null);
    if (metric && info.rows[0]) {
      const names: Record<string, string> = {
        sim: 'SIM', mnp: 'MNP', pa: 'ПА', combo: 'Комбо', phones: 'Телефон',
        accessories: 'Аксессуары', insurance: 'Страховки', wink: 'Wink',
        shpd: 'ШПД', focus: 'ФО', plotter: 'Плоттер', hb: 'HB',
      };
      await notifyChat(
        `${info.rows[0].full_name} сделал продажу: ${body[metric]} ${names[metric] || metric} на ${info.rows[0].store_name}`
      );
    }
  } catch (_) {}

  return row;
});

// ===== SCHEDULES =====
app.get('/schedules', async (request) => {
  const { date } = request.query as { date?: string };
  const workDate = date || todayMoscow();

  const res = await query(
    `SELECT sch.*, e.full_name, st.name as store_name, st.short_name as store_short
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

app.get('/schedules/month', async (request) => {
  const { month } = request.query as { month?: string };
  const m = month || currentMonthMoscow();
  const start = `${m}-01`;
  const endDate = new Date(`${m}-01T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);

  const res = await query(
    `SELECT sch.work_date, sch.shift_text, sch.hours, sch.store_id,
            e.id as employee_id, e.full_name, e.short_name,
            st.name as store_name, st.short_name as store_short
     FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     LEFT JOIN stores st ON st.id = sch.store_id
     WHERE sch.work_date >= $1 AND sch.work_date < $2
     ORDER BY e.full_name, sch.work_date`,
    [start, end]
  );

  return { month: m, start, end, items: res.rows };
});

// ===== STATS =====
app.get('/stats/daily', async (request) => {
  const { date } = request.query as { date?: string };
  const d = date || todayMoscow();

  const res = await query(
    `SELECT
       st.id as store_id,
       st.name,
       st.code,
       COALESCE(SUM(s.sim),0) as sim,
       COALESCE(SUM(s.mnp),0) as mnp,
       COALESCE(SUM(s.pa),0) as pa,
       COALESCE(SUM(s.combo),0) as combo,
       COALESCE(SUM(s.settings),0) as settings,
       COALESCE(SUM(s.accessories),0) as accessories,
       COALESCE(SUM(s.insurance),0) as insurance,
       COALESCE(SUM(s.phones),0) as phones,
       COALESCE(SUM(s.wink),0) as wink,
       COALESCE(SUM(s.shpd),0) as shpd,
       COALESCE(SUM(s.focus),0) as focus,
       COALESCE(SUM(s.credit_request),0) as credit_request,
       COALESCE(SUM(s.credit_issued),0) as credit_issued
     FROM stores st
     LEFT JOIN sales s ON s.store_id = st.id AND s.sale_date = $1
     GROUP BY st.id, st.name, st.code, st.hours
     ORDER BY st.hours`,
    [d]
  );
  return res.rows;
});

// ===== EMPLOYEE PROGRESS =====
app.get('/employee/progress/:id', async (request) => {
  const { id } = request.params as { id: string };
  const { date } = request.query as { date?: string };
  const d = date || todayMoscow();

  const sch = await query(
    `SELECT store_id FROM schedules WHERE employee_id = $1 AND work_date = $2 LIMIT 1`,
    [id, d]
  );
  const storeId = sch.rows[0]?.store_id;

  let plan: any = {};
  if (storeId) {
    const planRes = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
      [storeId]
    );
    plan = planRes.rows[0] || {};
  }

  const factRes = await query(
    `SELECT
       COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
       COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
       COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories
     FROM sales WHERE employee_id = $1 AND sale_date = $2`,
    [id, d]
  );
  const fact = factRes.rows[0] || {};

  const keys = ['sim', 'mnp', 'pa', 'combo', 'phones'] as const;
  const result: any = {};
  let totalFact = 0;
  let totalPlan = 0;

  for (const k of keys) {
    const f = Number(fact[k]) || 0;
    const p = Number(plan[k]) || 0;
    result[k] = { fact: f, plan: p };
    totalFact += f;
    totalPlan += p;
  }

  result.total = {
    fact: totalFact,
    plan: totalPlan,
    percent: totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0,
  };

  return result;
});

// ===== V3: /me, /bfq, bulk schedule, history, export =====
// НЕ дублируй /me и /bfq здесь — они внутри registerV3Routes
await registerV3Routes(app);

// ===== Plans v5: месячные / дневные планы точек =====
try {
  await registerPlansV5Routes(app);
  console.log('✅ Plans routes registered');
} catch (e: any) {
  console.error('Plans routes failed:', e?.message || e);
}

// ===== V8: /access/status, /access/request, заявки =====
try {
  await registerV8Routes(app);
  console.log('✅ Access (v8) routes registered');
} catch (e: any) {
  console.error('V8 routes failed:', e?.message || e);
}

// ===== START =====
const port = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Сервер на 0.0.0.0:${port}`);
  console.log(`📅 Сегодня (МСК): ${todayMoscow()}`);

  startBot().catch((e) => console.error('Bot failed:', e.message || e));
  startReportCron();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
