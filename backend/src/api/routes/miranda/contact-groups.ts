/**
 * T2 Miranda — группы контактов, общие для всего дилера (§2 плана,
 * пересмотр после фидбэка: не личный контакт-лист каждого аккаунта, а
 * разметка, которую задаёт администратор для всех сразу; дилер-видимость —
 * отдельный план "T2 Miranda — видимость контактов/групп/переписки в
 * рамках всего дилера"). Чтение (GET) доступно любому принципалу
 * мессенджера (сотрудник или точка) через resolveMirandaPrincipal —
 * скоупится на dealerOrgIds. Мутации (создание/переименование/удаление/
 * состав) — только requireAdmin, та же гарантия, что у остальных
 * admin-only Miranda-роутов в accounts.ts; точечные аккаунты (нет
 * request.user) не проходят requireAdmin в принципе. requireAdmin не даёт
 * доступа к dealerOrgIds из resolveMirandaPrincipal (это разные пути
 * резолва принципала) — каждый мутирующий роут резолвит его явно через
 * mirandaService.resolveDealerOrgIds(request.user!.org_id).
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import * as mirandaService from '../../../core/miranda-accounts/service.js';
import { resolveMirandaPrincipal } from '../../../core/miranda-accounts/service.js';
import { requireAdmin } from '../../../auth/guards.js';

const GroupIdParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }) });
type GroupIdParams = Static<typeof GroupIdParams>;

const MemberParams = Type.Object({ id: Type.String({ pattern: '^[0-9]+$' }), corporateAccountId: Type.String({ pattern: '^[0-9]+$' }) });
type MemberParams = Static<typeof MemberParams>;

const CreateGroupBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  parentGroupId: Type.Optional(Type.Union([Type.Integer(), Type.Null()]))
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
    const { name, parentGroupId } = request.body as CreateGroupBody;
    const dealerOrgIds = await mirandaService.resolveDealerOrgIds(request.user!.org_id);
    const result = await mirandaService.createContactGroup(request.user!.org_id, dealerOrgIds, name, parentGroupId ?? null, request.user!.employee_id!);
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
      const dealerOrgIds = await mirandaService.resolveDealerOrgIds(request.user!.org_id);
      const result = await mirandaService.renameContactGroup(Number(id), name, request.user!.org_id, dealerOrgIds, request.user!.employee_id!);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );

  app.delete('/miranda/groups/:id', { schema: { params: GroupIdParams } }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as GroupIdParams;
    const dealerOrgIds = await mirandaService.resolveDealerOrgIds(request.user!.org_id);
    const result = await mirandaService.deleteContactGroup(Number(id), request.user!.org_id, dealerOrgIds, request.user!.employee_id!);
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
      const dealerOrgIds = await mirandaService.resolveDealerOrgIds(request.user!.org_id);
      const result = await mirandaService.addContactToGroup(Number(id), corporateAccountId, request.user!.org_id, dealerOrgIds, request.user!.employee_id!);
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
      const dealerOrgIds = await mirandaService.resolveDealerOrgIds(request.user!.org_id);
      const result = await mirandaService.removeContactFromGroup(Number(id), Number(corporateAccountId), request.user!.org_id, dealerOrgIds, request.user!.employee_id!);
      if (result.ok === false) return reply.code(statusForMutationError(result.error)).send({ error: result.error });
      return reply.code(200).send({ ok: true });
    }
  );
}
