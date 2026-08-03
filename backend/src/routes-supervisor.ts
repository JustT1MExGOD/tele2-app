/**
 * Кабинет супервайзера / управляющего
 *
 * GET /supervisor/dashboard  — полная аналитика (health, просадки, тренд, топ)
 * GET /supervisor/health     — короткий срез для виджетов
 *
 * Доступ: supervisor | manager | admin
 * Supervisor видит только точки из supervisor_stores;
 * manager/admin — всю сеть (scope = null).
 *
 * ВАЖНО: маршрут /supervisor/dashboard регистрируется ТОЛЬКО здесь.
 * В routes-v8.ts старая реализация удалена, иначе Fastify падает:
 * "Method GET already declared for route '/supervisor/dashboard'".
 */

import { FastifyInstance } from 'fastify';
import { authPlugin, requireAuth } from './middleware-auth.js';
import {
  resolveSupervisorStores,
  buildSupervisorDashboard
} from './services/supervisor-analytics.js';
import { todayMoscow } from './utils/date.js';

/** Роли, которым доступен кабинет аналитики */
function canViewSupervisor(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'supervisor' || user.role === 'manager' || user.role === 'admin';
}

export async function registerSupervisorRoutes(app: FastifyInstance) {
  // Подставляем request.user из X-Telegram-Id на каждый запрос модуля
  app.addHook('preHandler', authPlugin);

  app.get('/supervisor/dashboard', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!canViewSupervisor(request.user)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Только supervisor / manager / admin'
      });
    }

    const q = (request.query || {}) as { date?: string; days?: string };
    // date: YYYY-MM-DD; days: глубина тренда 7…60 (по умолчанию 14)
    const date =
      typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date)
        ? q.date
        : todayMoscow();
    let days = Number(q.days);
    if (!Number.isFinite(days) || days < 7) days = 14;
    if (days > 60) days = 60;

    try {
      const scope = await resolveSupervisorStores(
        Number(request.user!.employee_id),
        String(request.user!.role)
      );
      return await buildSupervisorDashboard({ scope, date, days });
    } catch (e: any) {
      request.log?.error?.(e);
      console.error('supervisor/dashboard failed:', e?.message || e);
      return reply.code(500).send({
        error: 'dashboard_failed',
        message: e?.message || String(e)
      });
    }
  });

  app.get('/supervisor/health', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!canViewSupervisor(request.user)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    try {
      const scope = await resolveSupervisorStores(
        Number(request.user!.employee_id),
        String(request.user!.role)
      );
      const dash = await buildSupervisorDashboard({
        scope,
        date: todayMoscow(),
        days: 7
      });
      return {
        health: dash.network?.health ?? 0,
        overall_pct: dash.network?.overall_pct ?? 0,
        pace_delta: dash.network?.pace_delta ?? 0,
        drops: Array.isArray(dash.drops) ? dash.drops.slice(0, 5) : [],
        date: dash.date
      };
    } catch (e: any) {
      console.error('supervisor/health failed:', e?.message || e);
      return reply.code(500).send({
        error: 'health_failed',
        message: e?.message || String(e)
      });
    }
  });
}
