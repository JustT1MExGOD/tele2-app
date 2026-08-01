/**
 * T2 Sales v4 routes
 * - CRUD employees / stores (manager)
 * - Support + FAQ
 * - Monthly plans
 *
 * import { registerV4Routes } from './routes-v4.js';
 * await registerV4Routes(app);
 */

import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireManager, requireAuth, isManager } from './middleware-auth.js';
import { notifyChat } from './bot/index.js';
import { supportTicketAdmin } from './bot-messages.js';

export async function registerV4Routes(app: FastifyInstance) {
  // ===== MONTHLY PLANS (шаблон = месячный план точки) =====
  app.get('/plans/monthly', async () => {
    const res = await query(`
      SELECT st.id as store_id, st.name, st.code, st.color, st.work_time, st.hours,
             sp.sim, sp.mnp, sp.pa, sp.combo, sp.settings, sp.accessories, sp.insurance,
             sp.phones, sp.wink, sp.shpd, sp.focus, sp.credit_request, sp.credit_issued
      FROM stores st
      LEFT JOIN store_plans sp ON sp.store_id = st.id AND sp.plan_date IS NULL
      WHERE st.is_active = true OR st.is_active IS NULL
      ORDER BY st.hours NULLS LAST, st.name
    `);
    return res.rows;
  });

  app.put('/plans/monthly/:storeId', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { storeId } = request.params as { storeId: string };
    const b = request.body as any;
    const fields = [
      'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
      'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued'
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(Number(b[f]) || 0);
      }
    }
    if (!sets.length) return reply.code(400).send({ error: 'no fields' });
    vals.push(storeId);

    // update or insert template
    const exists = await query(
      `SELECT 1 FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
      [storeId]
    );
    if (exists.rows.length) {
      await query(
        `UPDATE store_plans SET ${sets.join(', ')} WHERE store_id = $${i} AND plan_date IS NULL`,
        vals
      );
    } else {
      await query(
        `INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, settings, accessories, insurance, phones, wink, shpd, focus, credit_request, credit_issued)
         VALUES ($1, NULL, $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          storeId,
          Number(b.sim) || 0, Number(b.mnp) || 0, Number(b.pa) || 0, Number(b.combo) || 0,
          Number(b.settings) || 0, Number(b.accessories) || 0, Number(b.insurance) || 0,
          Number(b.phones) || 0, Number(b.wink) || 0, Number(b.shpd) || 0, Number(b.focus) || 0,
          Number(b.credit_request) || 0, Number(b.credit_issued) || 0
        ]
      );
    }
    const out = await query(
      `SELECT * FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`,
      [storeId]
    );
    return out.rows[0];
  });

  // ===== EMPLOYEES CRUD =====
  app.post('/employees', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const full_name = String(b.full_name || '').trim();
    if (!full_name) return reply.code(400).send({ error: 'full_name required' });
    const short_name = b.short_name || full_name.split(/\s+/)[1] || full_name;
    const role = ['employee', 'manager', 'admin'].includes(b.role) ? b.role : 'employee';

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
    if (b.role !== undefined) {
      if (!['employee', 'manager', 'admin'].includes(b.role)) {
        return reply.code(400).send({ error: 'invalid role' });
      }
      sets.push(`role = $${i++}`);
      vals.push(b.role);
    }
    if (b.is_active !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(!!b.is_active);
    }
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
    // soft delete
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
      `INSERT INTO stores (id, code, name, short_name, work_time, hours, color, is_active, micro_report_times)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       RETURNING *`,
      [
        id,
        code || id,
        name,
        b.short_name || name.slice(0, 8),
        b.work_time || '10-21',
        Number(b.hours) || 11,
        b.color || '#6d9eeb',
        b.micro_report_times || ['12:00', '14:00', '16:00', '18:00', '20:00']
      ]
    );

    // empty plan template
    await query(
      `INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, phones)
       VALUES ($1, NULL, 0, 0, 0, 0, 0)
       ON CONFLICT DO NOTHING`,
      [id]
    ).catch(() =>
      query(
        `INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, phones)
         VALUES ($1, NULL, 0, 0, 0, 0, 0)`,
        [id]
      )
    );

    return res.rows[0];
  });

  app.patch('/stores/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    const allowed = ['name', 'code', 'short_name', 'work_time', 'hours', 'color', 'is_active', 'micro_report_times'];
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

  // ===== SUPPORT =====
  app.get('/support/faq', async () => {
    const res = await query(
      `SELECT id, question, answer, sort_order FROM support_faq
       WHERE is_active = true ORDER BY sort_order, id`
    );
    return res.rows;
  });

  app.post('/support', async (request, reply) => {
    const b = request.body as any;
    const message = String(b.message || '').trim();
    if (!message) return reply.code(400).send({ error: 'message required' });

    const telegram_id = b.telegram_id || request.user?.telegram_id || null;
    const employee_id = request.user?.employee_id || b.employee_id || null;
    const full_name = request.user?.full_name || b.full_name || 'Гость';
    const category = b.category || 'other';

    // auto FAQ match
    const faq = await query(`SELECT * FROM support_faq WHERE is_active = true`);
    const lower = message.toLowerCase();
    let autoAnswer: string | null = null;
    for (const row of faq.rows) {
      const keys: string[] = row.keywords || [];
      if (keys.some((k) => lower.includes(String(k).toLowerCase()))) {
        autoAnswer = row.answer;
        break;
      }
    }

    const ins = await query(
      `INSERT INTO support_tickets (employee_id, telegram_id, full_name, category, message, status, admin_reply, answered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        employee_id,
        telegram_id,
        full_name,
        category,
        message,
        autoAnswer ? 'answered' : 'open',
        autoAnswer,
        autoAnswer ? new Date() : null
      ]
    );
    const ticket = ins.rows[0];

    // notify admin chat
    const adminChat = process.env.ADMIN_CHAT_ID || process.env.CHAT_ID;
    if (adminChat && !autoAnswer) {
      try {
        await notifyChat(
          supportTicketAdmin({
            from: full_name,
            category,
            message,
            ticketId: ticket.id
          })
        );
      } catch (_) {}
    }

    return {
      ticket,
      auto_reply: autoAnswer,
      message: autoAnswer || 'Сообщение отправлено администратору. Ответим как можно скорее.'
    };
  });

  app.get('/support/tickets', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const res = await query(
      `SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 100`
    );
    return res.rows;
  });

  app.post('/support/tickets/:id/reply', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { reply: text } = request.body as any;
    if (!text) return reply.code(400).send({ error: 'reply required' });
    const res = await query(
      `UPDATE support_tickets
       SET admin_reply = $1, status = 'answered', answered_at = now()
       WHERE id = $2 RETURNING *`,
      [String(text), Number(id)]
    );
    return res.rows[0];
  });
}
