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
import { registerSupportRoutes } from './routes-support.js';
import { registerV13Routes } from './routes-v13.js';
import { registerV14Routes } from './routes-v14.js';
import { logSaleEvents } from './services/heatmap.js';
import { runSmartAlertsTick } from './services/alerts.js';

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

// Прибавление метрик (+ правка через delta отрицательный)
app.post('/sales', async (request, reply) => {
  const body = request.body as any;
  const employee_id = Number(body.employee_id);
  const store_id = body.store_id;
  const sale_date = body.sale_date || todayMoscow();

  if (!employee_id || !store_id) {
    return reply.code(400).send({ error: 'employee_id and store_id required' });
  }

  // employee может писать только за себя; manager/admin — за всех
  const tg =
    (request.headers['x-telegram-id'] as string) ||
    (request.headers['x-telegram-user-id'] as string);
  if (tg) {
    const me = await query(
      `SELECT id, role FROM employees WHERE telegram_id = $1::bigint LIMIT 1`,
      [Number(tg)]
    );
    const u = me.rows[0];
    if (u) {
      const role = u.role || 'employee';
      if (role !== 'manager' && role !== 'admin' && Number(u.id) !== employee_id) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Можно вносить продажи только за себя'
        });
      }
    }
  }

  const fields = [
    'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
    'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued', 'plotter', 'hb',
  ];

  const insertCols = ['employee_id', 'store_id', 'sale_date'];
  const insertVals: any[] = [employee_id, store_id, sale_date];
  const placeholders = ['$1', '$2', '$3'];
  const setParts: string[] = [];
  const applied: { metric: string; value: number }[] = [];
  let i = 4;

  for (const f of fields) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
      const val = Number(body[f]) || 0;
      insertCols.push(f);
      insertVals.push(val);
      placeholders.push('$' + i);
      // GREATEST чтобы не уйти в минус при корректировке
      setParts.push(`${f} = GREATEST(0, sales.${f} + EXCLUDED.${f})`);
      applied.push({ metric: f, value: val });
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

  try {
    for (const a of applied) {
      await query(
        `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
         VALUES ($1, $2, $3, $4, $5, 'api', $6)`,
        [employee_id, store_id, sale_date, a.metric, a.value, tg ? Number(tg) : null]
      );
    }
  } catch (_) {}

  // v14: час МСК → sales_events для heatmap
  try {
    const metrics: Record<string, number> = {};
    for (const a of applied) metrics[a.metric] = a.value;
    await logSaleEvents({
      employee_id,
      store_id,
      sale_date,
      metrics,
      source: 'api'
    });
  } catch (e) {
    console.warn('sales_events log failed:', (e as any)?.message || e);
  }

  try {
    const info = await query(
      `SELECT e.full_name, st.name as store_name
       FROM employees e, stores st
       WHERE e.id = $1 AND st.id = $2`,
      [employee_id, store_id]
    );
    if (info.rows[0] && applied.length) {
      const { saleNotificationMulti } = await import('./bot/messages.js');
      const text = saleNotificationMulti({
        employeeName: info.rows[0].full_name,
        storeName: info.rows[0].store_name,
        items: applied.map((a) => ({ metric: a.metric, value: a.value }))
      });
      await notifyChat(text);
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
     WHERE sch.work_date::date = $1::date
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

app.get('/dashboard', async () => {
  const today = todayMoscow();
  const res = await query(
    `SELECT e.id as employee_id, e.full_name,
            COALESCE(SUM(s.sim),0)::int as sim,
            COALESCE(SUM(s.mnp),0)::int as mnp,
            COALESCE(SUM(s.pa),0)::int as pa,
            COALESCE(SUM(s.combo),0)::int as combo,
            COALESCE(SUM(s.phones),0)::float as phones,
            COALESCE(SUM(s.accessories),0)::float as accessories,
            (COALESCE(SUM(s.sim),0) + COALESCE(SUM(s.mnp),0)*2 + COALESCE(SUM(s.pa),0)*3)::int as score
     FROM sales s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.sale_date::date >= ($1::date - interval '6 days')
       AND s.sale_date::date <= $1::date
     GROUP BY e.id, e.full_name
     ORDER BY score DESC, sim DESC
     LIMIT 10`,
    [today]
  );
  return {
    top: res.rows,
    top7: res.rows,
    period: { from: null, to: today }
  };
});

// ===== CASH =====
app.get('/cash/table', async (request) => {
  const q = request.query as { from?: string; to?: string };
  const from = (q.from || todayMoscow().slice(0, 8) + '01').slice(0, 10);
  const to = (q.to || todayMoscow()).slice(0, 10);

  const storesRes = await query(
    `SELECT id, name, code FROM stores
     WHERE COALESCE(is_active, true) = true
     ORDER BY hours NULLS LAST, name`
  );
  const stList = storesRes.rows;

  const cashRes = await query(
    `SELECT store_id, cash_date::text as cash_date,
            cash_fact, cash_1c,
            (cash_fact - (cash_1c + 2000)) as delta, comment
     FROM store_cash
     WHERE cash_date >= $1::date AND cash_date <= $2::date
     ORDER BY cash_date`,
    [from, to]
  );

  // даты: все дни периода, где есть касса + сегодня
  const dateSet = new Set<string>();
  for (const r of cashRes.rows) {
    dateSet.add(String(r.cash_date).slice(0, 10));
  }
  dateSet.add(to);
  // заполнить месяц по дням (чтобы таблица не была пустой)
  const start = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dateSet.add(d.toISOString().slice(0, 10));
  }
  const dates = [...dateSet].sort().reverse();

  const cells: Record<string, Record<string, any>> = {};
  for (const r of cashRes.rows) {
    const d = String(r.cash_date).slice(0, 10);
    if (!cells[d]) cells[d] = {};
    cells[d][r.store_id] = {
      cash_fact: Number(r.cash_fact),
      cash_1c: Number(r.cash_1c),
      delta: Number(r.delta),
      comment: r.comment
    };
  }

  return {
    from,
    to,
    stores: stList,
    dates,
    cells
  };
});

app.put('/cash', async (request, reply) => {
  const body = request.body as any;
  const store_id = body.store_id;
  const cash_date = String(body.cash_date || todayMoscow()).slice(0, 10);
  const cash_fact = Number(body.cash_fact) || 0;
  const cash_1c = Number(body.cash_1c) || 0;
  const comment = body.comment || null;

  if (!store_id) {
    return reply.code(400).send({ error: 'store_id required' });
  }

  const res = await query(
    `INSERT INTO store_cash (store_id, cash_date, cash_fact, cash_1c, comment, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (store_id, cash_date)
     DO UPDATE SET
       cash_fact = EXCLUDED.cash_fact,
       cash_1c = EXCLUDED.cash_1c,
       comment = EXCLUDED.comment,
       updated_at = now()
     RETURNING *`,
    [store_id, cash_date, cash_fact, cash_1c, comment]
  );
  return res.rows[0];
});

app.get('/cash', async (request) => {
  const q = request.query as { from?: string; to?: string; store_id?: string };
  const from = q.from || todayMoscow().slice(0, 8) + '01';
  const to = q.to || todayMoscow();
  const params: any[] = [from, to];
  let sql = `
    SELECT c.*, st.name as store_name
    FROM store_cash c
    LEFT JOIN stores st ON st.id = c.store_id
    WHERE c.cash_date >= $1::date AND c.cash_date <= $2::date`;
  if (q.store_id) {
    params.push(q.store_id);
    sql += ` AND c.store_id = $${params.length}`;
  }
  sql += ` ORDER BY c.cash_date DESC, st.name`;
  const res = await query(sql, params);
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


// ===== REPORT SVG (встроено — работает даже без routes-v14.ts) =====
// ===== REPORTS: SVG + ручная отправка в чат (формат = bot messages) =====
function escSvg(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadFactPlanStaff(storeId: string, date: string) {
  const storeRes = await query(`SELECT id, name, code FROM stores WHERE id = $1`, [storeId]).catch(
    () => ({ rows: [] as any[] })
  );
  const st = storeRes.rows[0] || { name: storeId, code: '' };

  const salesRes = await query(
    `SELECT
        COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp, COALESCE(SUM(pa),0) pa,
        COALESCE(SUM(combo),0) combo, COALESCE(SUM(phones),0) phones,
        COALESCE(SUM(accessories),0) accessories, COALESCE(SUM(settings),0) settings,
        COALESCE(SUM(insurance),0) insurance, COALESCE(SUM(wink),0) wink,
        COALESCE(SUM(shpd),0) shpd, COALESCE(SUM(focus),0) focus,
        COALESCE(SUM(credit_request),0) credit_request,
        COALESCE(SUM(credit_issued),0) credit_issued,
        COALESCE(SUM(plotter),0) plotter, COALESCE(SUM(hb),0) hb
     FROM sales WHERE store_id = $1 AND sale_date::date = $2::date`,
    [storeId, date]
  ).catch(() => ({ rows: [{}] }));
  const f = salesRes.rows[0] || {};

  let planRes = await query(
    `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date::date = $2::date LIMIT 1`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));
  if (!planRes.rows[0]) {
    planRes = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL LIMIT 1`,
      [storeId]
    ).catch(() => ({ rows: [] as any[] }));
  }
  const p = planRes.rows[0] || {};

  const staffRes = await query(
    `SELECT e.full_name FROM schedules sch
     JOIN employees e ON e.id = sch.employee_id
     WHERE sch.store_id = $1 AND sch.work_date::date = $2::date AND COALESCE(sch.hours,0)>0
     ORDER BY e.full_name`,
    [storeId, date]
  ).catch(() => ({ rows: [] as any[] }));

  return { st, f, p, staff: staffRes.rows.map((r: any) => r.full_name) };
}

/** SVG в той же структуре метрик, что итоговый отчёт в чат */
async function buildDayReportSvgInline(storeId: string, date: string) {
  const { st, f, p, staff } = await loadFactPlanStaff(storeId, date);
  const num = (v: any) => Number(v) || 0;

  const groups: { title: string; rows: [string, number, number][] }[] = [
    {
      title: 'Блок GI',
      rows: [
        ['Симкарты', num(f.sim), num(p.sim)],
        ['MNP', num(f.mnp), num(p.mnp)],
        ['Абики / золото', num(f.pa), num(p.pa)]
      ]
    },
    {
      title: 'Топ-ап и товарка',
      rows: [
        ['Комбо', num(f.combo), num(p.combo)],
        ['Настройки', num(f.settings), num(p.settings)],
        ['Аксессуары', num(f.accessories), num(p.accessories)],
        ['Страховки', num(f.insurance), num(p.insurance)],
        ['Смартфоны', num(f.phones), num(p.phones)]
      ]
    },
    {
      title: 'Ростелеком',
      rows: [
        ['WINK', num(f.wink), num(p.wink)],
        ['Заявка ШПД', num(f.shpd), num(p.shpd)],
        ['Фокусное об-ние', num(f.focus), num(p.focus)]
      ]
    },
    {
      title: 'Кредиты',
      rows: [
        ['Кредит · заявка', num(f.credit_request), num(p.credit_request)],
        ['Кредит · выдан', num(f.credit_issued), num(p.credit_issued)]
      ]
    },
    {
      title: 'Прочее',
      rows: [
        ['Плоттер', num(f.plotter), num(p.plotter)],
        ['HB', num(f.hb), num(p.hb)]
      ]
    }
  ];

  let y = 120;
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(
      `<text x="40" y="${y}" fill="#2AABEE" font-size="13" font-family="Arial,sans-serif" font-weight="700">${escSvg(g.title)}</text>`
    );
    y += 22;
    for (const [label, fact, plan] of g.rows) {
      const pct = plan > 0 ? Math.round((fact / plan) * 100) : fact > 0 ? 100 : 0;
      const fill = Math.round((Math.min(100, pct) / 100) * 140);
      const color = pct >= 100 ? '#30D158' : pct >= 50 ? '#FF9F0A' : '#FF453A';
      parts.push(`
        <text x="40" y="${y}" fill="#E5E7EB" font-size="13" font-family="Arial,sans-serif">${escSvg(label)}</text>
        <text x="200" y="${y}" fill="#FFFFFF" font-size="13" font-family="Arial,sans-serif" font-weight="700">${fact}/${plan || '—'}</text>
        <text x="300" y="${y}" fill="#A1A1AA" font-size="11" font-family="Arial,sans-serif">${pct}%</text>
        <g transform="translate(340,${y - 8})">
          <rect width="140" height="8" rx="4" fill="#2A2A2E"/>
          <rect width="${fill}" height="8" rx="4" fill="${color}"/>
        </g>`);
      y += 24;
    }
    y += 10;
  }

  const staffText = staff.map(escSvg).join(' · ') || '—';
  const height = Math.max(520, y + 70);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="540" height="${height}" viewBox="0 0 540 ${height}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#0A0A0B"/><stop offset="100%" stop-color="#14141A"/>
  </linearGradient></defs>
  <rect width="540" height="${height}" rx="24" fill="url(#bg)"/>
  <rect width="540" height="6" fill="#2AABEE"/>
  <text x="40" y="48" fill="#2AABEE" font-size="13" font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">T2 SALES</text>
  <text x="40" y="78" fill="#FFFFFF" font-size="22" font-family="Arial,sans-serif" font-weight="800">Итоговый отчёт</text>
  <text x="40" y="100" fill="#A1A1AA" font-size="13" font-family="Arial,sans-serif">${escSvg(st.name)} · ${escSvg(st.code)} · ${escSvg(date)}</text>
  ${parts.join('\n')}
  <text x="40" y="${y + 8}" fill="#6B7280" font-size="11" font-family="Arial,sans-serif">Смена: ${staffText}</text>
  <text x="40" y="${y + 28}" fill="#4B5563" font-size="10" font-family="Arial,sans-serif">тот же набор метрик, что в чате · Europe/Moscow</text>
</svg>`;
}

app.get('/reports/day/:storeId', async (request, reply) => {
  const storeId = String((request.params as any).storeId || '');
  const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
  if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
  try {
    const svg = await buildDayReportSvgInline(storeId, date);
    return { ok: true, store_id: storeId, date, content_type: 'image/svg+xml', svg };
  } catch (e: any) {
    request.log.error(e);
    return reply.code(500).send({ error: 'report_failed', message: e?.message || String(e) });
  }
});

app.get('/reports/svg', async (request, reply) => {
  const q = (request.query || {}) as any;
  const storeId = String(q.store_id || '');
  const date = String(q.date || todayMoscow()).slice(0, 10);
  if (!storeId) return reply.code(400).send({ error: 'store_id_required' });
  try {
    const svg = await buildDayReportSvgInline(storeId, date);
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    return reply.send(svg);
  } catch (e: any) {
    return reply.code(500).send({ error: 'report_failed', message: e?.message || String(e) });
  }
});

/** Ручная отправка микро/итога в REPORT_CHAT_ID (для теста) */
app.post('/reports/send-micro', async (request, reply) => {
  try {
    const { sendMicroReports } = await import('./cron/reports.js');
    const body = (request.body || {}) as any;
    const date = String(body.date || todayMoscow()).slice(0, 10);
    const hour = Number(body.hour) || new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' })
    ).getHours();
    const result = await sendMicroReports(date, hour);
    return result;
  } catch (e: any) {
    return reply.code(500).send({ error: 'send_failed', message: e?.message || String(e) });
  }
});

app.post('/reports/send-final', async (request, reply) => {
  try {
    const { sendFinalReports } = await import('./cron/reports.js');
    const body = (request.body || {}) as any;
    const date = String(body.date || todayMoscow()).slice(0, 10);
    const result = await sendFinalReports(date);
    return result;
  } catch (e: any) {
    return reply.code(500).send({ error: 'send_failed', message: e?.message || String(e) });
  }
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

try {
  await registerSupportRoutes(app);
  console.log('✅ Support routes registered');
} catch (e: any) {
  console.error('Support routes failed:', e?.message || e);
}

// ===== V13: смены, NLP, offline, live, insights, alerts =====
try {
  await registerV13Routes(app);
  console.log('✅ V13 routes registered');
} catch (e: any) {
  console.error('V13 routes failed:', e?.message || e);
}


// ===== V14: branding, precise heatmap, report SVG, tenant =====
try {
  await registerV14Routes(app);
  console.log('✅ V14 routes registered');
} catch (e: any) {
  console.error('V14 routes failed:', e?.message || e);
}

// ===== START =====
const port = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Сервер на 0.0.0.0:${port}`);
  console.log(`📅 Сегодня (МСК): ${todayMoscow()}`);

  startBot().catch((e) => console.error('Bot failed:', e.message || e));
  startReportCron();

  // умные алерты каждые 30 мин (внутри — только 11–21 МСК)
  setInterval(() => {
    runSmartAlertsTick().catch((e) => console.error('alerts tick:', e?.message || e));
  }, 30 * 60 * 1000);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
