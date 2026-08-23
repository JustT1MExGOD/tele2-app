/**
 * Промокоды RTK.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { resolveViewOrgId } from '../../auth/guards.js';
import { serverError } from '../../shared/errors.js';
import * as promosRepo from '../../data/repositories/promos.js';
import type {
  PromosListResponse,
  PromoCard,
  CreatePromoResponse,
  PromoActionResponse
} from '../../shared/api-types.js';

const PostPromoBody = Type.Object({
  code: Type.String({ minLength: 1 }),
  note: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type PostPromoBody = Static<typeof PostPromoBody>;

function maskPromoCode(code: string) {
  const s = String(code || '');
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-2);
}

function resolveEmployeeFromRequest(request: any): {
  employee_id: number;
  full_name: string;
  role: string;
  org_id: string;
} | null {
  const u = request.user;
  if (!u || !u.employee_id || u.access_status !== 'active') return null;
  return { employee_id: u.employee_id, full_name: u.full_name || '', role: u.role, org_id: u.org_id };
}

export async function registerPromosRoutes(app: FastifyInstance) {
  app.get('/promos', async (request, reply): Promise<PromosListResponse | FastifyReply> => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Привяжите Telegram' });
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    try {
      const rows = await promosRepo.listUnused(orgId);
      return {
        items: rows.map((r: any) => ({
          id: r.id,
          mask: maskPromoCode(r.code),
          note: r.note,
          created_by_name: r.created_by_name,
          created_at: r.created_at
        }))
      };
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }
  });

  app.get('/promos/:id', async (request, reply): Promise<PromoCard | FastifyReply> => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number((request.params as any).id);
    const orgId = resolveViewOrgId(request.user!);
    try {
      const row = await promosRepo.findUnusedById(id, orgId);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return row;
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }
  });

  app.post(
    '/promos',
    { schema: { body: PostPromoBody } },
    async (request, reply): Promise<CreatePromoResponse | FastifyReply> => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const body = request.body as PostPromoBody;
    const code = String(body.code || '').trim();
    if (!code) return reply.code(400).send({ error: 'code_required' });
    const note = body.note ? String(body.note).slice(0, 200) : null;
    const orgId = resolveViewOrgId(request.user!, body.org_id);
    try {
      const item = await promosRepo.create(code, note, user.employee_id, user.full_name, orgId);
      return { ok: true, item };
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }
    }
  );

  app.post('/promos/:id/use', async (request, reply): Promise<PromoActionResponse | FastifyReply> => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number((request.params as any).id);
    const orgId = resolveViewOrgId(request.user!);
    try {
      const used = await promosRepo.markUsed(id, user.employee_id, orgId);
      if (!used) return reply.code(404).send({ error: 'not_found' });
      return { ok: true, used: true };
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }
  });

  app.post('/promos/:id/keep', async (request, reply): Promise<PromoActionResponse | FastifyReply> => {
    const user = resolveEmployeeFromRequest(request);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return { ok: true, used: false };
  });
}
