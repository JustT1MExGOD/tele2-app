/**
 * Store Intelligence (18.5) — профиль точки: план/факт/прогноз, тренд,
 * staffing, кассовая дисциплина, связанные задачи и алерты, плюс
 * объяснимый Store Health Score. Не изобретает новый расчётный движок —
 * почти целиком передаёт buildSupervisorDashboard() с scope из одной точки.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { buildSupervisorDashboard } from './services/supervisor-analytics.js';
import { todayMoscow } from './utils/date.js';

function canViewStoreProfile(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'supervisor' || user.role === 'manager' || user.role === 'admin';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export async function registerStoreProfileRoutes(app: FastifyInstance) {
  app.get('/stores/:id/profile', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!canViewStoreProfile(request.user)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const { id } = request.params as { id: string };
    const q = (request.query || {}) as { org_id?: string; days?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    if (!(await assertStoreInOrg(id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
    }

    let days = Number(q.days);
    if (!Number.isFinite(days) || days < 7) days = 30;
    if (days > 60) days = 60;
    const date = todayMoscow();

    try {
      const dash = await buildSupervisorDashboard({ scope: [id], date, days });
      const store = dash.stores[0] || null;
      if (!store) return reply.code(404).send({ error: 'not found' });

      const d = new Date(date + 'T12:00:00');
      d.setDate(d.getDate() - (days - 1));
      const from = d.toISOString().slice(0, 10);

      // Staffing coverage — доля дней периода, когда на точке хоть кто-то
      // был в графике. Простой, честный прокси — в системе нет отдельного
      // поля "требуемый штат на точку", чтобы сравнивать факт с нормой.
      const staffDays = await query(
        `SELECT COUNT(DISTINCT work_date)::int as cnt
         FROM schedules
         WHERE store_id = $1 AND work_date::date >= $2::date AND work_date::date <= $3::date
           AND COALESCE(hours, 0) > 0`,
        [id, from, date]
      );
      const staffingPct = clamp(Math.round((Number(staffDays.rows[0]?.cnt) || 0) / days * 100), 0, 100);

      // Кассовая дисциплина — доля дней БЕЗ разрыва ≥1000 (тот же порог,
      // что services/alerts.ts:83 использует для триггера cash_gap alert).
      const cashRows = await query(
        `SELECT cash_fact, cash_1c FROM store_cash
         WHERE store_id = $1 AND cash_date::date >= $2::date AND cash_date::date <= $3::date`,
        [id, from, date]
      );
      const cashDaysTotal = cashRows.rows.length;
      const cashDaysClean = cashRows.rows.filter(
        (r: any) => Math.abs((Number(r.cash_fact) || 0) - (Number(r.cash_1c) || 0)) < 1000
      ).length;
      // Нет данных по кассе за период — не штрафуем и не хвалим, нейтральные 100.
      const cashPct = cashDaysTotal > 0 ? clamp(Math.round((cashDaysClean / cashDaysTotal) * 100), 0, 100) : 100;

      const overallPct = clamp(store.today?.overall ?? 0, 0, 200);
      const trendPct = clamp(50 + (dash.network?.pace_delta ?? 0), 0, 100);

      const health = Math.round(
        0.4 * Math.min(overallPct, 100) + 0.2 * trendPct + 0.2 * staffingPct + 0.2 * cashPct
      );

      const tasksRes = await query(
        `SELECT t.*, e.full_name as assignee_name
         FROM tasks t
         LEFT JOIN employees e ON e.id = t.assigned_to
         WHERE t.store_id = $1 AND t.status IN ('open', 'in_progress')
         ORDER BY t.created_at DESC LIMIT 20`,
        [id]
      );

      return {
        store: {
          store_id: store.store_id,
          name: store.name,
          code: store.code,
          color: store.color,
          staff_count: store.staff_count,
          staff: store.staff
        },
        today: store.today,
        month: store.month,
        trend: dash.trend,
        alerts: store.alerts || [],
        tasks: tasksRes.rows,
        health: {
          score: clamp(health, 0, 100),
          components: {
            plan: { value: Math.round(Math.min(overallPct, 100)), weight: 0.4 },
            trend: { value: trendPct, weight: 0.2 },
            staffing: { value: staffingPct, weight: 0.2 },
            cash_discipline: { value: cashPct, weight: 0.2 }
          }
        },
        period: { from, to: date, days },
        generated_at: new Date().toISOString()
      };
    } catch (e: any) {
      console.error('store-profile failed:', e?.message || e);
      return reply.code(500).send({ error: 'store_profile_failed', message: e?.message || String(e) });
    }
  });
}
