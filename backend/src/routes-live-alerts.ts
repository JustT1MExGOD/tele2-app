/**
 * Живая карта сети, умные алерты, what-if симуляция переноса смен.
 * Выделено из routes-v13.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireAuth, requireManager, resolveViewOrgId, assertStoreInOrg } from './middleware-auth.js';
import { getLiveNetworkMap } from './services/live-map.js';
import { runSmartAlertsTick } from './services/alerts.js';
import { simulateScheduleMoves } from './services/what-if.js';
import { todayMoscow, toDateISO } from './utils/date.js';
import { serverError } from './utils/http-errors.js';
import * as alertsRepo from './repositories/alerts.js';
import * as schedulesRepo from './repositories/schedules.js';
import type { AlertsListResponse, ChangeAlertStatusResponse, WhatIfResponse, WhatIfApplyResponse, NetworkLiveResponse } from './shared/api-types.js';

const AlertOrgBody = Type.Object({
  org_id: Type.Optional(Type.String())
});
type AlertOrgBody = Static<typeof AlertOrgBody>;

const AlertStatusBody = Type.Object({
  org_id: Type.Optional(Type.String()),
  status: Type.Optional(Type.String())
});
type AlertStatusBody = Static<typeof AlertStatusBody>;

// moves — гетерогенные объекты сценария (employee_id/from_store/to_store/
// work_date), from_store фронтенд реально шлёт как null («откуда» не
// выбрано — см. 13-v14.js:285) — additionalProperties: true вместо жёсткой
// типизации каждого поля, тот же принцип, что у SyncOp (routes-shifts.ts).
const WhatIfMove = Type.Object({}, { additionalProperties: true });
const WhatIfBody = Type.Object({
  date: Type.Optional(Type.String()),
  moves: Type.Optional(Type.Array(WhatIfMove)),
  employee_id: Type.Optional(Type.Number()),
  from_store: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  to_store: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type WhatIfBody = Static<typeof WhatIfBody>;

export async function registerLiveAlertsRoutes(app: FastifyInstance) {
  // ========== LIVE MAP + ALERTS ==========
  app.get('/network/live', async (request, reply): Promise<NetworkLiveResponse | undefined> => {
    if (!requireAuth(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    return getLiveNetworkMap(resolveViewOrgId(request.user!, org_id));
  });

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

  app.post('/alerts/run', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    return runSmartAlertsTick();
  });

  // ========== WHAT-IF ==========
  app.post(
    '/schedule/what-if',
    { schema: { body: WhatIfBody } },
    async (request, reply): Promise<WhatIfResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as WhatIfBody;
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
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    try {
      return await simulateScheduleMoves({ date: body.date, moves: moves as any, orgId });
    } catch (e: any) {
      return serverError(request, reply, 'what_if_failed', e);
    }
    }
  );

  /** Применить what-if сдвиги в schedules (реальная запись) */
  app.post(
    '/schedule/what-if/apply',
    { schema: { body: WhatIfBody } },
    async (request, reply): Promise<WhatIfApplyResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as WhatIfBody;
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

    // Точки не своей сети simulateScheduleMoves теперь просто не видит
    // (coverage строится только по своей сети) — moves на них уже придут
    // сюда как skipped: 'unknown_store', реальной записи в schedules не будет.
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const sim = await simulateScheduleMoves({ date, moves: moves as any, orgId });
    const applied = [];
    for (const m of sim.moves_applied || []) {
      if (m.skipped) continue;
      const emp = Number(m.employee_id);
      const to = m.to_store || m.to;
      if (!emp || !to) continue;

      // сохранить shift_text/hours с текущей смены если есть
      const cur = await schedulesRepo.findShiftTextAndHours(emp, date);
      const shift_text = cur?.shift_text || '10-21';
      const hours = Number(cur?.hours) || 11;

      const saved = await schedulesRepo.upsert(emp, to, date, shift_text, hours);
      applied.push(saved);
    }

    return {
      ok: true,
      date,
      count: applied.length,
      items: applied,
      simulation: sim
    };
    }
  );
}
