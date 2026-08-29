/**
 * Умные алерты по точкам: список/подтверждение/смена статуса/ручной запуск.
 * Выделено из routes-live-alerts.ts (20.11.0, репо-реструктуризация) —
 * живая карта уехала в analytics/live.ts, what-if — в analytics/what-if.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireManager, resolveViewOrgId, assertStoreInOrg } from '../../../auth/guards.js';
import { runSmartAlertsTick } from '../../../core/alerts/service.js';
import { getEffectivenessSummary } from '../../../core/analytics/learn.js';
import * as alertsRepo from '../../../data/repositories/alerts.js';
import type { AlertsListResponse, ChangeAlertStatusResponse, EffectivenessSummaryResponse } from '../../../shared/api-types.js';

const AlertOrgBody = Type.Object({
  org_id: Type.Optional(Type.String())
});
type AlertOrgBody = Static<typeof AlertOrgBody>;

const AlertStatusBody = Type.Object({
  org_id: Type.Optional(Type.String()),
  status: Type.Optional(Type.String())
});
type AlertStatusBody = Static<typeof AlertStatusBody>;

export async function registerAlertsRoutes(app: FastifyInstance) {
  const VALID_ALERT_STATUSES = new Set(['open', 'acked', 'in_progress', 'resolved', 'dismissed']);

  // status по умолчанию 'open' — обратная совместимость с тем, как этот
  // роут работал до 18.6 (был жёстко захардкожен на открытые алерты).
  app.get('/alerts', async (request, reply): Promise<AlertsListResponse | undefined> => {
    if (!requireManager(request, reply)) return;
    const { org_id, status } = request.query as { org_id?: string; status?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const statusFilter = status && VALID_ALERT_STATUSES.has(status) ? status : 'open';
    return alertsRepo.listForOrg(orgId, statusFilter);
  });

  app.post(
    '/alerts/:id/ack',
    { schema: { body: AlertOrgBody } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = (request.body || {}) as AlertOrgBody;
    const orgId = resolveViewOrgId(request.user!, org_id);
    const alert = await alertsRepo.findStoreId(Number(id));
    if (!alert) return reply.code(404).send({ error: 'not found' });
    // Раньше можно было погасить чужой алерт, зная/угадав его id (обычный
    // инкрементный bigint) — manager другой сети мог тихо снять критический
    // алерт вообще любой сети.
    if (alert.store_id && !(await assertStoreInOrg(alert.store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Алерт не принадлежит вашей сети' });
    }
    return alertsRepo.ack(Number(id), request.user!.employee_id);
    }
  );

  // 18.6 — полный жизненный цикл алерта (не только open->acked). /ack
  // остаётся отдельным эндпоинтом для обратной совместимости, но теперь
  // это частный случай той же логики.
  app.post(
    '/alerts/:id/status',
    { schema: { body: AlertStatusBody } },
    async (request, reply): Promise<ChangeAlertStatusResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as AlertStatusBody;
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const alert = await alertsRepo.findStoreId(Number(id));
    if (!alert) return reply.code(404).send({ error: 'not found' });
    if (alert.store_id && !(await assertStoreInOrg(alert.store_id, orgId))) {
      return reply.code(403).send({ error: 'forbidden', message: 'Алерт не принадлежит вашей сети' });
    }
    const status = String(body.status || '');
    if (!VALID_ALERT_STATUSES.has(status) || status === 'open') {
      return reply.code(400).send({ error: 'invalid status' });
    }
    return alertsRepo.setStatus(Number(id), status, request.user!.employee_id);
    }
  );

  // Product Analytics (20.34) — первый просмотр алерта менеджером. Простое
  // "открыли/нет" (announcements/:id/read задаёт тот же уровень строгости —
  // requireAuth без org-проверки владения, здесь чуть строже requireManager,
  // потому что сама страница алертов уже под этим гейтом), без body.
  app.post('/alerts/:id/read', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    await alertsRepo.markOpened(Number(id));
    return { ok: true };
  });

  app.post(
    '/alerts/run',
    // 20.50.0 — ручной триггер полного прохода smart-алертов по всем
    // точкам сети, редкое admin-действие.
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return runSmartAlertsTick();
    }
  );

  // Learn (21.x) — сработала ли рекомендация: сводка по всей сети разом
  // (across org'ов), как /orgs — admin-only, не scoped по сети.
  app.get('/alerts/effectiveness', async (request, reply): Promise<EffectivenessSummaryResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    return getEffectivenessSummary();
  });
}
