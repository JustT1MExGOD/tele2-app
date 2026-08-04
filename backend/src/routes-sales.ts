/**
 * Продажи: список за день + внесение/правка метрик.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { notifyChat } from './bot/index.js';
import { todayMoscow } from './utils/date.js';
import { logSaleEvents } from './services/heatmap.js';
import { requireActive, requireManager } from './middleware-auth.js';
import { getSalesSumColumns } from './services/metrics-catalog.js';

export async function registerSalesRoutes(app: FastifyInstance) {
  app.get('/sales', async (request) => {
    const { date } = request.query as { date?: string };
    const saleDate = date || todayMoscow();

    const res = await query(
      `SELECT s.*, e.full_name, st.name as store_name
       FROM sales s
       JOIN employees e ON e.id = s.employee_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.sale_date = $1
       ORDER BY e.full_name`,
      [saleDate]
    );
    return res.rows;
  });

  // Прибавление метрик (+ правка через delta отрицательный)
  app.post('/sales', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const user = request.user!;
    const body = request.body as any;
    const employee_id = Number(body.employee_id);
    const store_id = body.store_id;
    const sale_date = body.sale_date || todayMoscow();

    if (!employee_id || !store_id) {
      return reply.code(400).send({ error: 'employee_id and store_id required' });
    }

    // employee может писать только за себя; manager/admin — за всех
    const isManagerRole = user.role === 'manager' || user.role === 'admin';
    if (!isManagerRole && Number(user.employee_id) !== employee_id) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Можно вносить продажи только за себя'
      });
    }
    const tg = String(user.telegram_id || '');

    // Базовые + кастомные (import/imp/esim и любые ключи body a-z0-9_)
    const baseFields = [
      'sim', 'mnp', 'pa', 'combo', 'settings', 'accessories', 'insurance',
      'phones', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
      'plotter', 'hb', 'import', 'imp', 'esim'
    ];
    const extraFromBody = Object.keys(body || {}).filter(
      (k) =>
        /^[a-z][a-z0-9_]{0,29}$/.test(k) &&
        !baseFields.includes(k) &&
        !['employee_id', 'store_id', 'sale_date', 'date', 'id'].includes(k)
    );
    const fields = [...baseFields, ...extraFromBody];

    const insertCols = ['employee_id', 'store_id', 'sale_date'];
    const insertVals: any[] = [employee_id, store_id, sale_date];
    const placeholders = ['$1', '$2', '$3'];
    const setParts: string[] = [];
    const applied: { metric: string; value: number }[] = [];
    let i = 4;

    for (const f of fields) {
      if (body[f] !== undefined && body[f] !== null && body[f] !== '') {
        const val = Number(body[f]) || 0;
        if (!Number.isFinite(val)) continue;
        insertCols.push(f);
        insertVals.push(val);
        placeholders.push('$' + i);
        setParts.push(`${f} = GREATEST(0, sales.${f} + EXCLUDED.${f})`);
        applied.push({ metric: f, value: val });
        i++;
      }
    }

    if (setParts.length === 0) {
      return reply.code(400).send({ error: 'no metrics', message: 'Не выбраны метрики или колонка отсутствует в sales' });
    }
    setParts.push('updated_at = now()');

    const sql = `
      INSERT INTO sales (${insertCols.join(',')})
      VALUES (${placeholders.join(',')})
      ON CONFLICT (employee_id, store_id, sale_date)
      DO UPDATE SET ${setParts.join(', ')}
      RETURNING *
    `;

    const res = await query(sql, insertVals);
    const row = res.rows[0];

    try {
      for (const a of applied) {
        await query(
          `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
           VALUES ($1, $2, $3, $4, $5, 'api', $6)`,
          [employee_id, store_id, sale_date, a.metric, a.value, tg ? Number(tg) : null]
        );
      }
    } catch (_) {}

    // v14: час МСК → sales_events для heatmap
    try {
      const metrics: Record<string, number> = {};
      for (const a of applied) metrics[a.metric] = a.value;
      await logSaleEvents({
        employee_id,
        store_id,
        sale_date,
        metrics,
        source: 'api'
      });
    } catch (e) {
      console.warn('sales_events log failed:', (e as any)?.message || e);
    }

    try {
      const info = await query(
        `SELECT e.full_name, st.name as store_name
         FROM employees e, stores st
         WHERE e.id = $1 AND st.id = $2`,
        [employee_id, store_id]
      );
      if (info.rows[0] && applied.length) {
        const { saleNotificationMulti } = await import('./bot/messages.js');
        const text = await saleNotificationMulti({
          employeeName: info.rows[0].full_name,
          storeName: info.rows[0].store_name,
          items: applied.map((a) => ({ metric: a.metric, value: a.value }))
        });
        await notifyChat(text);
      }
    } catch (_) {}

    return row;
  });

  // Отменить ошибочно внесённую метрику за день (manager/admin).
  // sales — одна строка на employee+store+day, метрики аддитивные, поэтому
  // "удаление" — это обнуление конкретной колонки в этой строке, а не удаление
  // всей строки (другие метрики за этот день могли быть внесены верно).
  app.put('/sales/:id/zero', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { metric } = (request.body || {}) as { metric?: string };
    if (!metric) return reply.code(400).send({ error: 'metric required' });

    const validCols = await getSalesSumColumns();
    if (!validCols.includes(metric)) {
      return reply.code(400).send({ error: 'unknown metric' });
    }

    const before = await query(
      `SELECT ${metric} as val, employee_id, store_id, sale_date FROM sales WHERE id = $1`,
      [id]
    );
    if (!before.rows[0]) return reply.code(404).send({ error: 'not found' });
    const prevVal = Number(before.rows[0].val) || 0;

    const res = await query(
      `UPDATE sales SET ${metric} = 0, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );

    if (prevVal !== 0) {
      const user = request.user!;
      await query(
        `INSERT INTO sales_audit (employee_id, store_id, sale_date, metric, delta, source, created_by)
         VALUES ($1,$2,$3,$4,$5,'correction',$6)`,
        [
          before.rows[0].employee_id,
          before.rows[0].store_id,
          before.rows[0].sale_date,
          metric,
          -prevVal,
          user.telegram_id ? Number(user.telegram_id) : null
        ]
      ).catch(() => {});
    }

    return res.rows[0];
  });
}
