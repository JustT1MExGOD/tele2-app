/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблицам `tasks` и
 * `task_comments`.
 */
import { query } from '../db/index.js';

export async function getById(id: number): Promise<any | null> {
  const res = await query(`SELECT * FROM tasks WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function create(data: {
  orgId: string; title: string; description: string | null; createdBy: number | null;
  assignedTo: number; storeId: string | null; alertId: number | null; priority: string; dueAt: Date | null;
}): Promise<any> {
  const res = await query(
    `INSERT INTO tasks (org_id, title, description, created_by, assigned_to, store_id, alert_id, priority, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.orgId, data.title, data.description, data.createdBy, data.assignedTo,
      data.storeId, data.alertId, data.priority, data.dueAt
    ]
  );
  return res.rows[0];
}

export async function listForOrg(orgId: string, status?: string, assignedTo?: number): Promise<any[]> {
  const conditions = ['t.org_id = $1'];
  const params: any[] = [orgId];
  if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (assignedTo) {
    params.push(assignedTo);
    conditions.push(`t.assigned_to = $${params.length}`);
  }
  const res = await query(
    `SELECT t.*, e.full_name as assignee_name, COALESCE(st.display_name, st.name) as store_name
     FROM tasks t
     LEFT JOIN employees e ON e.id = t.assigned_to
     LEFT JOIN stores st ON st.id = t.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.created_at DESC
     LIMIT 200`,
    params
  );
  return res.rows;
}

export async function listForAssignee(employeeId: number): Promise<any[]> {
  const res = await query(
    `SELECT t.*, COALESCE(st.display_name, st.name) as store_name
     FROM tasks t
     LEFT JOIN stores st ON st.id = t.store_id
     WHERE t.assigned_to = $1
     ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.due_at NULLS LAST, t.created_at DESC
     LIMIT 100`,
    [employeeId]
  );
  return res.rows;
}

/** /shifts/open — незакрытые задачи сотрудника, часть Shift 2.0 фазы «до». */
export async function findOpenForAssignee(employeeId: number): Promise<any[]> {
  const res = await query(
    `SELECT t.*, COALESCE(st.display_name, st.name) as store_name
     FROM tasks t
     LEFT JOIN stores st ON st.id = t.store_id
     WHERE t.assigned_to = $1 AND t.status IN ('open', 'in_progress')
     ORDER BY t.due_at NULLS LAST, t.created_at DESC`,
    [employeeId]
  );
  return res.rows;
}

/** GET /stores/:id/profile — открытые задачи по точке, с именем исполнителя. */
export async function findOpenForStore(storeId: string): Promise<any[]> {
  const res = await query(
    `SELECT t.*, e.full_name as assignee_name
     FROM tasks t
     LEFT JOIN employees e ON e.id = t.assigned_to
     WHERE t.store_id = $1 AND t.status IN ('open', 'in_progress')
     ORDER BY t.created_at DESC LIMIT 20`,
    [storeId]
  );
  return res.rows;
}

export async function getComments(taskId: number): Promise<any[]> {
  const res = await query(
    `SELECT c.*, e.full_name as author_name
     FROM task_comments c
     LEFT JOIN employees e ON e.id = c.author_id
     WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
    [taskId]
  );
  return res.rows;
}

export async function addComment(taskId: number, authorId: number, body: string): Promise<any> {
  const res = await query(
    `INSERT INTO task_comments (task_id, author_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [taskId, authorId, body]
  );
  return res.rows[0];
}

export async function touchUpdatedAt(taskId: number): Promise<void> {
  await query(`UPDATE tasks SET updated_at = now() WHERE id = $1`, [taskId]);
}

/** Learn (21.x) — среди этих alert_id, у каких есть ДОВЕДЁННАЯ до конца
 * (status='done') задача — отвечает не "была ли задача", а "довели ли её". */
export async function findCompletedAlertIds(alertIds: number[]): Promise<number[]> {
  if (!alertIds.length) return [];
  const res = await query(
    `SELECT DISTINCT alert_id FROM tasks WHERE alert_id = ANY($1) AND status = 'done'`,
    [alertIds]
  );
  return res.rows.map((r: any) => Number(r.alert_id));
}

export async function setStatus(taskId: number, status: string): Promise<any> {
  const completedAt = status === 'done' ? 'now()' : 'NULL';
  const res = await query(
    `UPDATE tasks SET status = $1, updated_at = now(), completed_at = ${completedAt} WHERE id = $2 RETURNING *`,
    [status, taskId]
  );
  return res.rows[0];
}

export type TaskPatch = Partial<{ assigned_to: number; priority: string; due_at: Date | null }>;

export async function updatePatch(taskId: number, patch: TaskPatch): Promise<any | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (patch.assigned_to !== undefined) {
    sets.push(`assigned_to = $${i++}`);
    vals.push(patch.assigned_to);
  }
  if (patch.priority !== undefined) {
    sets.push(`priority = $${i++}`);
    vals.push(patch.priority);
  }
  if (patch.due_at !== undefined) {
    sets.push(`due_at = $${i++}`);
    vals.push(patch.due_at);
  }
  if (!sets.length) return null;
  sets.push('updated_at = now()');
  vals.push(taskId);
  const res = await query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return res.rows[0] || null;
}
