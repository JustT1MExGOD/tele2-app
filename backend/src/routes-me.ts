/**
 * Идентичность и привязка Telegram: /me, /me/bind, /me/day (смена+факт+
 * дневной план сегодня), назначение роли. Выделено из routes-v3.ts.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireManager, isManager, canAssignRole, Role } from './middleware-auth.js';
import { todayMoscow } from './utils/date.js';

export async function registerMeRoutes(app: FastifyInstance) {
  // ========== ME / ROLE ==========
  app.get('/me', async (request, reply) => {
    // не 404 — фронту удобнее: bound:false → показать «Привязать»
    if (!request.user?.employee_id) {
      return {
        bound: false,
        employee_id: null,
        full_name: null,
        role: null,
        telegram_id: request.headers['x-telegram-id'] || null
      };
    }
    return {
      bound: true,
      employee_id: request.user.employee_id,
      id: request.user.employee_id,
      full_name: request.user.full_name,
      role: request.user.role,
      telegram_id: request.user.telegram_id,
      is_manager: isManager(request.user),
      org_id: request.user.org_id
    };
  });

  app.post('/me/bind', async (request, reply) => {
    const body = request.body as any;
    const headerTg = request.headers['x-telegram-id'];
    const telegram_id = Number(body?.telegram_id || headerTg || 0);
    const employee_id = Number(body?.employee_id);
    if (!telegram_id || !employee_id) {
      return reply.code(400).send({ error: 'telegram_id and employee_id required' });
    }

    // снять tg с других карточек, привязать к выбранной
    await query(
      `UPDATE employees SET telegram_id = NULL WHERE telegram_id = $1`,
      [telegram_id]
    );
    const res = await query(
      `UPDATE employees
       SET telegram_id = $1,
           access_status = COALESCE(NULLIF(access_status, ''), 'active'),
           is_active = true
       WHERE id = $2
       RETURNING id as employee_id, id, full_name, short_name, role, telegram_id, access_status`,
      [telegram_id, employee_id]
    );
    if (!res.rows[0]) {
      return reply.code(404).send({ error: 'employee not found' });
    }
    return { bound: true, ...res.rows[0] };
  });

  /** Мой день: смена + факт + дневной план */
  app.get('/me/day', async (request, reply) => {
    const telegramId =
      (request.headers['x-telegram-id'] as string) ||
      (request.query as any)?.telegram_id;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);

    if (!telegramId) {
      return reply.code(401).send({ error: 'X-Telegram-Id required' });
    }

    const emp = await query(
      `SELECT id, full_name, short_name, role, telegram_id
       FROM employees
       WHERE telegram_id = $1 AND COALESCE(is_active, true) = true
       LIMIT 1`,
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
       WHERE sch.employee_id = $1
         AND sch.work_date::date = $2::date
         AND COALESCE(sch.hours, 0) > 0
       LIMIT 1`,
      [e.id, date]
    );
    const shift = sch.rows[0] || null;

    const sales = await query(
      `SELECT
         COALESCE(SUM(sim),0) as sim, COALESCE(SUM(mnp),0) as mnp,
         COALESCE(SUM(pa),0) as pa, COALESCE(SUM(combo),0) as combo,
         COALESCE(SUM(phones),0) as phones, COALESCE(SUM(accessories),0) as accessories,
         COALESCE(SUM(shpd),0) as shpd, COALESCE(SUM(wink),0) as wink,
         COALESCE(SUM(focus),0) as focus, COALESCE(SUM(insurance),0) as insurance,
         COALESCE(SUM(settings),0) as settings,
         COALESCE(SUM(credit_issued),0) as credit_issued,
         COALESCE(SUM(credit_request),0) as credit_request
       FROM sales
       WHERE employee_id = $1 AND sale_date::date = $2::date`,
      [e.id, date]
    );
    const fact = sales.rows[0] || {};

    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT * FROM employee_month_plans
       WHERE employee_id = $1 AND month::date = $2::date`,
      [e.id, month]
    );
    const monthPlan = planRow.rows[0] || null;

    // факт с начала месяца (для «остаток плана»)
    const monthFact = await query(
      `SELECT
         COALESCE(SUM(sim),0) as sim,
         COALESCE(SUM(mnp),0) as mnp,
         COALESCE(SUM(pa),0) as pa,
         COALESCE(SUM(combo),0) as combo,
         COALESCE(SUM(phones),0) as phones,
         COALESCE(SUM(accessories),0) as accessories,
         COALESCE(SUM(settings),0) as settings,
         COALESCE(SUM(insurance),0) as insurance,
         COALESCE(SUM(wink),0) as wink,
         COALESCE(SUM(shpd),0) as shpd,
         COALESCE(SUM(focus),0) as focus
       FROM sales
       WHERE employee_id = $1
         AND sale_date >= $2::date
         AND sale_date < ($2::date + interval '1 month')`,
      [e.id, month]
    );
    const mf = monthFact.rows[0] || {};

    // сколько смен осталось с сегодня до конца месяца
    const remShifts = await query(
      `SELECT COUNT(*)::int as cnt FROM schedules
       WHERE employee_id = $1
         AND work_date::date >= $2::date
         AND work_date::date < ($3::date + interval '1 month')
         AND COALESCE(hours, 0) > 0`,
      [e.id, date, month]
    );
    const div = Math.max(1, Number(remShifts.rows[0]?.cnt) || 1);

    const metrics = [
      'sim', 'mnp', 'pa', 'combo', 'phones',
      'accessories', 'settings', 'insurance', 'wink', 'shpd', 'focus'
    ] as const;

    // daily_plan = ceil( (месячный_план − факт_месяца) / оставшиеся_смены )
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
      month_fact: mf,
      remaining_shifts: div
    };
  });

  // Назначить роль (каскад: только строго ниже своей, admin — без ограничений)
  app.post('/employees/:id/role', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { role } = request.body as { role?: string };
    const ALL_ROLES: Role[] = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    if (!ALL_ROLES.includes(role as Role)) {
      return reply.code(400).send({ error: 'invalid role' });
    }
    if (!canAssignRole(request.user!.role, role as Role)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Можно назначать только роли ниже своей' });
    }
    const res = await query(
      `UPDATE employees SET role = $1 WHERE id = $2 RETURNING id, full_name, role`,
      [role, id]
    );
    return res.rows[0];
  });
}
