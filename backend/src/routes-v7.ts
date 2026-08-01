/**
 * T2 Sales v7
 * - custom plan metrics (manager)
 * - daily store cash (касса / 1С / ±)
 * - combo calculator
 *
 * await registerV7Routes(app);
 */

import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { requireManager } from './middleware-auth.js';
import { todayMoscow } from './utils/date.js';

/** Комбо: phone - discount% + 28% phone + 1900 */
export function calcCombo(phonePrice: number, discountPct: number) {
  const price = Number(phonePrice) || 0;
  const disc = Number(discountPct) || 0;
  const afterDiscount = price - price * (disc / 100);
  const plus28 = price * 0.28;
  const result = afterDiscount + plus28 + 1900;
  return Math.round(result * 100) / 100;
}

function slugify(label: string) {
  const base = String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return 'c_' + (base || 'metric') + '_' + Date.now().toString(36);
}

export async function registerV7Routes(app: FastifyInstance) {
  // ===== METRICS CATALOG =====
  app.get('/metrics', async () => {
    const res = await query(
      `SELECT * FROM plan_metrics WHERE is_active = true ORDER BY sort_order, label`
    );
    return res.rows;
  });

  app.get('/metrics/all', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const res = await query(`SELECT * FROM plan_metrics ORDER BY sort_order, label`);
    return res.rows;
  });

  app.post('/metrics', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const label = String(b.label || '').trim();
    if (!label) return reply.code(400).send({ error: 'label required' });
    const id = b.id ? String(b.id).replace(/[^a-z0-9_]/gi, '_') : slugify(label);
    const res = await query(
      `INSERT INTO plan_metrics (id, label, short_label, unit, is_system, is_active, sort_order)
       VALUES ($1, $2, $3, $4, false, true, $5)
       RETURNING *`,
      [
        id,
        label,
        b.short_label || label.slice(0, 8),
        b.unit === 'money' ? 'money' : 'count',
        Number(b.sort_order) || 200
      ]
    );
    return res.rows[0];
  });

  app.patch('/metrics/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as any;
    const res = await query(
      `UPDATE plan_metrics SET
         label = COALESCE($2, label),
         short_label = COALESCE($3, short_label),
         unit = COALESCE($4, unit),
         is_active = COALESCE($5, is_active),
         sort_order = COALESCE($6, sort_order)
       WHERE id = $1 AND is_system = false
       RETURNING *`,
      [
        id,
        b.label ?? null,
        b.short_label ?? null,
        b.unit ?? null,
        b.is_active ?? null,
        b.sort_order ?? null
      ]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'not found or system metric' });
    return res.rows[0];
  });

  app.delete('/metrics/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    // soft delete
    const res = await query(
      `UPDATE plan_metrics SET is_active = false
       WHERE id = $1 AND is_system = false RETURNING *`,
      [id]
    );
    if (!res.rows[0]) return reply.code(404).send({ error: 'not found or system metric' });
    return { ok: true, ...res.rows[0] };
  });

  // ===== STORE CASH (касса) =====
  app.get('/cash', async (request) => {
    const q = request.query as { from?: string; to?: string; store_id?: string };
    const to = q.to || todayMoscow();
    const from =
      q.from ||
      (() => {
        const d = new Date(to + 'T12:00:00');
        d.setDate(1);
        return d.toISOString().slice(0, 10);
      })();

    let sql = `
      SELECT c.*, st.name as store_name, st.color, st.code,
             (c.cash_fact - c.cash_1c) as delta
      FROM store_cash c
      JOIN stores st ON st.id = c.store_id
      WHERE c.cash_date >= $1 AND c.cash_date <= $2`;
    const params: any[] = [from, to];
    if (q.store_id) {
      params.push(q.store_id);
      sql += ` AND c.store_id = $${params.length}`;
    }
    sql += ` ORDER BY c.cash_date DESC, st.hours NULLS LAST`;
    const res = await query(sql, params);
    return { from, to, items: res.rows };
  });

  /** Сводная таблица как на скрине: строки = даты, колонки = точки */
  app.get('/cash/table', async (request) => {
    const q = request.query as { from?: string; to?: string };
    const to = q.to || todayMoscow();
    const from =
      q.from ||
      (() => {
        const d = new Date(to + 'T12:00:00');
        d.setDate(1);
        return d.toISOString().slice(0, 10);
      })();

    const stores = await query(
      `SELECT id, name, short_name, color, code FROM stores
       WHERE is_active = true OR is_active IS NULL
       ORDER BY hours NULLS LAST`
    );
    const cash = await query(
      `SELECT store_id, cash_date, cash_fact, cash_1c,
              (cash_fact - cash_1c) as delta, comment
       FROM store_cash
       WHERE cash_date >= $1 AND cash_date <= $2`,
      [from, to]
    );

    // map date -> store_id -> row
    const byDate: Record<string, any> = {};
    for (const row of cash.rows) {
      const d = String(row.cash_date).slice(0, 10);
      if (!byDate[d]) byDate[d] = {};
      byDate[d][row.store_id] = {
        cash_fact: Number(row.cash_fact) || 0,
        cash_1c: Number(row.cash_1c) || 0,
        delta: Number(row.delta) || 0,
        comment: row.comment || ''
      };
    }

    const dates = Object.keys(byDate).sort().reverse();
    // fill empty days in range? optional — only days with data + today
    if (!byDate[to]) {
      dates.unshift(to);
      byDate[to] = {};
    }

    return {
      from,
      to,
      stores: stores.rows,
      dates,
      cells: byDate
    };
  });

  app.put('/cash', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as any;
    const store_id = b.store_id;
    const cash_date = b.cash_date || todayMoscow();
    if (!store_id) return reply.code(400).send({ error: 'store_id required' });

    const cash_fact = Number(b.cash_fact) || 0;
    const cash_1c = Number(b.cash_1c) || 0;
    const comment = b.comment || '';
    const created_by = (request as any).user?.employee_id || null;

    const res = await query(
      `INSERT INTO store_cash (store_id, cash_date, cash_fact, cash_1c, comment, created_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (store_id, cash_date)
       DO UPDATE SET
         cash_fact = EXCLUDED.cash_fact,
         cash_1c = EXCLUDED.cash_1c,
         comment = EXCLUDED.comment,
         updated_at = now()
       RETURNING *, (cash_fact - cash_1c) as delta`,
      [store_id, cash_date, cash_fact, cash_1c, comment, created_by]
    );
    return res.rows[0];
  });

  app.delete('/cash/:storeId/:date', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { storeId, date } = request.params as { storeId: string; date: string };
    await query(`DELETE FROM store_cash WHERE store_id = $1 AND cash_date = $2`, [
      storeId,
      date
    ]);
    return { ok: true };
  });

  // ===== COMBO CALCULATOR =====
  app.post('/combo/calc', async (request, reply) => {
    const b = request.body as any;
    const phone_price = Number(b.phone_price);
    const discount_pct = Number(b.discount_pct);
    const allowed = [15, 20, 25, 30, 35, 40];
    if (!phone_price || phone_price <= 0) {
      return reply.code(400).send({ error: 'phone_price required' });
    }
    if (!allowed.includes(discount_pct)) {
      return reply.code(400).send({ error: 'discount_pct must be 15|20|25|30|35|40' });
    }
    const result = calcCombo(phone_price, discount_pct);
    const breakdown = {
      phone_price,
      discount_pct,
      after_discount: Math.round((phone_price - phone_price * (discount_pct / 100)) * 100) / 100,
      plus_28pct: Math.round(phone_price * 0.28 * 100) / 100,
      fixed: 1900,
      result
    };

    // optional log
    try {
      const empId = (request as any).user?.employee_id || b.employee_id || null;
      await query(
        `INSERT INTO combo_calculations (employee_id, phone_price, discount_pct, result)
         VALUES ($1,$2,$3,$4)`,
        [empId, phone_price, discount_pct, result]
      );
    } catch (_) {}

    return breakdown;
  });
}
