/**
 * Дилеры/Секторы (21.x) — admin-only экран управления, первый настоящий
 * CRUD поверх того, что раньше заводилось только неявно свободным текстом
 * на форме сети (dealers.ts::upsertDealerByName). Тот же гейт-паттерн, что
 * GET /orgs / PUT /admin/org/:id в org/branding.ts.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireManager } from '../../../auth/guards.js';
import { getDealersTree, renameDealer, renameSector, createDealer, createSector } from '../../../core/orgs/dealers.js';
import type { DealersTreeResponse } from '../../../shared/api-types.js';

const RenameBody = Type.Object({ name: Type.String({ minLength: 1 }) });
type RenameBody = Static<typeof RenameBody>;

const CreateDealerBody = Type.Object({ name: Type.String({ minLength: 1 }) });
type CreateDealerBody = Static<typeof CreateDealerBody>;

const CreateSectorBody = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  name: Type.String({ minLength: 1 }),
  dealerId: Type.Optional(Type.Union([Type.Integer(), Type.Null()]))
});
type CreateSectorBody = Static<typeof CreateSectorBody>;

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

  // §D плана (глобальная админка) — до этого дилера/сектора можно было
  // только переименовать, не создать явно (только неявно по имени из
  // формы сети).
  app.post(
    '/admin/dealers',
    { schema: { body: CreateDealerBody } },
    async (request, reply): Promise<{ item: { id: number; name: string } } | FastifyReply | undefined> => {
      if (!requireManager(request, reply)) return;
      if (request.user!.role !== 'admin') {
        return reply.code(403).send({ error: 'admin only' });
      }
      const { name } = request.body as CreateDealerBody;
      const item = await createDealer(name);
      return reply.code(201).send({ item });
    }
  );

  app.post(
    '/admin/sectors',
    { schema: { body: CreateSectorBody } },
    async (request, reply): Promise<{ item: { id: string; name: string; dealer_id: number | null } } | FastifyReply | undefined> => {
      if (!requireManager(request, reply)) return;
      if (request.user!.role !== 'admin') {
        return reply.code(403).send({ error: 'admin only' });
      }
      const { id, name, dealerId } = request.body as CreateSectorBody;
      const item = await createSector(id, name, dealerId ?? null);
      return reply.code(201).send({ item });
    }
  );
}
