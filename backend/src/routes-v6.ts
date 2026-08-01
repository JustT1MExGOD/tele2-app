/**
 * T2 Sales v6 — Control Center
 * Dashboard, My Day, support reply, schedule copy week, FAQ CRUD, ready
 *
 * await registerV6Routes(app);
 */

import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireManager, requireAuth } from './middleware-auth.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
import { bot } from './bot/index.js';
import { computeStoreDailyPlans } from './services/plans.js';

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function registerV6Routes(app: FastifyInstance) {
  // ===== READY / VERSION =====
  app.get('/ready', async (_req, reply) => {
    try {
      await query('SELECT 1');
      return {
        status: 'ready',
        version: '6.0.0',
        today: todayMoscow(),
        time: new Date().toISOString()
      };
    } catch (e: any) {
      return reply.code(503).send({ status: 'not_ready', error: e.message });
    }
  });

  app.get('/version', async () => ({ version: '6.0.0', name: 'T2 Sales Control Center' }));

  // ===== MY DAY (all authenticated-ish; works with telegram id optional) =====
  app.get('/me/day', async (request, reply) => {
    const telegramId =
      (request.headers['x-telegram-id'] as string) ||
      (request.query as any)?.telegram_id;
    const date = (request.query as any)?.date || todayMoscow();

    if (!telegramId) {
      return reply.code(401).send({ error: 'X-Telegram-Id required' });
    }

    const emp = await query(
      `SELECT id, full_name, short_name, role, telegram_id
       FROM employees WHERE telegram_id = $1 AND is_active = true LIMIT 1`,
      [Number(telegramId)]
    );
    if (!emp.rows[0]) {
      return { bound: false, message: 'Привяжите аккаунт во вкладке Мой' };
    }
    const e = emp.rows[0];

    const sch = await query(
      `SELECT sch.*, st.name as store_name, st.color, st.code as store_code
       FROM schedules sch
       LEFT JOIN stores st ON st.id = sch.store_id
       WHERE sch.employee_id = $1 AND sch.work_date = $2 LIMIT 1`,
      [e.id, date]
    );
    const shift = sch.rows[0] || null;

    const sales = await query(
      `SELECT
         COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
         COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
         COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories,
         COALESCE(SUM(shpd),0) as shpd, COALESCE(SUM(wink),0) as wink,
         COALESCE(SUM(focus),0) as focus, COALESCE(SUM(insurance),0) as insurance
       FROM sales WHERE employee_id = $1 AND sale_date = $2`,
      [e.id, date]
    );
    const fact = sales.rows[0] || {};

    // дневной план: остаток месяца / оставшиеся смены
    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT * FROM employee_month_plans WHERE employee_id = $1 AND month = $2`,
      [e.id, month]
    );
    const monthPlan = planRow.rows[0] || null;

    const monthFact = await query(
      `SELECT
         COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
         COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
         COALESCE(SUM(phones),0) as phones
       FROM sales WHERE employee_id = $1 AND sale_date >= $2 AND sale_date < ($2::date + interval '1 month')`,
      [e.id, month]
    );
    const mf = monthFact.rows[0] || {};

    const remShifts = await query(
      `SELECT COUNT(*)::int as cnt FROM schedules
       WHERE employee_id = $1 AND work_date >= $2
         AND work_date < ($3::date + interval '1 month') AND hours > 0`,
      [e.id, date, month]
    );
    const div = Math.max(1, Number(remShifts.rows[0]?.cnt) || 1);

    const metrics = ['sim', 'mnp', 'pa', 'combo', 'phones'] as const;
    const dailyPlan: Record<string, number> = {};
    const progress: Record<string, { fact: number; plan: number; pct: number }> = {};
    for (const m of metrics) {
      const left = Math.max(0, Number(monthPlan?.[m] || 0) - Number(mf[m] || 0));
      dailyPlan[m] = Math.ceil(left / div);
      const f = Number(fact[m]) || 0;
      const p = dailyPlan[m];
      progress[m] = {
        fact: f,
        plan: p,
        pct: p > 0 ? Math.round((f / p) * 100) : f > 0 ? 100 : 0
      };
    }

    const totalFact = metrics.reduce((s, m) => s + (Number(fact[m]) || 0), 0);
    const totalPlan = metrics.reduce((s, m) => s + (dailyPlan[m] || 0), 0);

    return {
      bound: true,
      employee: e,
      date,
      shift,
      fact,
      daily_plan: dailyPlan,
      progress,
      total: {
        fact: totalFact,
        plan: totalPlan,
        pct: totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0
      },
      month_plan: monthPlan,
      remaining_shifts: Number(remShifts.rows[0]?.cnt) || 0
    };
  });

  // ===== DASHBOARD (period) — ALL can view =====
  app.get('/dashboard', async (request) => {
    const q = request.query as { from?: string; to?: string };
    const to = q.to || todayMoscow();
    const from =
      q.from ||
      (() => {
        const d = new Date(to + 'T12:00:00');
        d.setDate(d.getDate() - 6);
        return d.toISOString().slice(0, 10);
      })();

    const byStore = await query(
      `SELECT st.id, st.name, st.color, st.code,
         COALESCE(SUM(s.sim),0) as sim, COALESCE(SUM(s.mnp),0) as mnp,
         COALESCE(SUM(s.pa),0) as pa, COALESCE(SUM(s.combo),0) as combo,
         COALESCE(SUM(s.phones),0) as phones, COALESCE(SUM(s.accessories),0) as accessories,
         COALESCE(SUM(s.shpd),0) as shpd
       FROM stores st
       LEFT JOIN sales s ON s.store_id = st.id AND s.sale_date >= $1 AND s.sale_date <= $2
       WHERE st.is_active = true OR st.is_active IS NULL
       GROUP BY st.id, st.name, st.color, st.code, st.hours
       ORDER BY st.hours NULLS LAST`,
      [from, to]
    );

    const byEmp = await query(
      `SELECT e.id, e.full_name,
         COALESCE(SUM(s.sim),0) as sim, COALESCE(SUM(s.mnp),0) as mnp,
         COALESCE(SUM(s.pa),0) as pa, COALESCE(SUM(s.combo),0) as combo,
         COALESCE(SUM(s.phones),0) as phones
       FROM employees e
       LEFT JOIN sales s ON s.employee_id = e.id AND s.sale_date >= $1 AND s.sale_date <= $2
       WHERE e.is_active = true
       GROUP BY e.id, e.full_name
       ORDER BY (COALESCE(SUM(s.sim),0) + COALESCE(SUM(s.mnp),0) + COALESCE(SUM(s.pa),0)) DESC`,
      [from, to]
    );

    const totals = byStore.rows.reduce(
      (acc: any, r: any) => {
        acc.sim += Number(r.sim) || 0;
        acc.mnp += Number(r.mnp) || 0;
        acc.pa += Number(r.pa) || 0;
        acc.combo += Number(r.combo) || 0;
        acc.phones += Number(r.phones) || 0;
        return acc;
      },
      { sim: 0, mnp: 0, pa: 0, combo: 0, phones: 0 }
    );

    // today vs daily store plans
    let todayPlans: any = null;
    try {
      todayPlans = await computeStoreDailyPlans(todayMoscow());
    } catch (_) {}

    return {
      from,
      to,
      totals,
      stores: byStore.rows,
      employees: byEmp.rows,
      leaders: byEmp.rows.slice(0, 5),
      today_store_plans: todayPlans
    };
  });

  // ===== SUPPORT: list (manager) + reply → employee DM =====
  app.get('/support/my', async (request, reply) => {
    const telegramId = request.headers['x-telegram-id'] as string;
    if (!telegramId) return reply.code(401).send({ error: 'auth' });
    const res = await query(
      `SELECT * FROM support_tickets
       WHERE telegram_id = $1
       ORDER BY created_at DESC LIMIT 30`,
      [Number(telegramId)]
    );
    return res.rows;
  });

  app.post('/support/tickets/:id/reply', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { reply: text } = request.body as any;
    if (!text) return reply.code(400).send({ error: 'reply required' });

    const res = await query(
      `UPDATE support_tickets
       SET admin_reply = $1, status = 'answered', answered_at = now()
       WHERE id = $2 RETURNING *`,
      [String(text), Number(id)]
    );
    const ticket = res.rows[0];
    if (!ticket) return reply.code(404).send({ error: 'not found' });

    const tgId = ticket.telegram_id || ticket.employee_telegram_id;
    if (bot && tgId) {
      try {
        await bot.api.sendMessage(
          tgId,
          `💬 <b>Ответ поддержки #${ticket.id}</b>\n\n${esc(text)}\n\n<i>T2 Sales</i>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.error('support reply DM fail', e);
      }
    }
    return ticket;
  });

  app.post('/support/tickets/:id/close', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const res = await query(
      `UPDATE support_tickets SET status = 'closed' WHERE id = $1 RETURNING *`,
      [Number(id)]
    );
    return res.rows[0] || reply.code(404).send({ error: 'not found' });
  });

  // ===== FAQ CRUD (manager write, all read already in v4) =====
  app.post('/support/faq', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const res = await query(
      `INSERT INTO support_faq (keywords, question, answer, sort_order, is_active)
       VALUES ($1,$2,$3,$4,true) RETURNING *`,
      [
        b.keywords || [],
        String(b.question || '').trim(),
        String(b.answer || '').trim(),
        Number(b.sort_order) || 0
      ]
    );
    return res.rows[0];
  });

  app.patch('/support/faq/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    const res = await query(
      `UPDATE support_faq SET
         question = COALESCE($2, question),
         answer = COALESCE($3, answer),
         keywords = COALESCE($4, keywords),
         is_active = COALESCE($5, is_active),
         sort_order = COALESCE($6, sort_order)
       WHERE id = $1 RETURNING *`,
      [
        Number(id),
        b.question ?? null,
        b.answer ?? null,
        b.keywords ?? null,
        b.is_active ?? null,
        b.sort_order ?? null
      ]
    );
    return res.rows[0];
  });

  // ===== SCHEDULE: copy week =====
  app.post('/schedules/copy-week', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    // from_monday: '2026-07-28', to_monday: '2026-08-04'
    const fromMon = b.from_monday;
    const toMon = b.to_monday;
    if (!fromMon || !toMon) {
      return reply.code(400).send({ error: 'from_monday and to_monday required (YYYY-MM-DD)' });
    }

    const srcEnd = new Date(fromMon + 'T12:00:00');
    srcEnd.setDate(srcEnd.getDate() + 7);
    const srcEndStr = srcEnd.toISOString().slice(0, 10);

    const src = await query(
      `SELECT employee_id, store_id, work_date, shift_text, hours
       FROM schedules
       WHERE work_date >= $1 AND work_date < $2 AND hours > 0`,
      [fromMon, srcEndStr]
    );

    const from = new Date(fromMon + 'T12:00:00');
    const to = new Date(toMon + 'T12:00:00');
    const deltaDays = Math.round((to.getTime() - from.getTime()) / 86400000);

    let count = 0;
    for (const row of src.rows) {
      const d = new Date(String(row.work_date).slice(0, 10) + 'T12:00:00');
      d.setDate(d.getDate() + deltaDays);
      const newDate = d.toISOString().slice(0, 10);
      await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (employee_id, work_date)
         DO UPDATE SET store_id = EXCLUDED.store_id, shift_text = EXCLUDED.shift_text, hours = EXCLUDED.hours`,
        [row.employee_id, row.store_id, newDate, row.shift_text, row.hours]
      );
      count++;
    }
    return { ok: true, copied: count, from_monday: fromMon, to_monday: toMon };
  });

  // ===== MONTH PLANS: explicitly public read (all employees) =====
  // GET /plans/employees/month already public in v5 — reinforce here if needed
  app.get('/plans/month-table', async (request) => {
    const { month } = request.query as { month?: string };
    const m = month || currentMonthMoscow();
    // reuse logic via internal fetch pattern — call same service
    const { getMonthSummaryTable } = await import('./services/plans.js');
    return getMonthSummaryTable(m);
  });
}
