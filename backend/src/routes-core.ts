/**
 * Справочные данные: точки и шаблоны планов.
 * Вынесено из index.ts при разбиении монолита на модули.
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';

export async function registerCoreRoutes(app: FastifyInstance) {
  // ===== STORES =====
  app.get('/stores', async () => {
    const res = await query('SELECT * FROM stores ORDER BY hours');
    return res.rows;
  });

  // ===== PLANS =====
  // ?date=YYYY-MM-DD → дневные планы на дату (если есть), иначе шаблон plan_date IS NULL
  app.get('/plans', async (request) => {
    const { date } = (request.query || {}) as { date?: string };
    if (date) {
      const day = await query(
        `SELECT store_id, plan_date,
                sim, mnp, pa, combo, settings, accessories, insurance,
                phones, wink, shpd, focus, credit_request, credit_issued, plotter, hb
         FROM store_plans
         WHERE plan_date = $1
         ORDER BY store_id`,
        [date]
      );
      if (day.rows.length) return day.rows;
    }
    const res = await query(`
      SELECT store_id, plan_date,
             sim, mnp, pa, combo, settings, accessories, insurance,
             phones, wink, shpd, focus, credit_request, credit_issued
      FROM store_plans
      WHERE plan_date IS NULL
      ORDER BY store_id
    `);
    return res.rows;
  });
}
