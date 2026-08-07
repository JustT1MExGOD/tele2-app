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
import { requireActive, requireManager, canAssignRole, resolveViewOrgId, Role } from './middleware-auth.js';

export async function registerEmployeesRoutes(app: FastifyInstance) {
  app.get('/employees', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    // telegram_id отдаём только manager-tier (manager/senior/admin) — рядовым сотрудникам он не нужен
    const canSeeTelegramId =
      request.user!.role === 'manager' || request.user!.role === 'admin' || request.user!.role === 'senior';
    // «Команда» — это сотрудники СВОЕЙ сети, а не всех сетей вперемешку.
    // admin по умолчанию тоже видит только свою (рабочую) сеть; чтобы
    // заглянуть в другую — ?org_id=, доступно только admin (переключатель сети в UI).
    const q = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const res = await query(
      `SELECT id, full_name, short_name, ${canSeeTelegramId ? 'telegram_id,' : ''} is_active, role
       FROM employees
       WHERE is_active = true AND COALESCE(org_id, 'default') = $1
       ORDER BY id`,
      [orgId]
    );
    return res.rows;
  });

  // ===== EMPLOYEES CRUD =====
  app.post('/employees', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const full_name = String(b.full_name || '').trim();
    if (!full_name) return reply.code(400).send({ error: 'full_name required' });
    const short_name = b.short_name || full_name.split(/\s+/)[1] || full_name;
    const ALL_ROLES: Role[] = ['trainee', 'employee', 'senior', 'manager', 'supervisor', 'admin'];
    const requested = ALL_ROLES.includes(b.role) ? (b.role as Role) : 'employee';
    // Каскад: можно завести сотрудника только с ролью строго ниже своей (admin — без ограничений).
    const role: Role = canAssignRole(request.user!.role, requested) ? requested : 'employee';

    // Новый сотрудник попадает в сеть создающего его менеджера; admin может
    // явно указать другую сеть (переключатель сети в UI шлёт org_id).
    const org_id = resolveViewOrgId(request.user!, b.org_id);
    const res = await query(
      `INSERT INTO employees (full_name, short_name, role, is_active, org_id)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, full_name, short_name, role, is_active, telegram_id, org_id`,
      [full_name, short_name, role, org_id]
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

    // Точка попадает в сеть создающего её менеджера, либо (для admin) в
    // сеть, явно выбранную переключателем — тот же паттерн, что и в
    // POST /employees двумя строками выше, раньше здесь был захардкожен
    // request.user!.org_id без возможности переопределить. Расписание
    // отчётов (micro_report_times/close_time_*) — с дефолтами, если не
    // задано явно, чтобы точка сразу подхватилась cron-ом (cron/reports.ts).
    const org_id = resolveViewOrgId(request.user!, b.org_id);
    const res = await query(
      `INSERT INTO stores (
         id, code, name, short_name, work_time, hours, color, is_active, org_id,
         micro_report_times, skip_sunday_micro_times, close_time_weekday, close_time_sunday
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        id,
        code || id,
        name,
        b.short_name || name.slice(0, 8),
        b.work_time || '10-21',
        Number(b.hours) || 11,
        b.color || '#6d9eeb',
        org_id,
        b.micro_report_times || ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
        b.skip_sunday_micro_times || null,
        b.close_time_weekday || '21:00',
        b.close_time_sunday || b.close_time_weekday || '21:00'
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
    const allowed = [
      'name',
      'code',
      'short_name',
      'work_time',
      'hours',
      'color',
      'is_active',
      'micro_report_times',
      'skip_sunday_micro_times',
      'close_time_weekday',
      'close_time_sunday'
    ];
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
