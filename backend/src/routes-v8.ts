/**
 * T2 Sales v8 — Access control + Supervisor cabinet
 *
 * await registerV8Routes(app);
 *
 * Важно: на «боевых» роутах (sales write, etc.) вызывай requireActive.
 * Публичные: /health, /ready, /access/status, /access/request, /combo/calc
 */

import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import {
  requireActive,
  requireManager,
  requireManagerOrSupervisor,
  getUserStoreIds,
  loadUser,
  authPlugin
} from './middleware-auth-v8.js';   // ← НЕ middleware-auth.js
import { todayMoscow } from './utils/date.js';
import { bot } from './bot/index.js';

function esc(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function registerV8Routes(app: FastifyInstance) {
  // подтянуть user на каждый запрос
  // ===== ACCESS STATUS (гость может) =====
  app.get('/access/status', async (request) => {
    const raw = request.headers['x-telegram-id'] as string;
    if (!raw) return { status: 'anonymous' };
    const user = request.user || (await loadUser(Number(raw)));

    // pending request without employee row?
    if (user.access_status === 'none') {
      const req = await query(
        `SELECT * FROM access_requests
         WHERE telegram_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [user.telegram_id]
      );
      if (req.rows[0]) {
        return {
          status: req.rows[0].status,
          request: req.rows[0],
          user
        };
      }
    }
    return {
      status: user.access_status === 'none' ? 'none' : user.access_status,
      user
    };
  });

  // Список сотрудников для «я вот этот» (только имена, без чувствительного)
  app.get('/access/employees-directory', async () => {
    const res = await query(
      `SELECT id, full_name FROM employees
       WHERE is_active = true AND (telegram_id IS NULL OR telegram_id = 0)
         AND (access_status = 'active' OR access_status IS NULL)
       ORDER BY full_name`
    );
    return res.rows;
  });

  // Заявка на доступ
  app.post('/access/request', async (request, reply) => {
    const raw = request.headers['x-telegram-id'] as string;
    if (!raw) return reply.code(401).send({ error: 'X-Telegram-Id required' });
    const telegramId = Number(raw);
    const b = request.body as any;
    const full_name = String(b.full_name || '').trim();
    if (!full_name || full_name.length < 3) {
      return reply.code(400).send({ error: 'full_name required' });
    }

    // уже active?
    const existing = await loadUser(telegramId);
    if (existing.access_status === 'active') {
      return { ok: true, status: 'active', message: 'Уже есть доступ' };
    }

    const pending = await query(
      `SELECT id FROM access_requests WHERE telegram_id = $1 AND status = 'pending'`,
      [telegramId]
    );
    if (pending.rows[0]) {
      return { ok: true, status: 'pending', id: pending.rows[0].id };
    }

    const res = await query(
      `INSERT INTO access_requests
         (telegram_id, telegram_username, full_name, claimed_employee_id, message, status)
       VALUES ($1,$2,$3,$4,$5,'pending')
       RETURNING *`,
      [
        telegramId,
        b.username || null,
        full_name,
        b.claimed_employee_id ? Number(b.claimed_employee_id) : null,
        b.message || ''
      ]
    );

    // уведомить managers (и admin)
    try {
      const managers = await query(
        `SELECT telegram_id, full_name FROM employees
         WHERE role IN ('manager','admin') AND telegram_id IS NOT NULL
           AND access_status = 'active'`
      );
      const text =
        `🔐 <b>Заявка на доступ</b>\n` +
        `👤 ${esc(full_name)}\n` +
        `TG: <code>${telegramId}</code>\n` +
        (b.message ? `💬 ${esc(b.message)}\n` : '') +
        `\nПодтверди в Mini App → Команда → Заявки`;
      for (const m of managers.rows) {
        if (bot && m.telegram_id) {
          await bot.api.sendMessage(m.telegram_id, text, { parse_mode: 'HTML' }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('notify managers', e);
    }

    return { ok: true, status: 'pending', request: res.rows[0] };
  });

  // Очередь заявок — manager + supervisor
  app.get('/access/requests', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const res = await query(
      `SELECT * FROM access_requests
       WHERE status = 'pending'
       ORDER BY created_at ASC`
    );
    return res.rows;
  });

  // Approve
  app.post('/access/requests/:id/approve', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = (request.body as any) || {};
    const role = b.role === 'supervisor' ? 'supervisor' : b.role === 'manager' ? 'manager' : 'employee';

    const reqRes = await query(`SELECT * FROM access_requests WHERE id = $1`, [Number(id)]);
    const req = reqRes.rows[0];
    if (!req || req.status !== 'pending') {
      return reply.code(404).send({ error: 'request not found' });
    }

    let employeeId = req.claimed_employee_id ? Number(req.claimed_employee_id) : null;

    if (employeeId) {
      await query(
        `UPDATE employees SET
           telegram_id = $1,
           access_status = 'active',
           role = COALESCE($2, role),
           verified_by = $3,
           verified_at = now(),
           full_name = COALESCE(full_name, $4)
         WHERE id = $5`,
        [req.telegram_id, role === 'employee' ? null : role, request.user!.employee_id, req.full_name, employeeId]
      );
    } else {
      // создать нового
      const ins = await query(
        `INSERT INTO employees (full_name, telegram_id, role, access_status, is_active, verified_by, verified_at)
         VALUES ($1,$2,$3,'active',true,$4,now())
         RETURNING id`,
        [req.full_name, req.telegram_id, role, request.user!.employee_id]
      );
      // если нет serial — может понадобиться ручной id; предполагаем serial/identity
      employeeId = ins.rows[0]?.id;
    }

    await query(
      `UPDATE access_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2`,
      [request.user!.employee_id, Number(id)]
    );

    if (bot && req.telegram_id) {
      await bot.api
        .sendMessage(
          req.telegram_id,
          `✅ <b>Доступ открыт</b>\nДобро пожаловать в T2 Sales.\nОткрой приложение заново.`,
          { parse_mode: 'HTML' }
        )
        .catch(() => {});
    }

    return { ok: true, employee_id: employeeId, role };
  });

  // Reject
  app.post('/access/requests/:id/reject', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const { id } = request.params as { id: string };
    const reqRes = await query(`SELECT * FROM access_requests WHERE id = $1`, [Number(id)]);
    const req = reqRes.rows[0];
    if (!req) return reply.code(404).send({ error: 'not found' });

    await query(
      `UPDATE access_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
       WHERE id = $2`,
      [request.user!.employee_id, Number(id)]
    );

    if (bot && req.telegram_id) {
      await bot.api
        .sendMessage(req.telegram_id, `❌ В доступе к T2 Sales отказано. Напиши своему manager.`, {
          parse_mode: 'HTML'
        })
        .catch(() => {});
    }
    return { ok: true };
  });

  // ===== SUPERVISOR: точки =====
  app.get('/supervisor/stores', async (request, reply) => {
    if (!requireManagerOrSupervisor(request, reply)) return;
    const user = request.user!;
    if (user.role === 'manager' || user.role === 'admin') {
      const all = await query(
        `SELECT id, name, code, color, plan_share FROM stores
         WHERE is_active = true OR is_active IS NULL ORDER BY name`
      );
      return all.rows;
    }
    const res = await query(
      `SELECT st.id, st.name, st.code, st.color, st.plan_share
       FROM supervisor_stores ss
       JOIN stores st ON st.id = ss.store_id
       WHERE ss.supervisor_id = $1
       ORDER BY st.name`,
      [user.employee_id]
    );
    return res.rows;
  });

  app.put('/supervisor/:id/stores', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { store_ids } = request.body as { store_ids: string[] };
    await query(`DELETE FROM supervisor_stores WHERE supervisor_id = $1`, [Number(id)]);
    for (const sid of store_ids || []) {
      await query(
        `INSERT INTO supervisor_stores (supervisor_id, store_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [Number(id), sid]
      );
    }
    return { ok: true, count: (store_ids || []).length };
  });

  // Назначить роль supervisor + точки
  app.patch('/employees/:id/role', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    const role = b.role;
    if (!['employee', 'manager', 'supervisor', 'admin'].includes(role)) {
      return reply.code(400).send({ error: 'bad role' });
    }
    const res = await query(
      `UPDATE employees SET role = $1 WHERE id = $2 RETURNING id, full_name, role`,
      [role, Number(id)]
    );
    if (role === 'supervisor' && Array.isArray(b.store_ids)) {
      await query(`DELETE FROM supervisor_stores WHERE supervisor_id = $1`, [Number(id)]);
      for (const sid of b.store_ids) {
        await query(
          `INSERT INTO supervisor_stores (supervisor_id, store_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [Number(id), sid]
        );
      }
    }
    return res.rows[0];
  });

  // /supervisor/dashboard → routes-supervisor.ts (premium analytics)

  // Удобный /me с access
  app.get('/me/access', async (request, reply) => {
    const raw = request.headers['x-telegram-id'] as string;
    if (!raw) return reply.code(401).send({ error: 'no telegram id' });
    const user = request.user || (await loadUser(Number(raw)));
    return user;
  });
}

/** Хелпер: обернуть запись продаж */
export function guardWrite(request: any, reply: any) {
  return requireActive(request, reply);
}
