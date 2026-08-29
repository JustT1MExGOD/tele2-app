/**
 * What-if симуляция переноса смен: sandbox-прогон и применение к schedules.
 * Выделено из routes-live-alerts.ts (20.11.0, репо-реструктуризация) —
 * живая карта уехала в analytics/live.ts, алерты — в ops/alerts.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireManager, resolveViewOrgId } from '../../../auth/guards.js';
import { simulateScheduleMoves } from '../../../core/analytics/what-if.js';
import { todayMoscow, toDateISO } from '../../../utils/date.js';
import { serverError } from '../../../shared/errors.js';
import * as schedulesRepo from '../../../data/repositories/schedules.js';
import type { WhatIfResponse, WhatIfApplyResponse } from '../../../shared/api-types.js';

// moves — гетерогенные объекты сценария (employee_id/from_store/to_store/
// work_date), from_store фронтенд реально шлёт как null («откуда» не
// выбрано — см. 13-v14.js:285) — additionalProperties: true вместо жёсткой
// типизации каждого поля, тот же принцип, что у SyncOp (routes-shifts.ts).
const WhatIfMove = Type.Object({}, { additionalProperties: true });
const WhatIfBody = Type.Object({
  date: Type.Optional(Type.String()),
  // 20.50.0 — реальный сценарий (менеджер переставляет команду на день) не
  // требует больше пары десятков ходов; каждый move — 2 последовательных
  // запроса в simulateScheduleMoves, без maxItems ограничением была только
  // мягкая Fastify's 1MB body limit.
  moves: Type.Optional(Type.Array(WhatIfMove, { maxItems: 200 })),
  employee_id: Type.Optional(Type.Number()),
  from_store: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  to_store: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type WhatIfBody = Static<typeof WhatIfBody>;

export async function registerWhatIfRoutes(app: FastifyInstance) {
  app.post(
    '/schedule/what-if',
    // 20.50.0 — полная sandbox-симуляция, раньше без собственного лимита.
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: WhatIfBody } },
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
    // 20.50.0 — то же + реальные записи в schedules, чуть жёстче симуляции.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: WhatIfBody } },
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
