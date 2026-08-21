/**
 * Общий writer для audit_log (19.23.0) — единая лента чувствительных
 * действий вместо разрозненных sales_audit/ai_audit. Принимает query-
 * функцию параметром (не глобальный query() напрямую), чтобы один и тот же
 * вызов работал и внутри withTransaction() (db/index.ts) — тогда запись
 * аудита либо коммитится вместе с самой мутацией, либо откатывается вместе
 * с ней, — и вне транзакции, для действий без мутации (export.csv).
 */
import { query } from '../db/index.js';

export interface AuditEvent {
  orgId: string | null;
  actorEmployeeId: number | null;
  actorTelegramId: number | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

export async function recordAudit(q: typeof query, event: AuditEvent): Promise<void> {
  await q(
    `INSERT INTO audit_log
       (org_id, actor_employee_id, actor_telegram_id, action, target_type, target_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      event.orgId,
      event.actorEmployeeId,
      event.actorTelegramId,
      event.action,
      event.targetType,
      event.targetId,
      event.before !== undefined ? JSON.stringify(event.before) : null,
      event.after !== undefined ? JSON.stringify(event.after) : null,
      event.requestId || null
    ]
  );
}
