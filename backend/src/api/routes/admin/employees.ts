/**
 * Admin Control Center (20.59.0) — Employee admin: detail view + safe
 * actions. Role-change reuses the exact escalation/step-up/audit
 * pattern already enforced by PATCH /employees/:id/role
 * (api/routes/org/employees.ts) — not re-derived here.
 */
import { FastifyInstance } from 'fastify';
import { withTransaction } from '../../../data/db/index.js';
import { requireAdmin, resolveViewOrgId, canAssignRole, isMfaMandatoryForRole, Role } from '../../../auth/guards.js';
import { assertStepUp } from '../../../auth/step-up.js';
import { record as recordAudit } from '../../../data/repositories/audit.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as sessionsRepo from '../../../data/repositories/sessions.js';
import * as mfaRepo from '../../../data/repositories/mfa.js';

function actorFields(request: any) {
  return {
    actorEmployeeId: request.user!.employee_id,
    actorTelegramId: request.user!.telegram_id ? Number(request.user!.telegram_id) : null,
    actorRole: request.user!.role
  };
}

export async function registerAdminEmployeesRoutes(app: FastifyInstance) {
  app.get('/admin/employees/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const row = await employeesRepo.findAdminProfileById(Number(id));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const sessions = await sessionsRepo.listForEmployee(Number(id));
    return { employee: row, sessions };
  });

  app.patch('/admin/employees/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { full_name?: string; short_name?: string; org_id?: string };
    const before = await employeesRepo.findById(Number(id));
    if (!before) return reply.code(404).send({ error: 'not_found' });
    const row = await withTransaction(async (q) => {
      const updated = await employeesRepo.updateFields(Number(id), body, q);
      await recordAudit({
        orgId: resolveViewOrgId(request.user!, body.org_id ?? undefined),
        ...actorFields(request),
        action: 'admin.employee_edit',
        targetType: 'employee',
        targetId: id,
        before: { full_name: before.full_name, short_name: (before as any).short_name },
        after: body,
        requestId: request.id
      }, q);
      return updated;
    });
    if (!row) return reply.code(400).send({ error: 'no_fields' });
    return { employee: row };
  });

  app.post('/admin/employees/:id/role', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { role: Role; org_id?: string };
    if (!canAssignRole(request.user!.role, body.role)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Можно назначать только роли ниже своей' });
    }
    const beforeRole = await employeesRepo.getRole(Number(id));
    const isEscalation = isMfaMandatoryForRole(body.role) && body.role !== beforeRole;
    if (isEscalation && !(await assertStepUp(request, reply))) return;

    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const row = await withTransaction(async (q) => {
      const res = await employeesRepo.updateRole(Number(id), body.role, orgId, q);
      await recordAudit({
        orgId,
        ...actorFields(request),
        action: 'admin.employee_role_change',
        targetType: 'employee',
        targetId: id,
        before: { role: beforeRole ?? null },
        after: { role: body.role },
        requestId: request.id
      }, q);
      return res;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (isMfaMandatoryForRole(beforeRole as any) || isEscalation) {
      await sessionsRepo.deleteAllForEmployee(Number(id));
    }
    return { employee: row };
  });

  app.post('/admin/employees/:id/deactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const orgId = resolveViewOrgId(request.user!, (request.body as any)?.org_id);
    const row = await withTransaction(async (q) => {
      const res = await employeesRepo.softDeactivate(Number(id), q);
      if (res) {
        await recordAudit({
          orgId, ...actorFields(request), action: 'admin.employee_deactivate',
          targetType: 'employee', targetId: id, before: { is_active: true }, after: { is_active: false },
          requestId: request.id
        }, q);
      }
      return res;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { employee: row };
  });

  app.post('/admin/employees/:id/reactivate', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const orgId = resolveViewOrgId(request.user!, (request.body as any)?.org_id);
    const row = await withTransaction(async (q) => {
      const res = await employeesRepo.updateFields(Number(id), { is_active: true } as any, q);
      if (res) {
        await recordAudit({
          orgId, ...actorFields(request), action: 'admin.employee_reactivate',
          targetType: 'employee', targetId: id, before: { is_active: false }, after: { is_active: true },
          requestId: request.id
        }, q);
      }
      return res;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { employee: row };
  });

  app.delete('/admin/employees/:id/sessions/:sessionId', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id, sessionId } = request.params as { id: string; sessionId: string };
    const deleted = await sessionsRepo.deleteById(Number(sessionId), Number(id));
    if (!deleted) return reply.code(404).send({ error: 'not_found' });
    await recordAudit({
      orgId: resolveViewOrgId(request.user!, (request.query as any)?.org_id),
      ...actorFields(request),
      action: 'admin.session_revoke',
      targetType: 'employee',
      targetId: id,
      before: { session_id: sessionId },
      after: null,
      requestId: request.id
    });
    return { ok: true };
  });

  app.post('/admin/employees/:id/sessions/revoke-all', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    await sessionsRepo.deleteAllForEmployee(Number(id));
    await recordAudit({
      orgId: resolveViewOrgId(request.user!, (request.body as any)?.org_id),
      ...actorFields(request),
      action: 'admin.session_revoke_all',
      targetType: 'employee',
      targetId: id,
      before: null,
      after: null,
      requestId: request.id
    });
    return { ok: true };
  });

  app.post('/admin/employees/:id/mfa/reset', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (!(await assertStepUp(request, reply))) return;
    const { id } = request.params as { id: string };
    await mfaRepo.deleteTotp(Number(id));
    await mfaRepo.deleteAllRecoveryCodes(Number(id));
    await recordAudit({
      orgId: resolveViewOrgId(request.user!, (request.body as any)?.org_id),
      ...actorFields(request),
      action: 'admin.mfa_reset',
      targetType: 'employee',
      targetId: id,
      before: null,
      after: null,
      requestId: request.id
    });
    return { ok: true };
  });

  app.post('/admin/employees/:id/password-reset', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const token = await sessionsRepo.createPasswordReset(Number(id), request.user!.employee_id);
    await recordAudit({
      orgId: resolveViewOrgId(request.user!, (request.body as any)?.org_id),
      ...actorFields(request),
      action: 'admin.password_reset_initiated',
      targetType: 'employee',
      targetId: id,
      before: null,
      after: null,
      requestId: request.id
    });
    return { token };
  });
}
