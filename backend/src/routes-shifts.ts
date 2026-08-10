/**
 * Смены (открытие/закрытие/текущая), быстрый разбор продажи по фразе (NLP)
 * и офлайн-очередь. Выделено из routes-v13.ts — было общей свалкой смен,
 * NLP, offline sync, live map, insights, alerts, what-if, forecast разом.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, isManager, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { parseSalePhrase } from './services/sales-nlp.js';
import { evaluateAfterSale, evaluateShiftClose } from './services/gamification.js';
import { generateShiftSummary } from './services/ai.js';
import { todayMoscow, toDateISO } from './utils/date.js';

function num(v: any) {
  return Number(v) || 0;
}

export async function registerShiftsRoutes(app: FastifyInstance) {
  // ========== SHIFT SESSIONS ==========
  app.post('/shifts/open', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as any;
    const employee_id = request.user!.employee_id!;
    const date = String(body.work_date || todayMoscow()).slice(0, 10);

    // точка из графика или body
    let store_id = body.store_id;
    if (!store_id) {
      const sch = await query(
        `SELECT store_id FROM schedules
         WHERE employee_id = $1 AND work_date::date = $2::date AND COALESCE(hours,0)>0
         LIMIT 1`,
        [employee_id, date]
      );
      store_id = sch.rows[0]?.store_id;
    }
    if (!store_id) {
      return reply.code(400).send({ error: 'store_id required (нет смены в графике)' });
    }

    // закрыть висящие open
    await query(
      `UPDATE shift_sessions SET status = 'auto_closed', closed_at = now()
       WHERE employee_id = $1 AND status = 'open'`,
      [employee_id]
    );

    const res = await query(
      `INSERT INTO shift_sessions
         (employee_id, store_id, work_date, status, opened_at, open_lat, open_lng, open_accuracy_m)
       VALUES ($1,$2,$3,'open', now(), $4, $5, $6)
       RETURNING *`,
      [
        employee_id,
        store_id,
        date,
        body.lat ?? null,
        body.lng ?? null,
        body.accuracy_m ?? null
      ]
    );
    return { ok: true, session: res.rows[0] };
  });

  app.post('/shifts/close', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as any;
    const employee_id = request.user!.employee_id!;

    const open = await query(
      `SELECT * FROM shift_sessions
       WHERE employee_id = $1 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [employee_id]
    );
    if (!open.rows[0]) {
      return reply.code(400).send({ error: 'no open session' });
    }
    const sess = open.rows[0];
    const date = toDateISO(sess.work_date);

    // факт за день
    const sales = await query(
      `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
              COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo
       FROM sales WHERE employee_id = $1 AND sale_date::date = $2::date`,
      [employee_id, date]
    );
    const fact = sales.rows[0] || {};
    const score = num(fact.sim) + num(fact.mnp) * 2 + num(fact.pa) * 3 + num(fact.combo) * 2;

    // план дня из /me-логики упрощённо
    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT sim, mnp, pa, combo FROM employee_month_plans
       WHERE employee_id = $1 AND month::date = $2::date`,
      [employee_id, month]
    );
    const rem = await query(
      `SELECT COUNT(*)::int c FROM schedules
       WHERE employee_id = $1 AND work_date::date >= $2::date
         AND work_date::date < ($3::date + interval '1 month') AND COALESCE(hours,0)>0`,
      [employee_id, date, month]
    );
    const div = Math.max(1, num(rem.rows[0]?.c));
    const mp = planRow.rows[0] || {};
    const dayPlan = {
      sim: Math.ceil(num(mp.sim) / div),
      mnp: Math.ceil(num(mp.mnp) / div),
      pa: Math.ceil(num(mp.pa) / div),
      combo: Math.ceil(num(mp.combo) / div)
    };
    const dayPlanUnits = dayPlan.sim + dayPlan.mnp + dayPlan.pa + dayPlan.combo;
    const factUnits = num(fact.sim) + num(fact.mnp) + num(fact.pa) + num(fact.combo);
    const planPct = dayPlanUnits > 0 ? Math.round((factUnits / dayPlanUnits) * 100) : 0;
    const ideal = planPct >= 100 && num(fact.mnp) > 0;

    // почему смена не идеальная — для разбора, а не голой галочки
    const idealMissing: string[] = [];
    if (planPct < 100) idealMissing.push(`план дня не закрыт (${planPct}%)`);
    if (num(fact.mnp) === 0) idealMissing.push('нет MNP');

    const res = await query(
      `UPDATE shift_sessions SET
         status = 'closed',
         closed_at = now(),
         close_lat = $1,
         close_lng = $2,
         self_report = $3,
         mood = $4,
         blockers = $5,
         ideal_shift = $6,
         score = $7
       WHERE id = $8
       RETURNING *`,
      [
        body.lat ?? null,
        body.lng ?? null,
        body.self_report || null,
        body.mood ?? null,
        body.blockers || null,
        ideal,
        score,
        sess.id
      ]
    );

    const gam = await evaluateShiftClose({
      employeeId: employee_id,
      score,
      ideal,
      planPct
    });

    const factOut = { sim: num(fact.sim), mnp: num(fact.mnp), pa: num(fact.pa), combo: num(fact.combo) };
    const empRow = await query(`SELECT full_name FROM employees WHERE id = $1`, [employee_id]);
    const aiSummary = await generateShiftSummary({
      employeeId: employee_id,
      employeeName: empRow.rows[0]?.full_name || 'Сотрудник',
      planPct,
      idealShift: ideal,
      fact: factOut,
      dayPlan,
      xpGained: gam?.xp_gained || 0,
      leveledUp: !!gam?.leveled_up,
      streakDays: gam?.streak_days || 0
    });

    return {
      ok: true,
      session: res.rows[0],
      plan_pct: planPct,
      ideal_shift: ideal,
      ideal_missing: idealMissing,
      score,
      fact: factOut,
      day_plan: dayPlan,
      gamification: gam,
      ai_summary: aiSummary
    };
  });

  app.get('/shifts/current', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const res = await query(
      `SELECT ss.*, st.name as store_name, st.color
       FROM shift_sessions ss
       LEFT JOIN stores st ON st.id = ss.store_id
       WHERE ss.employee_id = $1 AND ss.status = 'open'
       ORDER BY ss.opened_at DESC LIMIT 1`,
      [request.user!.employee_id]
    );
    return { session: res.rows[0] || null };
  });

  // ========== NLP PARSE + OPTIONAL APPLY ==========
  app.post('/sales/parse', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as any;
    const parsed = parseSalePhrase(String(body.text || ''));
    return parsed;
  });

  app.post('/sales/quick', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as any;
    const parsed = parseSalePhrase(String(body.text || ''));
    if (!Object.keys(parsed.metrics).length) {
      return reply.code(400).send({ error: 'не удалось разобрать', parsed });
    }

    const employee_id = Number(body.employee_id || request.user!.employee_id);
    const isManagerRole = isManager(request.user);
    if (!isManagerRole && employee_id !== request.user!.employee_id) {
      return reply.code(403).send({ error: 'только свои продажи' });
    }

    let store_id = body.store_id;
    const sale_date = String(body.sale_date || todayMoscow()).slice(0, 10);
    if (!store_id) {
      const sch = await query(
        `SELECT store_id FROM schedules WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
        [employee_id, sale_date]
      );
      store_id = sch.rows[0]?.store_id;
    }
    if (!store_id) return reply.code(400).send({ error: 'store_id required' });

    // Manager, вносящий продажу ЗА ДРУГОГО сотрудника — точка должна быть в
    // его сети (тот же чек, что в основном POST /sales); свою продажу на
    // чужой точке (подмена) вносить по-прежнему можно.
    if (isManagerRole && employee_id !== request.user!.employee_id) {
      const orgId = resolveViewOrgId(request.user!, body.org_id);
      if (!(await assertStoreInOrg(store_id, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
      }
    }

    // reuse same upsert pattern as main /sales
    const fields = Object.keys(parsed.metrics);
    const insertCols = ['employee_id', 'store_id', 'sale_date', ...fields];
    const vals: any[] = [employee_id, store_id, sale_date, ...fields.map((f) => parsed.metrics[f])];
    const ph = vals.map((_, i) => `$${i + 1}`);
    const sets = fields.map((f) => `${f} = sales.${f} + EXCLUDED.${f}`);
    sets.push('updated_at = now()');

    const res = await query(
      `INSERT INTO sales (${insertCols.join(',')})
       VALUES (${ph.join(',')})
       ON CONFLICT (employee_id, store_id, sale_date)
       DO UPDATE SET ${sets.join(', ')}
       RETURNING *`,
      vals
    );

    await evaluateAfterSale(employee_id, parsed.metrics);
    return { ok: true, parsed, sale: res.rows[0] };
  });

  // ========== OFFLINE SYNC ==========
  app.post('/sync/batch', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = (request.body || {}) as any;
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const results = [];

    for (const op of ops) {
      const client_id = String(op.client_id || '');
      if (!client_id) {
        results.push({ client_id, status: 'rejected', error: 'no client_id' });
        continue;
      }
      try {
        const ins = await query(
          `INSERT INTO offline_sync_log (client_id, employee_id, telegram_id, payload, status)
           VALUES ($1,$2,$3,$4,'applied')
           ON CONFLICT (client_id) DO NOTHING
           RETURNING id`,
          [
            client_id,
            request.user!.employee_id,
            request.user!.telegram_id,
            JSON.stringify(op)
          ]
        );
        if (!ins.rows[0]) {
          results.push({ client_id, status: 'duplicate' });
          continue;
        }

        if (op.type === 'sale') {
          // делегируем на quick-логику через метрики
          const metrics = op.metrics || {};
          const employee_id = Number(op.employee_id || request.user!.employee_id);
          const store_id = op.store_id;
          const sale_date = String(op.sale_date || todayMoscow()).slice(0, 10);

          // Та же проверка, что в /sales/quick и основном POST /sales —
          // раньше офлайн-синхронизация вообще не проверяла ни "свой ли это
          // сотрудник", ни "своя ли сеть", employee_id/store_id брались из
          // тела как есть. Один плохой op не должен рушить весь batch —
          // кидаем Error, его ловит try/catch ниже и помечает just этот op.
          if (employee_id !== request.user!.employee_id) {
            if (!isManager(request.user)) {
              throw new Error('можно синхронизировать только свои продажи');
            }
            const orgId = resolveViewOrgId(request.user!, op.org_id);
            if (!store_id || !(await assertStoreInOrg(store_id, orgId))) {
              throw new Error('точка не принадлежит вашей сети');
            }
          }

          // имена колонок идут прямо в SQL (не как параметры) — обязательна
          // белая проверка формата, иначе это SQL-инъекция через ключи JSON
          const SAFE_COLUMN = /^[a-z][a-z0-9_]{0,29}$/;
          const fields = Object.keys(metrics).filter(
            (k) => SAFE_COLUMN.test(k) && num(metrics[k]) !== 0
          );
          if (store_id && fields.length) {
            const insertCols = ['employee_id', 'store_id', 'sale_date', ...fields];
            const vals: any[] = [employee_id, store_id, sale_date, ...fields.map((f) => num(metrics[f]))];
            const ph = vals.map((_, i) => `$${i + 1}`);
            const sets = fields.map((f) => `${f} = GREATEST(0, sales.${f} + EXCLUDED.${f})`);
            sets.push('updated_at = now()');
            await query(
              `INSERT INTO sales (${insertCols.join(',')}) VALUES (${ph.join(',')})
               ON CONFLICT (employee_id, store_id, sale_date)
               DO UPDATE SET ${sets.join(', ')}`,
              vals
            );
          }
        }
        // shift_open/shift_close никогда не ставятся в офлайн-очередь —
        // open/close смены всегда бьют в /shifts/open|close напрямую
        // (см. frontend/offline-queue.js: очередь умеет только sale).

        results.push({ client_id, status: 'applied' });
      } catch (e: any) {
        results.push({ client_id, status: 'rejected', error: e?.message || 'error' });
      }
    }

    return { ok: true, results };
  });
}
