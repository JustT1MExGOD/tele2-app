/**
 * T2 Miranda — группы контактов, общие для всего дилера на чтение (§2
 * плана). Чтение (GET) доступно любому принципалу мессенджера (сотрудник
 * или точка) через resolveMirandaPrincipal — скоупится на
 * principal.dealerOrgIds (не трогаем, см. план дилер-видимости). Мутации
 * (создание/переименование/удаление/состав) — §A плана "Глобальная
 * админка": requireAdmin, глобально в любой сети любого дилера (явный
 * orgId в теле создания группы, провалидированный только на
 * существование сети — не на принадлежность дилеру админа); та же
 * гарантия, что у остальных admin-only Miranda-роутов в accounts.ts;
 * точечные аккаунты (нет request.user) не проходят requireAdmin в
 * принципе.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import * as mirandaService from '../../../core/miranda-accounts/service.js';
import { resolveMirandaPrincipal } from '../../../core/miranda-accounts/service.js';
import { requireAdmin, resolveViewOrgId } from '../../../auth/guards.js';
import * as orgsRepo from '../../../data/repositories/organizations.js';

const GroupIdParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type GroupIdParams = Static<typeof GroupIdParams>;

const MemberParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }), corporateAccountId: Type.String({ pattern: '^[0-9]+$' }) });
type MemberParams = Static<typeof MemberParams>;

const CreateGroupBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  parentGroupId: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  orgId: Type.Optional(Type.String({ maxLength: 64 }))
});
type CreateGroupBody = Static<typeof CreateGroupBody>;

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
    const items = await mirandaService.listContactGroups(principal.dealerOrgIds);
    return reply.code(200).send({ items });
  });

  app.post('/miranda/groups', { schema: { body: CreateGroupBody } }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { name, parentGroupId, orgId: bodyOrgId } = request.body as CreateGroupBody;
    const orgId = resolveViewOrgId(request.user!, bodyOrgId);
    if (orgId !== request.user!.org_id && !(await orgsRepo.findActiveById(orgId))) {
      return reply.code(404).send({ error: 'org_not_found', message: 'Сеть не найдена' });
    }
    const result = await mirandaService.createContactGroup(orgId, name, parentGroupId ?? null, request.user!.employee_id!);
    if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error, message: result.error === 'conflict' ? 'Группа с таким названием уже существует' : 'Родительская группа не найдена' });
    return reply.code(201).send({ item: result.group });
  });

  app.patch(
    '/miranda/groups/:id',
    { schema: { params: GroupIdParams, body: GroupNameBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { id } = request.params as GroupIdParams;
      const { name } = request.body as GroupNameBody;
      const result = await mirandaService.renameContactGroup(Number(id), name, request.user!.org_id, request.user!.employee_id!);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );

  app.delete('/miranda/groups/:id', { schema: { params: GroupIdParams } }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as GroupIdParams;
    const result = await mirandaService.deleteContactGroup(Number(id), request.user!.org_id, request.user!.employee_id!);
    if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
    return reply.code(200).send({ ok: true });
  });

  app.post(
    '/miranda/groups/:id/members',
    { schema: { params: GroupIdParams, body: AddMemberBody } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { id } = request.params as GroupIdParams;
      const { corporateAccountId } = request.body as AddMemberBody;
      const result = await mirandaService.addContactToGroup(Number(id), corporateAccountId, request.user!.org_id, request.user!.employee_id!);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );

  app.delete(
    '/miranda/groups/:id/members/:corporateAccountId',
    { schema: { params: MemberParams } },
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const { id, corporateAccountId } = request.params as MemberParams;
      const result = await mirandaService.removeContactFromGroup(Number(id), Number(corporateAccountId), request.user!.org_id, request.user!.employee_id!);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );
}
