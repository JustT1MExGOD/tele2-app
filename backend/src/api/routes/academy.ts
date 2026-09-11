/**
 * T2 Academy — redesigned onboarding/tutorial: server-side progress/XP/
 * badge persistence (so mobile/Telegram and desktop stay in sync, and
 * reinstall/cache-clear doesn't reset meaningful progress — see
 * core/academy/service.ts). Course CONTENT itself is frontend data
 * (features/tutorial/courses/*); this only tracks completion and grants
 * server-authoritative rewards (core/academy/rewards.ts).
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive } from '../../auth/guards.js';
import * as academyService from '../../core/academy/service.js';

const CompleteStepBody = Type.Object({
  step_id: Type.String({ minLength: 1, maxLength: 100 })
});
type CompleteStepBody = Static<typeof CompleteStepBody>;

const DismissContextualBody = Type.Object({
  context_id: Type.String({ minLength: 1, maxLength: 100 })
});
type DismissContextualBody = Static<typeof DismissContextualBody>;

export async function registerAcademyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/academy/progress', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    return academyService.getProgress(request.user!.employee_id!);
  });

  app.post(
    '/academy/progress/complete-step',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { body: CompleteStepBody } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const { step_id } = request.body as CompleteStepBody;
      return academyService.completeStep(request.user!.employee_id!, step_id);
    }
  );

  app.get('/academy/contextual/:contextId', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { contextId } = request.params as { contextId: string };
    const dismissed = await academyService.hasDismissedContextual(request.user!.employee_id!, contextId);
    return { dismissed };
  });

  app.post(
    '/academy/contextual/dismiss',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { body: DismissContextualBody } },
    async (request, reply) => {
      if (!requireActive(request, reply)) return;
      const { context_id } = request.body as DismissContextualBody;
      await academyService.dismissContextual(request.user!.employee_id!, context_id);
      return { ok: true };
    }
  );
}
