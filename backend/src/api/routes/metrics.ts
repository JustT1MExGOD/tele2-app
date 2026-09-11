/**
 * Кастомные метрики плана/продаж
 * GET  /metrics
 * POST /metrics          { label, short_label?, unit?: count|money }
 * DELETE /metrics/:id    soft: is_active=false
 */
import { invalidateSalesColumns } from '../../data/repositories/sales.js';
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireManager } from '../../auth/guards.js';
import { invalidateMetricsCache, getMetricDefs } from '../../core/shared/metrics-catalog.js';
import { serverError } from '../../shared/errors.js';
import * as metricsRepo from '../../data/repositories/metrics.js';
import { withTransaction } from '../../data/db/index.js';
import type { MetricsResponse, CreateMetricResponse, DeleteMetricResponse } from '../../shared/api-types.js';

// plan_metrics has no org_id (see data/repositories/metrics.ts) — a
// created metric becomes a real column on sales/store_plans/
// employee_month_plans/store_month_plans, shared by EVERY org on the
// platform, and is visible platform-wide via GET /metrics. That blast
// radius doesn't match requireManager()'s scope (a manager of ONE org),
// so create/delete additionally require platform admin, same pattern as
// api/routes/org/branding.ts's admin-only routes. Hotfix — this route
// used to let any single org's manager mutate shared platform schema.
function requirePlatformAdmin(request: Parameters<typeof requireManager>[0], reply: FastifyReply): boolean {
  if (!requireManager(request, reply)) return false;
  if (request.user?.role !== 'admin') {
    reply.code(403).send({ error: 'admin only' });
    return false;
  }
  return true;
}

// Real ceiling is Postgres's ~1600 columns/table, but staying far below
// that (row overhead, ALTER TABLE lock duration, realistic UI usability)
// is the actual goal — this is a generous cap for legitimate use, not a
// tuned-to-the-limit number. Hotfix — there was previously no cap at all
// beyond the per-minute rate limit, which only slows a runaway platform-
// wide schema-growth path, never stops it.
const MAX_CUSTOM_METRICS = 100;

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
    if (!requirePlatformAdmin(request, reply)) return;
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

    // Только НОВЫЙ id считается ростом схемы — апдейт существующей метрики
    // не добавляет колонку повторно (ensureColumn — IF NOT EXISTS).
    const isNew = !(await metricsRepo.exists(id));
    if (isNew) {
      const total = await metricsRepo.count();
      if (total >= MAX_CUSTOM_METRICS) {
        return reply.code(400).send({ error: 'metric_limit_reached', message: `Достигнут лимит метрик платформы (${MAX_CUSTOM_METRICS})` });
      }
    }

    // sort_order
    let sort = 200;
    try {
      sort = await metricsRepo.nextSortOrder();
    } catch (_) {}

    // Атомарно, не best-effort (hotfix 20.57.1 PASS 2, finding #6): раньше
    // upsert() коммитился сразу и делал метрику активной ДО того, как все
    // 3 ALTER TABLE успевали пройти — ошибка любого из них лишь логировалась
    // (console.warn), а активная метрика без соответствующей колонки в
    // sales/store_plans/employee_month_plans приводила бы к рантайм-ошибке
    // при первой же попытке записать по ней продажу/план. ALTER TABLE в
    // Postgres транзакционен, поэтому upsert() и весь цикл ensureColumn()
    // теперь выполняются в одной transaction (withTransaction) — неудача
    // любого шага откатывает и уже вставленную/обновлённую строку plan_metrics.
    try {
      await withTransaction(async (q) => {
        await metricsRepo.upsert(id, label, short, unit, sort, q);
        // колонки в основных таблицах — чтобы план/продажи/точки работали
        for (const table of ['sales', 'store_plans', 'employee_month_plans', 'store_month_plans']) {
          await metricsRepo.ensureColumn(table, id, q);
        }
      });
    } catch (e: any) {
      return serverError(request, reply, 'db_error', e);
    }

    invalidateMetricsCache();
    invalidateSalesColumns();
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
    if (!requirePlatformAdmin(request, reply)) return;
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
