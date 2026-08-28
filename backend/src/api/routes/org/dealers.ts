/**
 * Дилеры/Секторы (21.x) — admin-only экран управления, первый настоящий
 * CRUD поверх того, что раньше заводилось только неявно свободным текстом
 * на форме сети (dealers.ts::upsertDealerByName). Тот же гейт-паттерн, что
 * GET /orgs / PUT /admin/org/:id в org/branding.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireManager } from '../../../auth/guards.js';
import { getDealersTree, renameDealer, renameSector } from '../../../core/orgs/dealers.js';
import type { DealersTreeResponse } from '../../../shared/api-types.js';

const RenameBody = Type.Object({ name: Type.String({ minLength: 1 }) });
type RenameBody = Static<typeof RenameBody>;

export async function registerDealersRoutes(app: FastifyInstance) {
  app.get('/admin/dealers', async (request, reply): Promise<DealersTreeResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    if (request.user!.role !== 'admin') {
      return reply.code(403).send({ error: 'admin only' });
    }
    return getDealersTree();
  });

  app.patch(
    '/admin/dealers/:id',
    { schema: { body: RenameBody } },
    async (request, reply): Promise<{ ok: true } | FastifyReply | undefined> => {
      if (!requireManager(request, reply)) return;
      if (request.user!.role !== 'admin') {
        return reply.code(403).send({ error: 'admin only' });
      }
      const { id } = request.params as { id: string };
      const { name } = request.body as RenameBody;
      await renameDealer(Number(id), name);
      return { ok: true };
    }
  );

  app.patch(
    '/admin/sectors/:id',
    { schema: { body: RenameBody } },
    async (request, reply): Promise<{ ok: true } | FastifyReply | undefined> => {
      if (!requireManager(request, reply)) return;
      if (request.user!.role !== 'admin') {
        return reply.code(403).send({ error: 'admin only' });
      }
      const { id } = request.params as { id: string };
      const { name } = request.body as RenameBody;
      await renameSector(id, name);
      return { ok: true };
    }
  );
}
