/**
 * CRUD сотрудников и точек (manager/admin).
 *
 * Раньше жил в routes-v4.ts, который нигде не был зарегистрирован в
 * index.ts — то есть создать/отредактировать сотрудника или точку через
 * API было физически невозможно (единственный путь — approve заявки на
 * доступ). Вынесено сюда и подключено.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireManager } from './middleware-auth.js';

export async function registerEmployeesRoutes(app: FastifyInstance) {
  // ===== EMPLOYEES CRUD =====
  app.post('/employees', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const full_name = String(b.full_name || '').trim();
    if (!full_name) return reply.code(400).send({ error: 'full_name required' });
    const short_name = b.short_name || full_name.split(/\s+/)[1] || full_name;
    const role = ['employee', 'manager', 'admin', 'supervisor'].includes(b.role) ? b.role : 'employee';

    const res = await query(
      `INSERT INTO employees (full_name, short_name, role, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, full_name, short_name, role, is_active, telegram_id`,
      [full_name, short_name, role]
    );
    return res.rows[0];
  });

  app.patch('/employees/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (b.full_name !== undefined) {
      sets.push(`full_name = $${i++}`);
      vals.push(String(b.full_name).trim());
    }
    if (b.short_name !== undefined) {
      sets.push(`short_name = $${i++}`);
      vals.push(b.short_name);
    }
    if (b.is_active !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(!!b.is_active);
    }
    // роль намеренно не меняется здесь — для этого есть отдельные
    // /employees/:id/role (v3) и PATCH /employees/:id/role (v8),
    // которые дополнительно назначают точки супервайзеру.
    if (!sets.length) return reply.code(400).send({ error: 'no fields' });
    vals.push(Number(id));
    const res = await query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, full_name, short_name, role, is_active, telegram_id`,
      vals
    );
    return res.rows[0] || reply.code(404).send({ error: 'not found' });
  });

  app.delete('/employees/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    // soft delete — отвязываем telegram, но продажи/историю не трогаем
    const res = await query(
      `UPDATE employees SET is_active = false, telegram_id = NULL WHERE id = $1
       RETURNING id, full_name, is_active`,
      [Number(id)]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'not found' });
    return { ok: true, ...res.rows[0] };
  });

  // ===== STORES CRUD =====
  app.post('/stores', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const id = String(b.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const name = String(b.name || '').trim();
    const code = String(b.code || '').trim();
    if (!id || !name) return reply.code(400).send({ error: 'id and name required' });

    const res = await query(
      `INSERT INTO stores (id, code, name, short_name, work_time, hours, color, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING *`,
      [
        id,
        code || id,
        name,
        b.short_name || name.slice(0, 8),
        b.work_time || '10-21',
        Number(b.hours) || 11,
        b.color || '#6d9eeb'
      ]
    );

    await query(
      `INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, phones)
       VALUES ($1, NULL, 0, 0, 0, 0, 0)
       ON CONFLICT DO NOTHING`,
      [id]
    ).catch(() => null);

    return res.rows[0];
  });

  app.patch('/stores/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    const allowed = ['name', 'code', 'short_name', 'work_time', 'hours', 'color', 'is_active'];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const key of allowed) {
      if (b[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(b[key]);
      }
    }
    if (!sets.length) return reply.code(400).send({ error: 'no fields' });
    vals.push(id);
    const res = await query(
      `UPDATE stores SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    return res.rows[0] || reply.code(404).send({ error: 'not found' });
  });

  app.delete('/stores/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    await query(`UPDATE stores SET is_active = false WHERE id = $1`, [id]);
    return { ok: true, id };
  });
}
