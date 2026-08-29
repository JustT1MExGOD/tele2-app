/**
 * Step-up auth (AAL3 — "fresh proof of possession for THIS dangerous
 * action") — channel-agnostic by design: works identically whether the
 * admin is authenticated via Telegram initData (no persistent
 * server-side session at all) or a browser employee_sessions cookie.
 *
 * Deliberately NOT session-freshness-based (e.g. "was MFA done in the
 * last 15 minutes of this session") — Telegram has no session object to
 * attach that freshness state to. Instead: a short-lived opaque bearer
 * ticket (mfa_step_up_tickets), obtained by POST /auth/mfa/step-up with
 * a fresh MFA proof, sent back as X-Step-Up-Token on the dangerous
 * request. Getting a ticket at all REQUIRES a confirmed MFA factor to
 * exist (auth/mfa/*.ts verify functions return false otherwise) — this
 * is what actually enforces "no dangerous action without MFA configured",
 * not a separate enrollment-gate on every route.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import * as mfaRepo from '../data/repositories/mfa.js';

export const STEP_UP_TICKET_TTL_MINUTES = 10;

export async function issueStepUpTicket(employeeId: number): Promise<string> {
  return mfaRepo.createStepUpTicket(employeeId, STEP_UP_TICKET_TTL_MINUTES);
}

/** Boolean-returning check, same calling convention as requireManager()/
 * requireActive() elsewhere in this codebase (`if (!requireX(...)) return;`)
 * — used where the requirement is conditional (e.g. only when granting
 * the admin role specifically, not on every role change), so a static
 * preHandler registered in route options doesn't fit. */
export async function assertStepUp(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const employeeId = request.user?.employee_id;
  if (!employeeId) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const token = request.headers['x-step-up-token'] as string | undefined;
  if (!token || !(await mfaRepo.resolveStepUpTicket(employeeId, token))) {
    reply.code(403).send({
      error: 'step_up_required',
      message: 'Для этого действия нужно свежее подтверждение MFA'
    });
    return false;
  }
  return true;
}

/** preHandler form — 403 step_up_required unless a valid, unexpired
 * ticket for THIS employee_id is presented. Reusable within its short
 * TTL window (not single-consumed) — a burst of related admin actions
 * shouldn't force a fresh MFA prompt per click; the window is short
 * enough that this doesn't meaningfully weaken "fresh". Use this form
 * when the requirement applies unconditionally to a whole route. */
export function requireStepUp() {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await assertStepUp(request, reply);
  };
}
