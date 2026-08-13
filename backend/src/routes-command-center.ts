/**
 * Command Center (18.1) — единый экран manager/supervisor/admin: «что
 * происходит / где проблема / что делать». Собирает уже существующие
 * источники (buildSupervisorDashboard, smart_alerts) в один ответ вместо
 * трёх отдельных походов с фронта.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireAuth, resolveViewOrgId } from './middleware-auth.js';
import {
  resolveSupervisorStores,
  buildSupervisorDashboard,
  findUnderperformingEmployees
} from './services/supervisor-analytics.js';
import { todayMoscow } from './utils/date.js';

/** Тот же доступ, что у /supervisor/health — это его расширенная версия. */
function canViewCommandCenter(user: { role?: string } | null | undefined): boolean {
  if (!user?.role) return false;
  return user.role === 'supervisor' || user.role === 'manager' || user.role === 'admin';
}

export async function registerCommandCenterRoutes(app: FastifyInstance) {
  app.get('/command-center', async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!canViewCommandCenter(request.user)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    try {
      const q = (request.query || {}) as { org_id?: string; date?: string };
      const date =
        typeof q.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayMoscow();
      const orgId = resolveViewOrgId(request.user!, q.org_id);
      const scope = await resolveSupervisorStores(
        Number(request.user!.employee_id),
        String(request.user!.role),
        orgId
      );

      const dash = await buildSupervisorDashboard({ scope, date, days: 7 });
      const underperforming = await findUnderperformingEmployees(scope, date);

      // Открытые smart_alerts той же сети — тот же запрос, что GET /alerts,
      // отдельная секция: drops вычисляются на лету, smart_alerts — это
      // сработавшие cron-триггеры (кассовый разрыв, простой часа и т.п.),
      // разные источники, не смешиваем их вычисление, но подаём вместе.
      const alertsRes =
        scope === null
          ? await query(
              `SELECT a.*, st.name as store_name FROM smart_alerts a
               LEFT JOIN stores st ON st.id = a.store_id
               WHERE a.status = 'open' ORDER BY a.created_at DESC LIMIT 50`
            )
          : scope.length
            ? await query(
                `SELECT a.*, st.name as store_name FROM smart_alerts a
                 LEFT JOIN stores st ON st.id = a.store_id
                 WHERE a.status = 'open' AND a.store_id = ANY($1)
                 ORDER BY a.created_at DESC LIMIT 50`,
                [scope]
              )
            : { rows: [] as any[] };

      // Единый problems-список — фронту не нужно знать источник, только
      // severity/текст/куда вести. store-level drops уже отсортированы
      // критичными вперёд в dash.drops.
      // create_task (18.4) добавляется КАЖДОЙ проблеме отдельным действием —
      // фронту не нужно знать источник, только что в контексте есть
      // (store_id/employee_id/alert_id), чтобы предзаполнить форму задачи.
      const problems = [
        ...dash.drops.map((d: any) => ({
          severity: d.severity,
          message: d.message,
          store_id: d.store_id,
          store_name: d.store_name,
          ai_comment: d.ai_comment,
          actions: [
            ...(d.store_id ? [{ type: 'open_store', id: d.store_id }] : []),
            { type: 'create_task', store_id: d.store_id || null, employee_id: null, message: d.message }
          ]
        })),
        ...underperforming.map((u) => ({
          severity: 'warn' as const,
          message: `${u.full_name} — 0 продаж сегодня при работающих коллегах`,
          store_id: u.store_id,
          store_name: u.store_name,
          actions: [
            { type: 'open_employee', id: u.employee_id },
            {
              type: 'create_task',
              store_id: u.store_id || null,
              employee_id: u.employee_id,
              message: `${u.full_name} — 0 продаж сегодня`
            }
          ]
        })),
        ...alertsRes.rows.map((a: any) => ({
          severity: a.severity,
          message: a.title,
          store_id: a.store_id,
          store_name: a.store_name,
          alert_id: a.id,
          actions: [
            ...(a.store_id ? [{ type: 'open_store', id: a.store_id }] : []),
            { type: 'create_task', store_id: a.store_id || null, employee_id: null, alert_id: a.id, message: a.title }
          ]
        }))
      ];

      return {
        date,
        network: dash.network,
        stores: dash.stores,
        problems,
        underperforming_count: underperforming.length,
        alerts_count: alertsRes.rows.length,
        generated_at: new Date().toISOString()
      };
    } catch (e: any) {
      console.error('command-center failed:', e?.message || e);
      return reply.code(500).send({ error: 'command_center_failed', message: e?.message || String(e) });
    }
  });
}
