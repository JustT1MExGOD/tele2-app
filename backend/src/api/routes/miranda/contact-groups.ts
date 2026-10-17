/**
 * T2 Miranda — личные группы контактов (§2 плана). Доступно и сотруднику,
 * и аккаунту точки (resolveMirandaPrincipal) — группа всегда скоупится на
 * principal.corporateAccountId, никогда на значение из тела запроса.
 * Группа другого владельца отвечает 404 (не 403, чтобы не подтверждать
 * существование чужой группы) — тот же приём, что у миранда-роутов,
 * скоупящих ресурс на запрашивающего.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import * as mirandaService from '../../../core/miranda-accounts/service.js';
import { resolveMirandaPrincipal } from '../../../core/miranda-accounts/service.js';

const GroupIdParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type GroupIdParams = Static<typeof GroupIdParams>;

const MemberParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }), corporateAccountId: Type.String({ pattern: '^[0-9]+$' }) });
type MemberParams = Static<typeof MemberParams>;

const GroupNameBody = Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }) });
type GroupNameBody = Static<typeof GroupNameBody>;

const AddMemberBody = Type.Object({ corporateAccountId: Type.Integer() });
type AddMemberBody = Static<typeof AddMemberBody>;

function statusForMutationError(error: 'not_found' | 'conflict'): number {
  return error === 'not_found' ? 404 : 409;
}

export async function registerMirandaContactGroupRoutes(app: FastifyInstance) {
  app.get('/miranda/groups', async (request, reply) => {
    const principal = await resolveMirandaPrincipal(request, reply);
    if (!principal) return;
    const items = await mirandaService.listContactGroups(principal.corporateAccountId);
    return reply.code(200).send({ items });
  });

  app.post('/miranda/groups', { schema: { body: GroupNameBody } }, async (request, reply) => {
    const principal = await resolveMirandaPrincipal(request, reply);
    if (!principal) return;
    const { name } = request.body as GroupNameBody;
    const result = await mirandaService.createContactGroup(principal.orgId, principal.corporateAccountId, name);
    if (!result.ok) return reply.code(409).send({ error: 'conflict', message: 'Группа с таким названием уже существует' });
    return reply.code(201).send({ item: result.group });
  });

  app.patch(
    '/miranda/groups/:id',
    { schema: { params: GroupIdParams, body: GroupNameBody } },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const { id } = request.params as GroupIdParams;
      const { name } = request.body as GroupNameBody;
      const result = await mirandaService.renameContactGroup(Number(id), principal.corporateAccountId, name, principal.orgId);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );

  app.delete('/miranda/groups/:id', { schema: { params: GroupIdParams } }, async (request, reply) => {
    const principal = await resolveMirandaPrincipal(request, reply);
    if (!principal) return;
    const { id } = request.params as GroupIdParams;
    const result = await mirandaService.deleteContactGroup(Number(id), principal.corporateAccountId, principal.orgId);
    if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
    return reply.code(200).send({ ok: true });
  });

  app.post(
    '/miranda/groups/:id/members',
    { schema: { params: GroupIdParams, body: AddMemberBody } },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const { id } = request.params as GroupIdParams;
      const { corporateAccountId } = request.body as AddMemberBody;
      const result = await mirandaService.addContactToGroup(Number(id), principal.corporateAccountId, corporateAccountId, principal.orgId);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );

  app.delete(
    '/miranda/groups/:id/members/:corporateAccountId',
    { schema: { params: MemberParams } },
    async (request, reply) => {
      const principal = await resolveMirandaPrincipal(request, reply);
      if (!principal) return;
      const { id, corporateAccountId } = request.params as MemberParams;
      const result = await mirandaService.removeContactFromGroup(Number(id), principal.corporateAccountId, Number(corporateAccountId), principal.orgId);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );
}
