/**
 * Кастомные метрики плана/продаж
 * GET  /metrics
 * POST /metrics          { label, short_label?, unit?: count|money }
 * DELETE /metrics/:id    soft: is_active=false
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { authPlugin, requireAuth, requireManager } from '../../auth/guards.js';
import { invalidateMetricsCache, getMetricDefs } from '../../core/shared/metrics-catalog.js';
import { serverError } from '../../shared/errors.js';
import * as metricsRepo from '../../data/repositories/metrics.js';
import type { MetricsResponse, CreateMetricResponse, DeleteMetricResponse } from '../../shared/api-types.js';

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

export async function registerMetricsRoutes(app: FastifyInstance) {
  // Раньше тут был отдельный захардкоженный список меток-фолбэков,
  // который дублировал (и потихоньку разошёлся по деталям с) FALLBACK в
  // services/metrics-catalog.ts. Теперь один источник правды: getMetricDefs()
  // сам решает БД/кеш/фолбэк, роут только приводит форму ответа под фронтенд.
  app.get('/metrics', async (_request, reply): Promise<MetricsResponse> => {
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
    // 20.50.0 — ALTER TABLE на 3 таблицах на каждый вызов (ensureColumn) —
    // schema-мутация, не должна быть частой.
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: PostMetricBody } },
    async (request, reply): Promise<CreateMetricResponse | FastifyReply> => {
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
      sort = await metricsRepo.nextSortOrder();
    } catch (_) {}

    try {
      await metricsRepo.upsert(id, label, short, unit, sort);
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }

    // колонки в основных таблицах — чтобы план/продажи/точки работали
    for (const table of ['sales', 'store_plans', 'employee_month_plans']) {
      try {
        await metricsRepo.ensureColumn(table, id);
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

  app.delete('/metrics/:id', async (request, reply): Promise<DeleteMetricResponse | FastifyReply> => {
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
      await metricsRepo.softDeactivate(id);
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }
    return { ok: true, id, active: false };
  });
}
