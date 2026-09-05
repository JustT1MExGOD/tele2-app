/**
 * CRUD точек — выделено из routes-employees.ts/routes-core.ts (19.22.0),
 * первый роут-файл на Data Access Layer: весь доступ к таблице stores идёт
 * через src/data/repositories/stores.ts, ни одного своего query() здесь быть не
 * должно (проверяется scripts/check-no-direct-sql.mjs в CI).
 */
import { FastifyInstance } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { requireActive, requireManager, resolveViewOrgId, requireStoreInOrg } from '../../../auth/guards.js';
import * as storesRepo from '../../../data/repositories/stores.js';

const StoreWriteFields = {
  name: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  short_name: Type.Optional(Type.String()),
  address: Type.Optional(Type.String()),
  // Единственное поле, которое фронтенд явно шлёт как null (сброс кастомного
  // названия обратно на «сырое» name — см. 16-store-profile.js) — Optional
  // сам по себе разрешает ТОЛЬКО отсутствие поля, не null, поэтому нужен
  // отдельный Union с Null(). Null ДОЛЖЕН идти первым в Union — ajv
  // (coerceTypes: true, Fastify-дефолт) перебирает варианты по порядку и при
  // String() первым тихо коэрсит null → "" ещё ДО того, как дойдёт до
  // Null()-варианта (см. README §24 — найдено в 19.19.0).
  display_name: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  work_time: Type.Optional(Type.String()),
  hours: Type.Optional(Type.Number()),
  // Строгий формат вместо экранирования на каждой точке рендера — color
  // подставляется без esc() в несколько inline style="..." на фронтенде
  // (schedule/index.ts, plans-bfq/index.ts) через storeColor(); формат-
  // контракт тут исключает style-attribute breakout в самом источнике,
  // а не полагается на то, что каждый потребитель не забудет экранировать
  // (hotfix 20.57.1, finding #5).
  color: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
  is_active: Type.Optional(Type.Boolean()),
  micro_report_times: Type.Optional(Type.Array(Type.String())),
  skip_sunday_micro_times: Type.Optional(Type.Array(Type.String())),
  close_time_weekday: Type.Optional(Type.String()),
  close_time_sunday: Type.Optional(Type.String()),
  org_id: Type.Optional(Type.String())
};

const PostStoreBody = Type.Object({
  id: Type.String({ minLength: 1 }),
  ...StoreWriteFields
});
type PostStoreBody = Static<typeof PostStoreBody>;

const PatchStoreBody = Type.Object(StoreWriteFields);
type PatchStoreBody = Static<typeof PatchStoreBody>;

const PATCH_KEYS = [
  'name', 'code', 'short_name', 'address', 'display_name', 'work_time',
  'hours', 'color', 'is_active', 'micro_report_times',
  'skip_sunday_micro_times', 'close_time_weekday', 'close_time_sunday'
] as const;

export async function registerStoresRoutes(app: FastifyInstance) {
  // Раньше вообще без auth-проверки — любой анонимный запрос отдавал точки
  // всех сетей разом (адрес/координаты/org_id/часы работы). requireActive +
  // фильтр по своей сети — тот же уровень защиты, что уже у /org/stores
  // (fetchOrgStores() во фронте использует именно его, не этот роут).
  app.get('/stores', async (request, reply) => {
    if (!requireActive(request, reply)) return;
    const { org_id } = request.query as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    return storesRepo.list(orgId);
  });

  app.post(
    '/stores',
    { schema: { body: PostStoreBody } },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const b = request.body as PostStoreBody;
    const id = String(b.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const name = String(b.name || '').trim();
    if (!id || !name) return reply.code(400).send({ error: 'id and name required' });

    // Точка попадает в сеть создающего её менеджера, либо (для admin) в
    // сеть, явно выбранную переключателем.
    const orgId = resolveViewOrgId(request.user!, b.org_id);
    const store = await storesRepo.create(orgId, { ...b, id, name });
    return store;
    }
  );

  app.patch(
    '/stores/:id',
    {
      preHandler: [requireStoreInOrg('params', 'id', { allowOrgOverride: true })],
      schema: { body: PatchStoreBody }
    },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const b = request.body as PatchStoreBody;
    // Тот же порядок разрешения override (body ?? query), что уже применил
    // requireStoreInOrg-декоратор чуть выше — иначе теоретический риск
    // рассинхрона: декоратор пустил по одному orgId, апдейт проверил бы
    // другой.
    const q = (request.query || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, b.org_id ?? q.org_id);
    const hasFields = PATCH_KEYS.some((key) => b[key] !== undefined);
    if (!hasFields) return reply.code(400).send({ error: 'no fields' });
    const store = await storesRepo.update(orgId, id, b);
    return store || reply.code(404).send({ error: 'not found' });
    }
  );

  app.delete(
    '/stores/:id',
    { preHandler: [requireStoreInOrg('params', 'id', { allowOrgOverride: true })] },
    async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { id } = request.params as { id: string };
    const { org_id } = (request.query || {}) as { org_id?: string };
    const orgId = resolveViewOrgId(request.user!, org_id);
    const deleted = await storesRepo.softDelete(orgId, id);
    if (!deleted) return reply.code(404).send({ error: 'not found' });
    return { ok: true, id };
    }
  );
}
