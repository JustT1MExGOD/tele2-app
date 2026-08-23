import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

/**
 * Изначально этот файл доказывал identity-spoofing дыру в POST /support:
 * при отсутствии request.user (гость без карточки, роут намеренно
 * доступен без auth) employee_id/telegram_id брались прямо из тела
 * запроса — неаутентифицированный вызывающий мог создать тикет от имени
 * чужого сотрудника. По пути обнаружился баг серьёзнее: сам SQL в INSERT
 * (`($10 || 240) * interval`) вообще ронял ЛЮБОЙ вызов роута в 500 — `||`
 * между числами Postgres резолвит как конкатенацию текста, а полученная
 * строка не умножается на interval.
 *
 * Оба бага исправлены (routes-support.ts):
 *  - identity (employee_id/telegram_id) теперь берётся ТОЛЬКО из
 *    подтверждённого request.user, тело запроса больше не участвует;
 *  - SQL — `($10::int * interval '1 minute')`, без строкового `|| 240`.
 *
 * Тесты ниже проверяют оба факта: обычный вызов больше не 500-ит, а
 * попытка подделать identity через тело запроса больше не проходит —
 * тикет создаётся с identity анонимного вызывающего (null), не жертвы,
 * хотя message/full_name из тела всё ещё принимаются (не identity-поля).
 */
describe('POST /support: SQL-баг починен, identity-spoofing через тело запроса больше не проходит', () => {
  const fx = new TestFixtures();
  let org: string;
  let victim: { id: number; telegramId: number };

  beforeAll(async () => {
    org = await fx.createOrg('Spoof Org');
    victim = await fx.createEmployee(org, { role: 'employee', fullName: 'Real Victim Name' });
  });

  afterAll(async () => {
    await query(`DELETE FROM support_tickets WHERE full_name LIKE 'Real Victim Name%' OR message LIKE '%спуфинг-тест%'`).catch(() => {});
    await fx.cleanup();
  });

  it('ПОЧИНЕНО: обычный безобидный запрос от гостя больше не роняет роут — тикет создаётся', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'Обычный вопрос от гостя, спуфинг-тест не про это' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ticket.employee_id).toBeNull();
    expect(body.ticket.telegram_id).toBeNull();
  });

  it('ПОЧИНЕНО: попытка подделать identity жертвы через тело запроса больше не проходит — тикет создаётся с identity анонимного вызывающего, не жертвы', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: { 'content-type': 'application/json' },
      payload: {
        message: 'Поддельное сообщение от имени жертвы (спуфинг-тест)',
        employee_id: victim.id,
        telegram_id: victim.telegramId,
        full_name: 'Real Victim Name (spoofed)'
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // employee_id/telegram_id — ТОЛЬКО из подтверждённого request.user
    // (тут его нет, вызов неаутентифицированный) — тело запроса на них
    // больше не влияет, несмотря на явную попытку их подставить.
    expect(body.ticket.employee_id).toBeNull();
    expect(Number(body.ticket.employee_id) === victim.id).toBe(false);
    expect(body.ticket.telegram_id).toBeNull();
    // full_name — не identity-поле (не даёт доступа ни к чему), гостю
    // по-прежнему можно представиться как угодно — это не то, что чинили.
    expect(body.ticket.full_name).toBe('Real Victim Name (spoofed)');
  });

  it('ПОЧИНЕНО: аутентифицированный вызывающий не может подделать identity другого сотрудника через тело — используется его собственная, из request.user', async () => {
    const app = await getApp();
    const caller = await fx.createEmployee(org, { role: 'employee', fullName: 'Real Caller Name' });
    const res = await app.inject({
      method: 'POST',
      url: '/support',
      headers: { ...authAs(caller.telegramId), 'content-type': 'application/json' },
      payload: {
        message: 'Пытаюсь представиться жертвой (спуфинг-тест)',
        employee_id: victim.id,
        telegram_id: victim.telegramId
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number(body.ticket.employee_id)).toBe(caller.id);
    expect(Number(body.ticket.employee_id) === victim.id).toBe(false);
  });
});
