/**
 * График смен: день, правка (в т.ч. массовая), месяц целиком.
 * Вынесено из index.ts при разбиении монолита на модули; /schedules/bulk и
 * DELETE /schedules переехали сюда же из routes-v3.ts — раньше мутации
 * графика были раскиданы по двум файлам.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { todayMoscow, currentMonthMoscow } from '../../utils/date.js';
import { requireActive, requireManager, resolveViewOrgId, assertStoreInOrg, assertEmployeeInOrg, requireStoreInOrg, requireEmployeeInOrg } from '../../auth/guards.js';
import * as schedulesRepo from '../../data/repositories/schedules.js';
import type { SchedulesListResponse, ScheduleRow, ScheduleMonthResponse, SaveScheduleBulkResponse } from '../../shared/api-types.js';

const PostScheduleBody = Type.Object({
  employee_id: Type.Number(),
  store_id: Type.String({ minLength: 1 }),
  work_date: Type.String({ minLength: 1 }),
  shift_text: Type.Optional(Type.String()),
  hours: Type.Optional(Type.Number()),
  org_id: Type.Optional(Type.String())
});
type PostScheduleBody = Static<typeof PostScheduleBody>;

// Поля намеренно все Optional — обработчик ниже уже сам пропускает
// (`continue`) отдельные элементы с недостающими employee_id/store_id/
// work_date, не роняя весь батч. Схема здесь не должна быть строже
// обработчика — иначе один плохой элемент в массиве отклонял бы всю пачку
// целиком вместо того, чтобы сохранить остальные валидные смены.
const ScheduleBulkItem = Type.Object({
  employee_id: Type.Optional(Type.Number()),
  store_id: Type.Optional(Type.String()),
  work_date: Type.Optional(Type.String()),
  shift_text: Type.Optional(Type.String()),
  hours: Type.Optional(Type.Number())
});
const PostScheduleBulkBody = Type.Object({
  items: Type.Optional(Type.Array(ScheduleBulkItem)),
  org_id: Type.Optional(Type.String())
});
type PostScheduleBulkBody = Static<typeof PostScheduleBulkBody>;

export async function registerSchedulesRoutes(app: FastifyInstance) {
  // График — по точкам своей сети. Сотрудник может быть на смене в чужой
  // сети (подмена, см. README/эпик 17.0) — но каждая сеть видит смены на
  // СВОИХ точках, а не весь график сразу.
  app.get('/schedules', async (request, reply): Promise<SchedulesListResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { date, org_id } = request.query as { date?: string; org_id?: string };
    const workDate = date || todayMoscow();
    const orgId = resolveViewOrgId(request.user!, org_id);

    // Своя запись видна всегда, даже если сегодня подменяешь в чужой сети —
    // иначе собственная смена пропадает из «Мой день»/формы продажи у
    // самого сотрудника, который её выполняет.
    return schedulesRepo.findByDayForOrgOrSelf(workDate, orgId, request.user!.employee_id);
  });

  app.post(
    '/schedules',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      // Точка должна принадлежать своей сети (или сети, которую явно выбрал
      // admin переключателем) — иначе руководитель одной сети мог бы
      // расставлять смены на точках чужой сети. Раньше проверялась только
      // точка, не сотрудник — manager чужой сети мог назначить НА СВОЮ точку
      // сотрудника чужой сети (угадав его id), и ON CONFLICT (employee_id,
      // work_date) DO UPDATE молча перезаписывал уже существующую смену
      // жертвы на её собственной точке.
      preHandler: [
        requireStoreInOrg('body', 'store_id', { allowOrgOverride: true }),
        requireEmployeeInOrg('body', 'employee_id', { allowOrgOverride: true })
      ],
      schema: { body: PostScheduleBody }
    },
    async (request, reply): Promise<ScheduleRow | undefined> => {
    if (!requireManager(request, reply)) return;
    const body = request.body as PostScheduleBody;
    const { employee_id, store_id, work_date, shift_text, hours } = body;
    return schedulesRepo.upsert(employee_id, store_id, work_date, shift_text, hours);
    }
  );

  app.get('/schedules/month', async (request, reply): Promise<ScheduleMonthResponse | undefined> => {
    if (!requireActive(request, reply)) return;
    const { month, org_id } = request.query as { month?: string; org_id?: string };
    const m = month || currentMonthMoscow();
    const start = `${m}-01`;
    const endDate = new Date(`${m}-01T00:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);
    const orgId = resolveViewOrgId(request.user!, org_id);

    // Своя запись видна всегда — «Мой план» тоже читает этот эндпоинт, и
    // смена в чужой сети (подмена) не должна пропадать из личного графика.
    const items = await schedulesRepo.findByMonthForOrgOrSelf(start, end, orgId, request.user!.employee_id);

    return { month: m, start, end, items };
  });

  /**
   * Массовое сохранение смен на месяц: { items: [{ employee_id, work_date,
   * store_id, shift_text, hours }] }. Каждая точка проверяется на
   * принадлежность своей сети — раньше (в routes-v3.ts) эта проверка тут
   * отсутствовала вообще, хотя одиночный POST /schedules её уже делал.
   */
  app.post(
    '/schedules/bulk',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { body: PostScheduleBulkBody } },
    async (request, reply): Promise<SaveScheduleBulkResponse | FastifyReply | undefined> => {
    if (!requireManager(request, reply)) return;
    const body = request.body as PostScheduleBulkBody;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return reply.code(400).send({ error: 'items required' });

    const orgId = resolveViewOrgId(request.user!, body.org_id);
    const saved = [];
    for (const item of items) {
      const employee_id = Number(item.employee_id);
      const store_id = item.store_id;
      const work_date = String(item.work_date).slice(0, 10);
      const shift_text = item.shift_text || '';
      const hours = Number(item.hours) || 0;

      if (!employee_id || !store_id || !work_date) continue;
      if (!(await assertStoreInOrg(store_id, orgId))) continue;
      // Тот же пробел, что в одиночном POST /schedules — точка проверялась,
      // сотрудник нет.
      if (!(await assertEmployeeInOrg(employee_id, orgId))) continue;

      if (hours <= 0) {
        // удалить смену
        await schedulesRepo.deleteOne(employee_id, work_date);
        saved.push({ employee_id, work_date, deleted: true });
        continue;
      }

      const saved_row = await schedulesRepo.upsert(employee_id, store_id, work_date, shift_text, hours);
      saved.push(saved_row);
    }

    return { ok: true, count: saved.length, items: saved };
    }
  );

  /** Удалить одну смену */
  app.delete('/schedules', async (request, reply) => {
    if (!requireManager(request, reply)) return;
    const { employee_id, work_date, org_id } = request.query as {
      employee_id?: string;
      work_date?: string;
      org_id?: string;
    };
    if (!employee_id || !work_date) {
      return reply.code(400).send({ error: 'employee_id and work_date required' });
    }
    // Раньше без проверки — manager любой сети мог удалить смену вообще
    // любого сотрудника на любую дату (та же дыра, что была в POST /schedules
    // до его собственного фикса — только тут вообще без чека).
    const existingStoreId = await schedulesRepo.findStoreIdFor(Number(employee_id), work_date);
    if (existingStoreId) {
      const orgId = resolveViewOrgId(request.user!, org_id);
      if (!(await assertStoreInOrg(existingStoreId, orgId))) {
        return reply.code(403).send({ error: 'forbidden', message: 'Точка не принадлежит вашей сети' });
      }
    }
    await schedulesRepo.deleteOne(Number(employee_id), work_date);
    return { ok: true };
  });
}
