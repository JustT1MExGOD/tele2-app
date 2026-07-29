import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './db/index.js';
import { startBot } from './bot/index.js';
import { startReportCron } from './cron/report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// Раздаём статику (фронтенд)
await app.register(fastifyStatic, {
    root: path.join(__dirname, '../../frontend'),
    prefix: '/',
});

// ===== API ЭНДПОИНТЫ =====

app.get('/health', async () => {
    return { status: 'ok', time: new Date().toISOString() };
});

app.get('/stores', async () => {
    const res = await query('SELECT id, code, name, address, hours FROM stores ORDER BY hours');
    return res.rows;
});

app.get('/employees', async () => {
    const res = await query('SELECT id, full_name, short_name, telegram_id FROM employees ORDER BY id');
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
        plotter = 0, hb = 0
    } = body;

    const res = await query(
        `INSERT INTO sales (
            employee_id, store_id, sale_date,
            sim, mnp, pa, combo, settings, accessories, insurance, phones,
            wink, shpd, focus, credit_request, credit_issued, plotter, hb
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (employee_id, store_id, sale_date)
        DO UPDATE SET
            sim = EXCLUDED.sim,
            mnp = EXCLUDED.mnp,
            pa = EXCLUDED.pa,
            combo = EXCLUDED.combo,
            settings = EXCLUDED.settings,
            accessories = EXCLUDED.accessories,
            insurance = EXCLUDED.insurance,
            phones = EXCLUDED.phones,
            wink = EXCLUDED.wink,
            shpd = EXCLUDED.shpd,
            focus = EXCLUDED.focus,
            credit_request = EXCLUDED.credit_request,
            credit_issued = EXCLUDED.credit_issued,
            plotter = EXCLUDED.plotter,
            hb = EXCLUDED.hb,
            updated_at = now()
        RETURNING *`,
        [
            employee_id, store_id, sale_date,
            sim, mnp, pa, combo, settings, accessories, insurance, phones,
            wink, shpd, focus, credit_request, credit_issued, plotter, hb
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

// Получить статистику за период
app.get('/stats', async (request) => {
    const { from, to } = request.query as { from?: string; to?: string };
    const dateFrom = from || new Date().toISOString().slice(0, 10);
    const dateTo = to || new Date().toISOString().slice(0, 10);

    const res = await query(
        `SELECT 
             e.full_name,
             SUM(s.sim) as sim,
             SUM(s.mnp) as mnp,
             SUM(s.pa) as pa,
             SUM(s.combo) as combo,
             SUM(s.phones) as phones,
             SUM(s.accessories) as accessories,
             SUM(s.insurance) as insurance,
             SUM(s.wink) as wink,
             SUM(s.shpd) as shpd,
             SUM(s.focus) as focus
         FROM sales s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.sale_date BETWEEN $1 AND $2
         GROUP BY e.id, e.full_name
         ORDER BY e.full_name`,
        [dateFrom, dateTo]
    );

    return res.rows;
});

// Получить дневную статистику по точкам
app.get('/stats/daily', async (request) => {
    const { date } = request.query as { date?: string };
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const res = await query(
        `SELECT 
             st.name as store_name,
             st.id as store_id,
             COUNT(DISTINCT e.id) as employees_count,
             COALESCE(SUM(s.sim), 0) as sim,
             COALESCE(SUM(s.mnp), 0) as mnp,
             COALESCE(SUM(s.pa), 0) as pa,
             COALESCE(SUM(s.combo), 0) as combo,
             COALESCE(SUM(s.phones), 0) as phones,
             COALESCE(SUM(s.accessories), 0) as accessories,
             COALESCE(SUM(s.insurance), 0) as insurance,
             COALESCE(SUM(s.wink), 0) as wink,
             COALESCE(SUM(s.shpd), 0) as shpd,
             COALESCE(SUM(s.focus), 0) as focus,
             COALESCE(SUM(s.plotter), 0) as plotter,
             COALESCE(SUM(s.hb), 0) as hb
         FROM sales s
         JOIN stores st ON st.id = s.store_id
         LEFT JOIN employees e ON e.id = s.employee_id
         WHERE s.sale_date = $1
         GROUP BY st.id, st.name
         ORDER BY st.name`,
        [targetDate]
    );

    return res.rows;
});

// Прогресс сотрудника
app.get('/employee/progress/:employeeId', async (request) => {
    const { employeeId } = request.params as { employeeId: string };
    const { date } = request.query as { date?: string };
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const planRes = await query(
        `SELECT 
             COALESCE(p.sim, 0) as sim_plan,
             COALESCE(p.mnp, 0) as mnp_plan,
             COALESCE(p.pa, 0) as pa_plan,
             COALESCE(p.combo, 0) as combo_plan,
             COALESCE(p.phones, 0) as phones_plan
         FROM schedules sch
         JOIN store_plans p ON p.store_id = sch.store_id
         WHERE sch.employee_id = $1 AND sch.work_date = $2
         LIMIT 1`,
        [employeeId, targetDate]
    );

    const factRes = await query(
        `SELECT 
             COALESCE(SUM(sim), 0) as sim_fact,
             COALESCE(SUM(mnp), 0) as mnp_fact,
             COALESCE(SUM(pa), 0) as pa_fact,
             COALESCE(SUM(combo), 0) as combo_fact,
             COALESCE(SUM(phones), 0) as phones_fact
         FROM sales
         WHERE employee_id = $1 AND sale_date = $2`,
        [employeeId, targetDate]
    );

    const plan = planRes.rows[0] || {};
    const fact = factRes.rows[0] || {};

    const metrics = ['sim', 'mnp', 'pa', 'combo', 'phones'];
    const result: any = { date: targetDate };
    let totalPlan = 0;
    let totalFact = 0;

    for (const m of metrics) {
        const planVal = Number(plan[`${m}_plan`]) || 0;
        const factVal = Number(fact[`${m}_fact`]) || 0;
        result[m] = { plan: planVal, fact: factVal };
        totalPlan += planVal;
        totalFact += factVal;
    }

    result.total = {
        plan: totalPlan,
        fact: totalFact,
        percent: totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0
    };

    return result;
});

const port = Number(process.env.PORT) || 3000;

startBot().catch(console.error);
startReportCron();

try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Сервер запущен на http://localhost:${port}`);
    console.log(`📱 Mini App доступен: http://localhost:${port}/`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}