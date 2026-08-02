/**
 * Кастомные метрики плана/продаж
 * GET  /metrics
 * POST /metrics          { label, short_label?, unit?: count|money }
 * DELETE /metrics/:id    soft: is_active=false
 */
import { FastifyInstance } from 'fastify';
import { query } from './db/index.js';
import { authPlugin, requireAuth, requireManager } from './middleware-auth.js';

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
  app.addHook('preHandler', authPlugin);

  app.get('/metrics', async (_request, reply) => {
    try {
      const res = await query(
        `SELECT id, label, short_label, unit, is_active, sort_order
         FROM plan_metrics
         WHERE COALESCE(is_active, true) = true
         ORDER BY sort_order NULLS LAST, id`
      );
      if (res.rows.length) {
        return {
          items: res.rows.map((r: any) => ({
            id: r.id,
            label: r.label,
            short_label: r.short_label || r.label,
            unit: r.unit === 'money' ? '₽' : 'шт',
            unit_type: r.unit || 'count'
          }))
        };
      }
    } catch (e: any) {
      console.warn('plan_metrics missing:', e?.message || e);
    }
    // fallback hardcoded
    return {
      items: [
        { id: 'sim', label: 'SIM', short_label: 'SIM', unit: 'шт', unit_type: 'count' },
        { id: 'mnp', label: 'MNP', short_label: 'MNP', unit: 'шт', unit_type: 'count' },
        { id: 'pa', label: 'ПА', short_label: 'ПА', unit: 'шт', unit_type: 'count' },
        { id: 'combo', label: 'Комбо', short_label: 'Комбо', unit: 'шт', unit_type: 'count' },
        { id: 'phones', label: 'Телефоны', short_label: 'Тел', unit: '₽', unit_type: 'money' },
        { id: 'accessories', label: 'Аксессуары', short_label: 'Аксы', unit: '₽', unit_type: 'money' },
        { id: 'settings', label: 'Настройки', short_label: 'Доп', unit: '₽', unit_type: 'money' },
        { id: 'insurance', label: 'Страховки', short_label: 'Страх', unit: '₽', unit_type: 'money' },
        { id: 'wink', label: 'Wink', short_label: 'Wink', unit: '₽', unit_type: 'money' },
        { id: 'shpd', label: 'ШПД', short_label: 'ШПД', unit: 'шт', unit_type: 'count' },
        { id: 'focus', label: 'ФО', short_label: 'ФО', unit: '₽', unit_type: 'money' },
        { id: 'credit_request', label: 'Кредит заявка', short_label: 'Кр.з', unit: 'шт', unit_type: 'count' },
        { id: 'credit_issued', label: 'Кредит выдан', short_label: 'Кр.в', unit: '₽', unit_type: 'money' },
        { id: 'plotter', label: 'Плоттер', short_label: 'Плот', unit: 'шт', unit_type: 'count' },
        { id: 'hb', label: 'НВ', short_label: 'НВ', unit: 'шт', unit_type: 'count' }
      ]
    };
  });

  app.post('/metrics', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const body = (request.body || {}) as any;
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
        return reply.code(500).send({ error: 'db_error', message: e?.message || String(e) });
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
  });

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
      return reply.code(500).send({ error: 'db_error', message: e?.message || String(e) });
    }
    return { ok: true, id, active: false };
  });
}
