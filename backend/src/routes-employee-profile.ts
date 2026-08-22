/**
 * Employee 2.0 (18.8) — профиль сотрудника: BFQ, геймификация, история
 * смен и объяснимый Health Score. Не изобретает новый расчётный движок —
 * собирает уже существующие calculateEmployeeBFQ/getGamificationProfile
 * в одном месте, по образцу routes-store-profile.ts (18.5).
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, requireEmployeeInOrg } from './middleware-auth.js';
import { calculateEmployeeBFQ } from './services/bfq.js';
import { getGamificationProfile } from './services/gamification.js';
import { todayMoscow, currentMonthMoscow } from './utils/date.js';
import { serverError } from './utils/http-errors.js';
import type { EmployeeProfileResponse } from './shared/api-types.js';

function canViewEmployeeProfile(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'supervisor' || user.role === 'manager' || user.role === 'admin';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export async function registerEmployeeProfileRoutes(app: FastifyInstance) {
  app.get(
    '/employees/:id/profile',
    { preHandler: [requireEmployeeInOrg('params', 'id', { allowOrgOverride: true })] },
    async (request, reply): Promise<EmployeeProfileResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    if (!canViewEmployeeProfile(request.user)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const { id } = request.params as { id: string };
    const employeeId = Number(id);
    const q = (request.query || {}) as { org_id?: string; days?: string };

    let days = Number(q.days);
    if (!Number.isFinite(days) || days < 7) days = 30;
    if (days > 60) days = 60;
    const date = todayMoscow();
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() - (days - 1));
    const from = d.toISOString().slice(0, 10);

    try {
      const empRow = await query(
        `SELECT id, full_name, short_name, role FROM employees WHERE id = $1`,
        [employeeId]
      );
      if (!empRow.rows[0]) return reply.code(404).send({ error: 'not found' });

      const [bfq, gamification, staffDays, shiftsRes] = await Promise.all([
        calculateEmployeeBFQ(employeeId, currentMonthMoscow()),
        getGamificationProfile(employeeId),
        query(
          `SELECT COUNT(DISTINCT work_date)::int as cnt
           FROM schedules
           WHERE employee_id = $1 AND work_date::date >= $2::date AND work_date::date <= $3::date
             AND COALESCE(hours, 0) > 0`,
          [employeeId, from, date]
        ),
        query(
          `SELECT ss.work_date::text as date, ss.store_id, COALESCE(st.display_name, st.name) as store_name,
                  ss.score, ss.ideal_shift, ss.mood
           FROM shift_sessions ss
           LEFT JOIN stores st ON st.id = ss.store_id
           WHERE ss.employee_id = $1 AND ss.status = 'closed'
             AND ss.work_date::date >= $2::date AND ss.work_date::date <= $3::date
           ORDER BY ss.work_date DESC LIMIT 20`,
          [employeeId, from, date]
        )
      ]);

      // Явка — доля запланированных дней периода, на которые была открыта
      // (не обязательно уже закрыта) смена. Тот же staffing-паттерн, что
      // routes-store-profile.ts, только scope сотрудник вместо точки.
      const attendedDays = await query(
        `SELECT COUNT(DISTINCT work_date)::int as cnt
         FROM shift_sessions
         WHERE employee_id = $1 AND work_date::date >= $2::date AND work_date::date <= $3::date`,
        [employeeId, from, date]
      );
      const scheduledCnt = Number(staffDays.rows[0]?.cnt) || 0;
      const attendedCnt = Number(attendedDays.rows[0]?.cnt) || 0;
      const attendancePct = scheduledCnt > 0 ? clamp(Math.round((attendedCnt / scheduledCnt) * 100), 0, 100) : 100;

      const shifts = shiftsRes.rows;
      const idealCount = shifts.filter((s: any) => s.ideal_shift).length;
      const idealRatePct = shifts.length > 0 ? clamp(Math.round((idealCount / shifts.length) * 100), 0, 100) : 0;

      // «План» компонент — среднее по метрикам с ненулевым месячным планом
      // из уже посчитанного BFQ pct (доля факт/план на метрику), капнутое
      // сверху для health-score (сам BFQ бонус за переплан не капает).
      const planPctValues = Object.entries(bfq.plan)
        .filter(([, v]) => Number(v) > 0)
        .map(([k]) => Number((bfq.fact.pct as any)[k]) || 0);
      const planPct = planPctValues.length
        ? clamp(Math.round((planPctValues.reduce((s, v) => s + v, 0) / planPctValues.length) * 100), 0, 100)
        : 0;

      const streakDays = gamification?.streak_days || 0;
      const momentumPct = clamp(Math.round(Math.min(streakDays / 7, 1) * 100), 0, 100);

      const health = Math.round(
        0.4 * planPct + 0.2 * idealRatePct + 0.2 * attendancePct + 0.2 * momentumPct
      );

      return {
        employee: {
          id: empRow.rows[0].id,
          full_name: empRow.rows[0].full_name,
          short_name: empRow.rows[0].short_name,
          role: empRow.rows[0].role
        },
        bfq,
        gamification,
        shifts: { recent: shifts, ideal_rate: idealRatePct },
        health: {
          score: clamp(health, 0, 100),
          components: {
            plan: { value: planPct, weight: 0.4 },
            ideal_shift_rate: { value: idealRatePct, weight: 0.2 },
            attendance: { value: attendancePct, weight: 0.2 },
            momentum: { value: momentumPct, weight: 0.2 }
          }
        },
        period: { from, to: date, days },
        generated_at: new Date().toISOString()
      };
    } catch (e: any) {
      return serverError(request, reply, 'employee_profile_failed', e);
    }
  }
  );
}
