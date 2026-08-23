/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `audit_log`.
 * Перенесено дословно из services/audit.ts (19.23.0), файл удалён —
 * это была чистая обёртка над одним INSERT без бизнес-логики, лишний хоп
 * между вызывающим кодом и репозиторием не служит цели этой миграции.
 *
 * record()'s q — последний параметр, по умолчанию глобальный query()
 * (тот же приём, что у всех репозиториев с 20.8.0) — чтобы один и тот же
 * вызов работал и внутри withTransaction() (db/index.ts, тогда запись
 * аудита либо коммитится вместе с самой мутацией, либо откатывается вместе
 * с ней), и вне транзакции, для действий без мутации (export.csv), причём
 * во втором случае вызывающему коду не нужно импортировать query() самому
 * только ради того, чтобы передать её сюда.
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
  /** Роль актора НА МОМЕНТ действия — снимок, не текущая роль (могут сменить позже). */
  actorRole?: string | null;
  /** Сеть цели действия — по умолчанию совпадает с orgId (см. 0014_audit_log_forensic_fields.sql). */
  targetOrgId?: string | null;
}

export interface AuditLogItem {
  id: number;
  org_id: string | null;
  actor_employee_id: number | null;
  actor_telegram_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  target_org_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
  created_at: string;
}

export async function record(event: AuditEvent, q: typeof query = query): Promise<void> {
  await q(
    `INSERT INTO audit_log
       (org_id, actor_employee_id, actor_telegram_id, action, target_type, target_id, before, after, request_id, actor_role, target_org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      event.orgId,
      event.actorEmployeeId,
      event.actorTelegramId,
      event.action,
      event.targetType,
      event.targetId,
      event.before !== undefined ? JSON.stringify(event.before) : null,
      event.after !== undefined ? JSON.stringify(event.after) : null,
      event.requestId || null,
      event.actorRole || null,
      event.targetOrgId || event.orgId || null
    ]
  );
}

export interface AuditListFilter {
  orgId: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** GET /audit — тот же динамический WHERE, что был в routes-audit.ts. */
export async function list(filter: AuditListFilter): Promise<AuditLogItem[]> {
  const conditions = ['COALESCE(a.org_id, \'default\') = $1'];
  const params: any[] = [filter.orgId];
  if (filter.action) {
    params.push(filter.action);
    conditions.push(`a.action = $${params.length}`);
  }
  if (filter.targetType) {
    params.push(filter.targetType);
    conditions.push(`a.target_type = $${params.length}`);
  }
  if (filter.from) {
    params.push(filter.from);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(filter.to);
    conditions.push(`a.created_at <= $${params.length}`);
  }
  const limit = Math.min(filter.limit || 100, 500);
  const offset = Math.max(filter.offset || 0, 0);
  params.push(limit, offset);

  const res = await query(
    `SELECT a.*, e.full_name as actor_name
     FROM audit_log a
     LEFT JOIN employees e ON e.id = a.actor_employee_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return res.rows;
}
