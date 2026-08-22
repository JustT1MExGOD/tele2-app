/**
 * Кабинет супервайзера — отдельный визуал в приложении, изолирован от
 * manager/senior; admin заходит через явную кнопку.
 *
 * GET /supervisor/dashboard  — полная аналитика (health, просадки, тренд, топ).
 *   Доступ: supervisor | admin.
 * GET /supervisor/health     — короткий срез для Command Center на главной
 *   manager/admin (их СОБСТВЕННАЯ сеть, не сектор) — отдельная фича на том
 *   же движке, кабинета супервайзера не касается.
 *   Доступ: supervisor | manager | admin.
 *
 * Supervisor = руководитель сектора, видит все точки всех сетей своего
 * сектора (supervisor_sectors → organizations → stores);
 * manager/admin — всю сеть (scope = null).
 *
 * ВАЖНО: маршрут /supervisor/dashboard регистрируется ТОЛЬКО здесь.
 * В routes-v8.ts старая реализация удалена, иначе Fastify падает:
 * "Method GET already declared for route '/supervisor/dashboard'".
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { authPlugin, requireAuth, requireManager, resolveViewOrgId } from './middleware-auth.js';
import {
  resolveSupervisorStores,
  buildSupervisorDashboard
} from './services/supervisor-analytics.js';
import { todayMoscow } from './utils/date.js';
import { serverError } from './utils/http-errors.js';
import { getStats as getScopeCacheStats } from './services/scope-cache.js';
import type { SupervisorDashboardResponse, SupervisorHealthResponse } from './shared/api-types.js';

/** Полный кабинет супервайзера — только supervisor/admin. Раньше сюда же
 * пускали manager, но кабинет теперь изолирован от manager/senior (свой
 * отдельный визуал в приложении); admin сохраняет доступ через явную
 * кнопку. НЕ путать с canViewSupervisorHealth() ниже — /supervisor/health
 * питает совсем другую фичу (Command Center manager'а на главной). */
function canViewSupervisor(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'supervisor' || user.role === 'admin';
}

/** Лёгкий срез для виджета «Сеть за минуту» на главной странице — это
 * ЕГО СОБСТВЕННАЯ сеть для manager/admin (аналитика по одной сети, не по
 * сектору), просто исторически считается тем же движком, что и полный
 * кабинет супервайзера. Изоляция кабинета супервайзера её не касается. */
function canViewSupervisorHealth(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'supervisor' || user.role === 'manager' || user.role === 'admin';
}

export async function registerSupervisorRoutes(app: FastifyInstance) {
  // Подставляем request.user из X-Telegram-Id на каждый запрос модуля
  app.get('/supervisor/dashboard', async (request, reply): Promise<SupervisorDashboardResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    if (!canViewSupervisor(request.user)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Только supervisor / admin'
      });
    }

    const q = (request.query || {}) as { date?: string; days?: string; org_id?: string };
    // date: YYYY-MM-DD; days: глубина тренда 7…60 (по умолчанию 14)
    const date =
      typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date)
        ? q.date
        : todayMoscow();
    let days = Number(q.days);
    if (!Number.isFinite(days) || days < 7) days = 14;
    if (days > 60) days = 60;

    try {
      // Admin, заглянувший в кабинет супервайзера через кнопку — видит ВСЁ
      // (scope=null), не одну сеть. resolveSupervisorStores() для role=admin
      // резолвит в одну сеть (orgId) — это верно для /supervisor/health
      // (виджет "Сеть за минуту" на ЕГО ГЛАВНОЙ — своя сеть), но не для
      // самого кабинета: кабинет — это "весь сектор", а у admin нет
      // персонального сектора, значит логичный эквивалент — вообще все сети.
      // Баг найден по живой жалобе: точки РТТ Гуреева не показывались вовсе,
      // видна была только своя (default) сеть админа.
      let scope;
      if (request.user!.role === 'admin') {
        scope = null;
      } else {
        const orgId = resolveViewOrgId(request.user!, q.org_id);
        scope = await resolveSupervisorStores(
          Number(request.user!.employee_id),
          String(request.user!.role),
          orgId
        );
      }
      return await buildSupervisorDashboard({ scope, date, days });
    } catch (e: any) {
      return serverError(request, reply, 'dashboard_failed', e);
    }
  });

  app.get('/supervisor/health', async (request, reply): Promise<SupervisorHealthResponse | FastifyReply | undefined> => {
    if (!requireAuth(request, reply)) return;
    if (!canViewSupervisorHealth(request.user)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    try {
      const q = (request.query || {}) as { org_id?: string };
      const orgId = resolveViewOrgId(request.user!, q.org_id);
      const scope = await resolveSupervisorStores(
        Number(request.user!.employee_id),
        String(request.user!.role),
        orgId
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
      return serverError(request, reply, 'health_failed', e);
    }
  });

  // Ops/debug-метрика (19.25.0, Supervisor Scope Cache) — не бизнес-функция,
  // голый JSON для проверки эффективности кэша, не отдельный UI-экран.
  app.get('/admin/cache-stats', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    return { supervisor_scope: getScopeCacheStats() };
  });
}
