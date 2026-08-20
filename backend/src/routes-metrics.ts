/**
 * Кастомные метрики плана/продаж
 * GET  /metrics
 * POST /metrics          { label, short_label?, unit?: count|money }
 * DELETE /metrics/:id    soft: is_active=false
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { query } from './db/index.js';
import { authPlugin, requireAuth, requireManager } from './middleware-auth.js';
import { invalidateMetricsCache, getMetricDefs } from './services/metrics-catalog.js';
import { serverError } from './utils/http-errors.js';

const PostMetricBody = Type.Object({
  label: Type.String({ minLength: 1 }),
  short_label: Type.Optional(Type.String()),
  short: Type.Optional(Type.String()),
  unit: Type.Optional(Type.String()),
  id: Type.Optional(Type.String())
});
type PostMetricBody = Static<typeof PostMetricBody>;

function slugify(label: string, short?: string) {
  const base = (short || label)
    .toLowerCase()
    .replace(/ё/g, 'e')
    .replace(/[^a-z0-9а-я]+/gi, '_')
    .replace(/[а-я]/gi, (ch) => {
      const map: Record<string, string> = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
        и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
        р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch',
        ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
      };
      return map[ch] || '';
    })
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  let id = base.replace(/[^a-z0-9_]/g, '').slice(0, 24);
  if (!id || !/^[a-z]/.test(id)) id = 'm_' + (id || 'metric');
  return id.slice(0, 30);
}

async function ensureColumn(table: string, col: string) {
  // col already sanitized
  await query(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} numeric DEFAULT 0`
  );
}

export async function registerMetricsRoutes(app: FastifyInstance) {
  // Раньше тут был отдельный захардкоженный список меток-фолбэков,
  // который дублировал (и потихоньку разошёлся по деталям с) FALLBACK в
  // services/metrics-catalog.ts. Теперь один источник правды: getMetricDefs()
  // сам решает БД/кеш/фолбэк, роут только приводит форму ответа под фронтенд.
  app.get('/metrics', async (_request, reply) => {
    const defs = await getMetricDefs();
    return {
      items: defs.map((m) => ({
        id: m.id,
        label: m.label,
        short_label: m.short_label,
        unit: m.unit === 'money' ? '₽' : 'шт',
        unit_type: m.unit
      }))
    };
  });

  app.post(
    '/metrics',
    { schema: { body: PostMetricBody } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = request.body as PostMetricBody;
    const label = String(body.label || '').trim();
    if (!label) return reply.code(400).send({ error: 'label_required' });

    const short = String(body.short_label || body.short || label).trim().slice(0, 16);
    const unit = body.unit === 'money' ? 'money' : 'count';
    let id = String(body.id || slugify(label, short)).toLowerCase();
    id = id.replace(/[^a-z0-9_]/g, '').slice(0, 30);
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(id)) {
      return reply.code(400).send({ error: 'invalid_id', message: 'id: a-z, 0-9, _' });
    }

    // sort_order
    let sort = 200;
    try {
      const mx = await query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS s FROM plan_metrics`);
      sort = Number(mx.rows[0]?.s) || 200;
    } catch (_) {}

    try {
      await query(
        `INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order)
         VALUES ($1, $2, $3, $4, true, $5)
         ON CONFLICT (id) DO UPDATE SET
           label = EXCLUDED.label,
           short_label = EXCLUDED.short_label,
           unit = EXCLUDED.unit,
           is_active = true,
           sort_order = COALESCE(plan_metrics.sort_order, EXCLUDED.sort_order)`,
        [id, label, short, unit, sort]
      );
    } catch (e: any) {
      // create table if missing
      if (String(e?.message || e).includes('plan_metrics')) {
        await query(`
          CREATE TABLE IF NOT EXISTS plan_metrics (
            id text PRIMARY KEY,
            label text NOT NULL,
            short_label text,
            unit text DEFAULT 'count',
            is_active boolean DEFAULT true,
            sort_order int DEFAULT 100
          )`);
        await query(
          `INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order)
           VALUES ($1,$2,$3,$4,true,$5)
           ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, is_active = true`,
          [id, label, short, unit, sort]
        );
      } else {
        return serverError(request, reply, 'db_error', e);
      }
    }

    // колонки в основных таблицах — чтобы план/продажи/точки работали
    for (const table of ['sales', 'store_plans', 'employee_month_plans']) {
      try {
        await ensureColumn(table, id);
      } catch (e: any) {
        console.warn(`ALTER ${table}.${id}:`, e?.message || e);
      }
    }

    invalidateMetricsCache();
    return {
      ok: true,
      item: {
        id,
        label,
        short_label: short,
        unit: unit === 'money' ? '₽' : 'шт',
        unit_type: unit
      }
    };
    }
  );

  app.delete('/metrics/:id', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const id = String((request.params as any).id || '');
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(id)) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    // не даём удалить базовые
    const locked = new Set([
      'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'settings',
      'insurance', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
      'plotter', 'hb', 'credit'
    ]);
    if (locked.has(id)) {
      return reply.code(400).send({ error: 'locked', message: 'Базовую метрику нельзя удалить' });
    }
    try {
      await query(`UPDATE plan_metrics SET is_active = false WHERE id = $1`, [id]);
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }
    return { ok: true, id, active: false };
  });
}
