/**
 * «Топы сотрудников» (план, 20.75.0) — отдельный топ по каждой метрике
 * каталога (не единственный сводный score, как у
 * core/analytics/supervisor.ts's top_employees), прогресс-бары на
 * фронте, видно ВСЕМ ролям (requireActive, не requireAdmin) за выбранный
 * период. org_id — тот же паттерн, что весь остальной Admin Control
 * Center: своя сеть по умолчанию, admin может явно переключиться
 * (resolveViewOrgId, org-switcher в шапке с 20.73.0).
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, resolveViewOrgId } from '../../auth/guards.js';
import { getEmployeeLeaderboard } from '../../core/shared/metrics-catalog.js';
import { todayMoscow, currentMonthMoscow, monthStart } from '../../utils/date.js';
import type { LeaderboardResponse } from '../../shared/api-types.js';

const LeaderboardQuery = Type.Object({
  metric: Type.String({ minLength: 1, maxLength: 30 }),
  from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  to: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  org_id: Type.Optional(Type.String({ maxLength: 64 }))
});
type LeaderboardQuery = Static<typeof LeaderboardQuery>;

export async function registerLeaderboardRoutes(app: FastifyInstance) {
  app.get('/leaderboard', { schema: { querystring: LeaderboardQuery } }, async (request, reply): Promise<LeaderboardResponse | FastifyReply | undefined> => {
    if (!requireActive(request, reply)) return;
    const { metric, from, to, org_id } = request.query as LeaderboardQuery;
    const orgId = resolveViewOrgId(request.user!, org_id);
    const effectiveFrom = from || monthStart(currentMonthMoscow());
    const effectiveTo = to || todayMoscow();
    if (effectiveFrom > effectiveTo) {
      return reply.code(400).send({ error: 'invalid_range', message: '"from" не может быть позже "to"' });
    }
    const result = await getEmployeeLeaderboard([orgId], metric, effectiveFrom, effectiveTo);
    if (result.ok === false) {
      return reply.code(400).send({ error: result.error, message: 'Неизвестная метрика' });
    }
    return reply.code(200).send({ metric: result.result.metric, from: effectiveFrom, to: effectiveTo, items: result.result.items });
  });
}
