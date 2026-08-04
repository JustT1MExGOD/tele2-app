/**
 * T2 Sales v13 routes — сессии смен, NLP, offline sync, live map,
 * insights, gamification, alerts, announcements, what-if, forecast
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { authPlugin, requireAuth, requireManager, isManager } from './middleware-auth.js';
import { parseSalePhrase } from './services/sales-nlp.js';
import {
  buildShiftInsight,
  selfComparison,
  splitDayPlanByHours,
  rebuildHourProfiles
} from './services/insights.js';
import {
  getGamificationProfile,
  evaluateAfterSale,
  evaluateShiftClose
} from './services/gamification.js';
import { generateShiftSummary } from './services/ai.js';
import { getLiveNetworkMap } from './services/live-map.js';
import { runSmartAlertsTick } from './services/alerts.js';
import { forecastStore, salesHeatmap, newbieCohorts } from './services/forecast.js';
import { simulateScheduleMoves } from './services/what-if.js';
import { todayMoscow, toDateISO } from './utils/date.js';

function num(v: any) {
  return Number(v) || 0;
}

export async function registerV13Routes(app: FastifyInstance) {
  // user на каждый запрос (на случай если v3/v8 не повесили hook)
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
    if (!isManager(request.user) && employee_id !== request.user!.employee_id) {
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

  // ========== INSIGHTS / SELF ==========
  app.get('/me/insight', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const employee_id = request.user!.employee_id!;

    const sch = await query(
      `SELECT store_id FROM schedules
       WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
      [employee_id, date]
    );
    const store_id = sch.rows[0]?.store_id;
    if (!store_id) return { message: 'Нет смены в графике', insight: null };

    const day = await query(
      // soft dependency: client can also pass day plan
      `SELECT COALESCE(SUM(sim),0) sim, COALESCE(SUM(mnp),0) mnp,
              COALESCE(SUM(pa),0) pa, COALESCE(SUM(combo),0) combo,
              COALESCE(SUM(phones),0) phones, COALESCE(SUM(accessories),0) accessories
       FROM sales WHERE employee_id=$1 AND sale_date::date=$2::date`,
      [employee_id, date]
    );
    const fact = day.rows[0] || {};

    // approximate day plan from month
    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT * FROM employee_month_plans WHERE employee_id=$1 AND month::date=$2::date`,
      [employee_id, month]
    );
    const rem = await query(
      `SELECT COUNT(*)::int c FROM schedules
       WHERE employee_id=$1 AND work_date::date >= $2::date
         AND work_date::date < ($3::date + interval '1 month') AND COALESCE(hours,0)>0`,
      [employee_id, date, month]
    );
    const div = Math.max(1, num(rem.rows[0]?.c));
    const mp = planRow.rows[0] || {};
    const dayPlan: Record<string, number> = {};
    for (const m of ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories']) {
      dayPlan[m] = Math.ceil(num(mp[m]) / div);
    }

    const insight = await buildShiftInsight({
      employeeId: employee_id,
      storeId: store_id,
      date,
      fact,
      dayPlan
    });
    return { store_id, fact, day_plan: dayPlan, insight };
  });

  app.get('/me/self-stats', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const stats = await selfComparison(request.user!.employee_id!);
    const gam = await getGamificationProfile(request.user!.employee_id!);
    return { ...stats, gamification: gam };
  });

  app.get('/me/day-plan-split', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const employee_id = request.user!.employee_id!;
    const sch = await query(
      `SELECT store_id FROM schedules WHERE employee_id=$1 AND work_date::date=$2::date LIMIT 1`,
      [employee_id, date]
    );
    if (!sch.rows[0]) return { error: 'no shift' };

    const month = date.slice(0, 7) + '-01';
    const planRow = await query(
      `SELECT * FROM employee_month_plans WHERE employee_id=$1 AND month::date=$2::date`,
      [employee_id, month]
    );
    const rem = await query(
      `SELECT COUNT(*)::int c FROM schedules
       WHERE employee_id=$1 AND work_date::date >= $2::date
         AND work_date::date < ($3::date + interval '1 month') AND COALESCE(hours,0)>0`,
      [employee_id, date, month]
    );
    const div = Math.max(1, num(rem.rows[0]?.c));
    const mp = planRow.rows[0] || {};
    const dayPlan: Record<string, number> = {};
    for (const m of ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories']) {
      dayPlan[m] = Math.ceil(num(mp[m]) / div);
    }
    const split = await splitDayPlanByHours({
      storeId: sch.rows[0].store_id,
      date,
      dayPlan
    });
    return { day_plan: dayPlan, split };
  });

  // ========== LIVE MAP + ALERTS ==========
  app.get('/network/live', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return getLiveNetworkMap();
  });

  app.get('/alerts', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const res = await query(
      `SELECT a.*, st.name as store_name
       FROM smart_alerts a
       LEFT JOIN stores st ON st.id = a.store_id
       WHERE a.status = 'open'
       ORDER BY a.created_at DESC LIMIT 50`
    );
    return res.rows;
  });

  app.post('/alerts/:id/ack', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const res = await query(
      `UPDATE smart_alerts SET status='acked', acked_at=now(), acked_by=$1
       WHERE id=$2 RETURNING *`,
      [request.user!.employee_id, Number(id)]
    );
    return res.rows[0];
  });

  app.post('/alerts/run', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return runSmartAlertsTick();
  });

  // ========== WHAT-IF ==========
  app.post('/schedule/what-if', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const moves = Array.isArray(body.moves) ? body.moves : [];
    // одиночный шорткат
    if (!moves.length && body.employee_id && body.to_store) {
      moves.push({
        employee_id: Number(body.employee_id),
        from_store: body.from_store || null,
        to_store: body.to_store,
        work_date: body.date
      });
    }
    try {
      return await simulateScheduleMoves({ date: body.date, moves });
    } catch (e: any) {
      return reply.code(500).send({ error: 'what_if_failed', message: e?.message || String(e) });
    }
  });


  /** Применить what-if сдвиги в schedules (реальная запись) */
  app.post('/schedule/what-if/apply', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const date = toDateISO(body.date || todayMoscow());
    const moves = Array.isArray(body.moves) ? body.moves : [];
    if (!moves.length && body.employee_id && body.to_store) {
      moves.push({
        employee_id: Number(body.employee_id),
        from_store: body.from_store || null,
        to_store: body.to_store
      });
    }
    if (!moves.length) {
      return reply.code(400).send({ error: 'moves required' });
    }

    // сначала симуляция — отсечь skipped
    const sim = await simulateScheduleMoves({ date, moves });
    const applied = [];
    for (const m of sim.moves_applied || []) {
      if (m.skipped) continue;
      const emp = Number(m.employee_id);
      const to = m.to_store || m.to;
      if (!emp || !to) continue;

      // сохранить shift_text/hours с текущей смены если есть
      const cur = await query(
        `SELECT shift_text, hours FROM schedules
         WHERE employee_id = $1 AND work_date::date = $2::date LIMIT 1`,
        [emp, date]
      );
      const shift_text = cur.rows[0]?.shift_text || '10-21';
      const hours = Number(cur.rows[0]?.hours) || 11;

      const res = await query(
        `INSERT INTO schedules (employee_id, store_id, work_date, shift_text, hours)
         VALUES ($1,$2,$3::date,$4,$5)
         ON CONFLICT (employee_id, work_date)
         DO UPDATE SET store_id = EXCLUDED.store_id,
                       shift_text = EXCLUDED.shift_text,
                       hours = EXCLUDED.hours
         RETURNING *`,
        [emp, to, date, shift_text, hours]
      );
      applied.push(res.rows[0]);
    }

    return {
      ok: true,
      date,
      count: applied.length,
      items: applied,
      simulation: sim
    };
  });


  app.get('/announcements', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const empId = request.user!.employee_id!;
    const res = await query(
      `SELECT a.*,
              EXISTS(
                SELECT 1 FROM announcement_reads r
                WHERE r.announcement_id = a.id AND r.employee_id = $1
              ) as is_read
       FROM announcements a
       WHERE a.active = true
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [empId]
    );
    return res.rows;
  });

  app.post('/announcements', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
    const res = await query(
      `INSERT INTO announcements (title, body, required, created_by)
       VALUES ($1,$2,COALESCE($3,true),$4) RETURNING *`,
      [body.title, body.body, body.required, request.user!.employee_id]
    );
    return res.rows[0];
  });

  app.post('/announcements/:id/read', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    await query(
      `INSERT INTO announcement_reads (announcement_id, employee_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [Number(id), request.user!.employee_id]
    );
    return { ok: true };
  });

  app.get('/channels/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const res = await query(
      `SELECT m.*, e.full_name as author_name
       FROM channel_messages m
       LEFT JOIN employees e ON e.id = m.author_id
       WHERE m.channel_id = $1
       ORDER BY m.created_at DESC LIMIT 100`,
      [id]
    );
    return res.rows.reverse();
  });

  app.post('/channels/:id/messages', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;
    const text = String(body.body || body.message || '').trim();
    if (!text) return reply.code(400).send({ error: 'body required' });
    const res = await query(
      `INSERT INTO channel_messages (channel_id, author_id, body, due_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, request.user!.employee_id, text, body.due_at || null]
    );
    return res.rows[0];
  });

  // ========== FORECAST / HEATMAP / COHORTS ==========
  app.get('/forecast/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    const from = String((request.query as any)?.from || todayMoscow()).slice(0, 10);
    const days = Math.min(Number((request.query as any)?.days) || 7, 14);
    return { store_id: storeId, items: await forecastStore(storeId, from, days) };
  });

  app.get('/heatmap/:storeId', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    return salesHeatmap(storeId);
  });

  app.get('/cohorts/newbies', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return newbieCohorts();
  });

  app.post('/admin/rebuild-hour-profiles', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return rebuildHourProfiles();
  });

  // ========== BI EXPORT (JSON truth) ==========
  app.get('/export/bi/daily', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const date = String((request.query as any)?.date || todayMoscow()).slice(0, 10);
    const sales = await query(
      `SELECT s.*, e.full_name, st.name as store_name, st.code
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.sale_date::date = $1::date`,
      [date]
    );
    const live = await getLiveNetworkMap();
    return {
      source: 't2-sales-app',
      generated_at: new Date().toISOString(),
      date,
      sales: sales.rows,
      network: live
    };
  });
}
