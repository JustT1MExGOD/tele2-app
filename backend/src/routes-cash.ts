/**
 * Касса: сводная таблица по точкам/дням, внесение факта, список.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { query } from './db/index.js';
import { todayMoscow } from './utils/date.js';
import { requireManager, requireActive, resolveViewOrgId, requireStoreInOrg } from './middleware-auth.js';

const PutCashBody = Type.Object({
  store_id: Type.String({ minLength: 1 }),
  cash_date: Type.Optional(Type.String()),
  cash_fact: Type.Optional(Type.Number()),
  cash_1c: Type.Optional(Type.Number()),
  comment: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
});
type PutCashBody = Static<typeof PutCashBody>;

export async function registerCashRoutes(app: FastifyInstance) {
  // Кассу смотрят и вносят все активные сотрудники на точке, не только
  // manager — фронтенд (09-cash-metrics.js) всегда показывал форму всем,
  // но эти два роута ошибочно остались за requireManager (403 для employee).
  // Таблица — по точкам своей сети, не всех сетей вперемешку.
  app.get('/cash/table', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const q = request.query as { from?: string; to?: string; org_id?: string };
    const from = (q.from || todayMoscow().slice(0, 8) + '01').slice(0, 10);
    const to = (q.to || todayMoscow()).slice(0, 10);
    const orgId = resolveViewOrgId(request.user!, q.org_id);

    const storesRes = await query(
      `SELECT id, COALESCE(display_name, name) as name, code FROM stores s
       WHERE COALESCE(is_active, true) = true AND COALESCE(org_id, 'default') = $1
       ORDER BY hours NULLS LAST, s.name`,
      [orgId]
    );
    const stList = storesRes.rows;

    const cashRes = await query(
      `SELECT c.store_id, c.cash_date::text as cash_date,
              c.cash_fact, c.cash_1c,
              (c.cash_fact - (c.cash_1c + 2000)) as delta, c.comment
       FROM store_cash c
       JOIN stores st ON st.id = c.store_id
       WHERE c.cash_date >= $1::date AND c.cash_date <= $2::date AND COALESCE(st.org_id, 'default') = $3
       ORDER BY c.cash_date`,
      [from, to, orgId]
    );

    // даты: все дни периода, где есть касса + сегодня
    const dateSet = new Set<string>();
    for (const r of cashRes.rows) {
      dateSet.add(String(r.cash_date).slice(0, 10));
    }
    dateSet.add(to);
    // заполнить месяц по дням (чтобы таблица не была пустой)
    const start = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dateSet.add(d.toISOString().slice(0, 10));
    }
    const dates = [...dateSet].sort().reverse();

    const cells: Record<string, Record<string, any>> = {};
    for (const r of cashRes.rows) {
      const d = String(r.cash_date).slice(0, 10);
      if (!cells[d]) cells[d] = {};
      cells[d][r.store_id] = {
        cash_fact: Number(r.cash_fact),
        cash_1c: Number(r.cash_1c),
        delta: Number(r.delta),
        comment: r.comment
      };
    }

    return {
      from,
      to,
      stores: stList,
      dates,
      cells
    };
  });

  app.put(
    '/cash',
    // Точка должна принадлежать своей сети (или сети, которую явно выбрал
    // admin переключателем) — раньше этой проверки не было вообще (в отличие
    // от /schedules и /sales), кассу можно было вписать на точку любой сети.
    {
      preHandler: [requireStoreInOrg('body', 'store_id', { allowOrgOverride: true })],
      schema: { body: PutCashBody }
    },
    async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const body = request.body as PutCashBody;
    const store_id = body.store_id;
    const cash_date = String(body.cash_date || todayMoscow()).slice(0, 10);
    const cash_fact = Number(body.cash_fact) || 0;
    const cash_1c = Number(body.cash_1c) || 0;
    const comment = body.comment || null;

    const res = await query(
      `INSERT INTO store_cash (store_id, cash_date, cash_fact, cash_1c, comment, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (store_id, cash_date)
       DO UPDATE SET
         cash_fact = EXCLUDED.cash_fact,
         cash_1c = EXCLUDED.cash_1c,
         comment = EXCLUDED.comment,
         updated_at = now()
       RETURNING *`,
      [store_id, cash_date, cash_fact, cash_1c, comment]
    );
    return res.rows[0];
    }
  );

  app.get('/cash', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const q = request.query as { from?: string; to?: string; store_id?: string; org_id?: string };
    const from = q.from || todayMoscow().slice(0, 8) + '01';
    const to = q.to || todayMoscow();
    const orgId = resolveViewOrgId(request.user!, q.org_id);
    const params: any[] = [from, to, orgId];
    let sql = `
      SELECT c.*, COALESCE(st.display_name, st.name) as store_name
      FROM store_cash c
      LEFT JOIN stores st ON st.id = c.store_id
      WHERE c.cash_date >= $1::date AND c.cash_date <= $2::date AND COALESCE(st.org_id, 'default') = $3`;
    if (q.store_id) {
      params.push(q.store_id);
      sql += ` AND c.store_id = $${params.length}`;
    }
    sql += ` ORDER BY c.cash_date DESC, st.name`;
    const res = await query(sql, params);
    return res.rows;
  });
}
