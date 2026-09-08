/**
 * Автоматический генератор месячного графика (миграция 0030,
 * core/schedule/schedule-generator.ts) — покрываем канонический
 * weekday-маппинг, вывод времени смены, editableFromDate, пре-solve
 * проверки, обязательный минимум/потолок часов-смен, supervision
 * стажёров, DRAFT/APPLY (stale/replace/идемпотентность) и API-роунд-трип.
 * Item 19 (weekend fairness) — явно отложен на вторую итерацию, здесь не
 * тестируется (см. план synthetic-roaming-mountain).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import type { StoreRecord } from '../../src/data/repositories/stores.js';
import * as staffingRepo from '../../src/data/repositories/store-staffing.js';
import * as availabilityRepo from '../../src/data/repositories/employee-availability.js';
import {
  generateDraft, applyDraft, viewDraft, defaultTargetMonth, monthAdd, monthStart,
  weekdayMonday0, deriveShift, computeEditableFromDateToday, resolveEditableFromDate,
  storeFullShiftHours, StaleDraftError, DraftHasBlockingErrorsError
} from '../../src/core/schedules/index.js';

function daysInMonthList(monthStartIso: string): string[] {
  const start = monthStart(monthStartIso);
  const end = monthAdd(start, 1);
  const out: string[] = [];
  for (let d = start; d < end; ) {
    out.push(d);
    const [y, m, dd] = d.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    dt.setUTCDate(dt.getUTCDate() + 1);
    d = dt.toISOString().slice(0, 10);
  }
  return out;
}

function fakeStore(overrides: Partial<StoreRecord> = {}): StoreRecord {
  return {
    id: 'store-x', org_id: 'org-x', name: 'Store X', is_active: true,
    open_time_weekday: '09:00', open_time_sunday: null,
    close_time_weekday: '21:00', close_time_sunday: null,
    hours: 12, work_time: null,
    ...overrides
  } as StoreRecord;
}

describe('weekdayMonday0 — канонический маппинг дня недели (0=Пн..6=Вс)', () => {
  it('известный понедельник -> 0', () => {
    expect(weekdayMonday0('2026-09-07')).toBe(0); // 2026-09-07 = понедельник
  });
  it('известный вторник -> 1', () => {
    expect(weekdayMonday0('2026-09-08')).toBe(1);
  });
  it('известное воскресенье -> 6', () => {
    expect(weekdayMonday0('2026-09-13')).toBe(6);
  });
});

describe('deriveShift — детерминированный вывод времени смены', () => {
  it('обычный сотрудник на 09:00-21:00 -> полная смена 09:00-21:00/12ч', () => {
    const store = fakeStore({ open_time_weekday: '09:00', close_time_weekday: '21:00' });
    const r = deriveShift(store, '2026-09-08', false); // вторник
    expect(r.shift_text).toBe('09:00-21:00');
    expect(r.hours).toBe(12);
  });

  it('обычный сотрудник на 10:00-21:00 -> 10:00-21:00/11ч', () => {
    const store = fakeStore({ open_time_weekday: '10:00', close_time_weekday: '21:00' });
    const r = deriveShift(store, '2026-09-08', false);
    expect(r.shift_text).toBe('10:00-21:00');
    expect(r.hours).toBe(11);
  });

  it('обычный сотрудник на 10:00-22:00 -> 10:00-22:00/12ч', () => {
    const store = fakeStore({ open_time_weekday: '10:00', close_time_weekday: '22:00' });
    const r = deriveShift(store, '2026-09-08', false);
    expect(r.shift_text).toBe('10:00-22:00');
    expect(r.hours).toBe(12);
  });

  it('стажёр на тех же трёх точках -> ровно 8ч от открытия, никогда полная смена', () => {
    const s1 = fakeStore({ open_time_weekday: '09:00', close_time_weekday: '21:00' });
    const s2 = fakeStore({ open_time_weekday: '10:00', close_time_weekday: '21:00' });
    const s3 = fakeStore({ open_time_weekday: '10:00', close_time_weekday: '22:00' });
    expect(deriveShift(s1, '2026-09-08', true)).toEqual({ shift_text: '09:00-17:00', hours: 8 });
    expect(deriveShift(s2, '2026-09-08', true)).toEqual({ shift_text: '10:00-18:00', hours: 8 });
    expect(deriveShift(s3, '2026-09-08', true)).toEqual({ shift_text: '10:00-18:00', hours: 8 });
  });

  it('воскресенье использует open_time_sunday/close_time_sunday, с фоллбэком на weekday, если не заданы', () => {
    const store = fakeStore({
      open_time_weekday: '09:00', close_time_weekday: '21:00',
      open_time_sunday: '11:00', close_time_sunday: '19:00'
    });
    const r = deriveShift(store, '2026-09-13', false); // воскресенье
    expect(r.shift_text).toBe('11:00-19:00');
    expect(r.hours).toBe(8);

    const storeNoSundayOverride = fakeStore({ open_time_weekday: '09:00', close_time_weekday: '21:00' });
    const r2 = deriveShift(storeNoSundayOverride, '2026-09-13', false);
    expect(r2.shift_text).toBe('09:00-21:00'); // фоллбэк на будний режим
  });

  it('storeFullShiftHours совпадает с полной (не-стажёрской) сменой', () => {
    const store = fakeStore({ open_time_weekday: '10:00', close_time_weekday: '21:00' });
    expect(storeFullShiftHours(store, '2026-09-08')).toBe(11);
  });
});

describe('editableFromDate — правило блокировки текущего дня', () => {
  it('текущее время до открытия единственной активной точки -> editableFromDate = сегодня', () => {
    const store = fakeStore({ open_time_weekday: '09:00' });
    const r = computeEditableFromDateToday([store], '2026-09-08', '08:30');
    expect(r).toBe('2026-09-08');
  });

  it('текущее время после открытия -> editableFromDate = завтра', () => {
    const store = fakeStore({ open_time_weekday: '09:00' });
    const r = computeEditableFromDateToday([store], '2026-09-08', '09:30');
    expect(r).toBe('2026-09-09');
  });

  it('позже открывающаяся точка не переоткрывает сегодня для редактирования', () => {
    const early = fakeStore({ open_time_weekday: '08:00' });
    const late = fakeStore({ open_time_weekday: '12:00' });
    // Время между открытием ранней и поздней точки -> уже заблокировано целиком,
    // т.к. ХОТЬ ОДНА точка (ранняя) уже открылась.
    const r = computeEditableFromDateToday([early, late], '2026-09-08', '09:00');
    expect(r).toBe('2026-09-09');
  });

  it('воскресенье использует open_time_sunday с фоллбэком', () => {
    const store = fakeStore({ open_time_weekday: '09:00', open_time_sunday: '11:00' });
    // 2026-09-13 воскресенье, время 10:00 — до открытия по sunday (11:00), хотя после weekday (09:00)
    const r = computeEditableFromDateToday([store], '2026-09-13', '10:00');
    expect(r).toBe('2026-09-13');
  });

  it('resolveEditableFromDate для будущего месяца -> всегда 1-е число месяца', () => {
    const future = monthAdd(defaultTargetMonth(), 2);
    const r = resolveEditableFromDate(future, [fakeStore()]);
    expect(r).toBe(monthStart(future));
  });

  it('нет активных точек -> editableFromDate завтра (безопасный дефолт)', () => {
    const r = computeEditableFromDateToday([], '2026-09-08', '08:00');
    expect(r).toBe('2026-09-09');
  });
});

describe('Автоматический генератор графика — DRAFT/APPLY (изоляция, DB)', () => {
  const fx = new TestFixtures();
  const draftIds: number[] = [];
  const storeIdsWithStaffing: string[] = [];

  afterAll(async () => {
    if (draftIds.length) {
      await query(`DELETE FROM schedule_drafts WHERE id = ANY($1)`, [draftIds]);
    }
    if (storeIdsWithStaffing.length) {
      await query(`DELETE FROM store_staffing_requirements WHERE store_id = ANY($1)`, [storeIdsWithStaffing]);
    }
    if (fx.employeeIds.length) {
      await query(`DELETE FROM employee_schedule_preferences WHERE employee_id = ANY($1)`, [fx.employeeIds]);
    }
    await fx.cleanup();
  });

  async function setWeekdayStaffing(orgId: string, storeId: string, required: number, maxTrainees = 1) {
    storeIdsWithStaffing.push(storeId);
    for (let wd = 0; wd < 7; wd++) {
      await staffingRepo.upsertWeekdayRow(orgId, storeId, wd, required, maxTrainees);
    }
  }

  it('конфиг-полнота: активная точка без настроенного покрытия -> config_error, blocking_errors, apply отказывает', async () => {
    const org = await fx.createOrg('Sched Gen Config Org');
    const store = await fx.createStore(org, 'No Config Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const target = monthAdd(defaultTargetMonth(), 1); // будущий месяц — весь editable

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    expect(result.draft.solver_status).toBe('config_error');
    expect(result.blocking_errors.length).toBeGreaterThan(0);
    expect(result.items.length).toBe(0);
    await expect(applyDraft(result.draft.id, org, manager.id)).rejects.toBeInstanceOf(DraftHasBlockingErrorsError);
  });

  it('пречек: >4 активных точек структурно несовместим с (min 5/точку, потолок 20) — config_error до солвера', async () => {
    const org = await fx.createOrg('Sched Gen TooManyStores Org');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const stores: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await fx.createStore(org, `Store ${i}`);
      stores.push(s);
      await setWeekdayStaffing(org, s, 1);
    }
    const target = monthAdd(defaultTargetMonth(), 1);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    expect(result.draft.solver_status).toBe('config_error');
    expect(result.blocking_errors.some((e: any) => e.message.includes('5 активных точках') || e.message.includes('активных точках'))).toBe(true);
  });

  it('пречек: недостаточно суммарных рабочих часов покрытия для достижения 179ч у каждого -> config_error', async () => {
    const org = await fx.createOrg('Sched Gen NotEnoughHours Org');
    const store = await fx.createStore(org, 'Small Store'); // 09:00-21:00, 12ч/день
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'NEH E1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'NEH E2' });
    const e3 = await fx.createEmployee(org, { role: 'employee', fullName: 'NEH E3' });
    // manager сам тоже НЕ-стажёр и участвует в 179ч-требовании -> 4 обычных
    // сотрудника всего. required=1/день * ~30 дней * 12ч ~ 360ч, а нужно
    // 4*179=716ч — заведомый дефицит.
    await setWeekdayStaffing(org, store, 1);
    const target = monthAdd(defaultTargetMonth(), 1);
    const days = daysInMonthList(target).length;
    const totalAvailableHours = days * 12;
    const minimumNeeded = 4 * 179; // manager + e1 + e2 + e3, все НЕ-стажёры
    expect(totalAvailableHours).toBeLessThan(minimumNeeded); // sanity: сценарий действительно дефицитный

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    expect(result.draft.solver_status).toBe('config_error');
    expect(result.blocking_errors.some((e: any) => e.message.includes('рабочих часов'))).toBe(true);
    void e1; void e2; void e3;
  });

  it('успешный расчёт: 4 обычных сотрудника (включая менеджера), 1 точка (required=2/день) -> ≥179ч у каждого, ≤20 смен, feasible', async () => {
    const org = await fx.createOrg('Sched Gen HappyPath Org');
    const store = await fx.createStore(org, 'HP Store'); // 09:00-21:00, 12ч/день
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'HP E1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'HP E2' });
    // 4-й обычный сотрудник: для месяца из 31 дня required=2/день даёт 62
    // person-смены, что превышает потолок 3*20=60 — нужен 4-й сотрудник
    // (4*20=80), чтобы сумма 62 укладывалась между 4*15=60 (минимум для 179ч)
    // и 4*20=80 (потолок).
    const e3 = await fx.createEmployee(org, { role: 'employee', fullName: 'HP E3' });
    await setWeekdayStaffing(org, store, 2);

    const target = monthAdd(defaultTargetMonth(), 1);
    const totalDays = daysInMonthList(target).length;

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    expect(result.blocking_errors).toEqual([]);
    expect(['feasible', 'timeout_feasible']).toContain(result.draft.solver_status);
    expect(result.items.length).toBe(2 * totalDays); // required=2 каждый день

    // result.items (из generateDraft) — сырые Candidate-объекты (empId/date),
    // а не DB-строки; для employee_id/work_date читаем через viewDraft, как
    // persisted schedule_draft_items.
    const draftView = await viewDraft(result.draft.id, org);
    const persistedItems = draftView!.items;

    const hoursByEmp = new Map<number, number>();
    const shiftsByEmp = new Map<number, number>();
    for (const it of persistedItems) {
      const empId = Number(it.employee_id); // employee_id может прийти строкой (bigint-driver)
      hoursByEmp.set(empId, (hoursByEmp.get(empId) || 0) + Number(it.hours));
      shiftsByEmp.set(empId, (shiftsByEmp.get(empId) || 0) + 1);
    }
    for (const empId of [manager.id, e1.id, e2.id, e3.id]) {
      expect(hoursByEmp.get(empId) || 0).toBeGreaterThanOrEqual(179);
      expect(shiftsByEmp.get(empId) || 0).toBeLessThanOrEqual(20);
      expect(shiftsByEmp.get(empId) || 0).toBeGreaterThanOrEqual(5); // единственная точка -> обязательный минимум
    }
    // Каждый день ровно 2 назначенных (exact coverage).
    const byDate = new Map<string, number>();
    for (const it of persistedItems) byDate.set(it.work_date, (byDate.get(it.work_date) || 0) + 1);
    for (const c of byDate.values()) expect(c).toBe(2);
  });

  it('стажёр: optional-кандидат без исторической продуктивности остаётся неназначенным (TRAINEE_ASSIGN_COST > 0 EV), не infeasible; никогда не работает один', async () => {
    const org = await fx.createOrg('Sched Gen Trainee Org');
    const store = await fx.createStore(org, 'Trainee Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'Trainee Coworker' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'Trainee Coworker 2' });
    const e3 = await fx.createEmployee(org, { role: 'employee', fullName: 'Trainee Coworker 3' });
    const trainee = await fx.createEmployee(org, { role: 'trainee', fullName: 'Trainee' });
    await setWeekdayStaffing(org, store, 2, 1); // required=2 non-trainee/day, max_trainees=1

    const target = monthAdd(defaultTargetMonth(), 1);
    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);

    expect(result.blocking_errors).toEqual([]);
    expect(['feasible', 'timeout_feasible']).toContain(result.draft.solver_status);

    // result.items (из generateDraft) — сырые Candidate-объекты (empId/date),
    // а не DB-строки; для employee_id/work_date читаем через viewDraft.
    const draftView = await viewDraft(result.draft.id, org);
    const persistedItems = draftView!.items;

    // Без исторической продуктивности score=0, а TRAINEE_ASSIGN_COST>0 —
    // солвер никогда не назначает стажёра просто потому что "формально можно".
    // employee_id может прийти строкой (bigint-driver) -> Number() перед сравнением.
    expect(persistedItems.some((it: any) => Number(it.employee_id) === trainee.id)).toBe(false);

    // Стажёр никогда не работает один (инвариант — даже если бы был назначен):
    // на каждую дату, где назначен стажёр, на той же точке в тот же день
    // обязательно есть НЕ-стажёр.
    const byDate = new Map<string, { trainee: boolean; regularCount: number }>();
    for (const it of persistedItems) {
      const key = it.work_date;
      if (!byDate.has(key)) byDate.set(key, { trainee: false, regularCount: 0 });
      const bucket = byDate.get(key)!;
      if (Number(it.employee_id) === trainee.id) bucket.trainee = true;
      else bucket.regularCount++;
    }
    for (const [, b] of byDate) {
      if (b.trainee) expect(b.regularCount).toBeGreaterThanOrEqual(1);
    }
    // Обычное покрытие (required=2) удовлетворяется ТОЛЬКО не-стажёрами.
    for (const d of daysInMonthList(target)) {
      const nonTraineeCount = persistedItems.filter((it: any) => it.work_date === d && Number(it.employee_id) !== trainee.id).length;
      expect(nonTraineeCount).toBe(2);
    }
    void e1; void e2; void e3;
  });

  it('stale draft: изменение расписания после генерации блокирует apply с 409, повторная генерация снова применима', async () => {
    const org = await fx.createOrg('Sched Gen Stale Org');
    const store = await fx.createStore(org, 'Stale Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'Stale E1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'Stale E2' });
    const e3 = await fx.createEmployee(org, { role: 'employee', fullName: 'Stale E3' });
    await setWeekdayStaffing(org, store, 2);
    const target = monthAdd(defaultTargetMonth(), 1);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);
    expect(result.blocking_errors).toEqual([]);

    // Меняем доступность ПОСЛЕ генерации -> fingerprint расходится.
    await availabilityRepo.addUnavailable(org, e1.id, 'unavailable', daysInMonthList(target)[0], manager.id);

    await expect(applyDraft(result.draft.id, org, manager.id)).rejects.toBeInstanceOf(StaleDraftError);
    const staleView = await viewDraft(result.draft.id, org);
    expect(staleView!.draft.status).toBe('stale');

    const fresh = await generateDraft(org, target, manager.id);
    draftIds.push(fresh.draft.id);
    expect(fresh.blocking_errors).toEqual([]);

    const applied1 = await applyDraft(fresh.draft.id, org, manager.id);
    expect(applied1.applied).toBe(true);
    expect(applied1.draft.status).toBe('applied');

    const applied2 = await applyDraft(fresh.draft.id, org, manager.id);
    expect(applied2.applied).toBe(false); // идемпотентно
    void e2; void e3;
  });

  it('apply записывает shift_text/hours ВЕРБАТИМ из draft items (без пересчёта)', async () => {
    const org = await fx.createOrg('Sched Gen Verbatim Org');
    const store = await fx.createStore(org, 'Verbatim Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'Verbatim E1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'Verbatim E2' });
    await fx.createEmployee(org, { role: 'employee', fullName: 'Verbatim E3' });
    await setWeekdayStaffing(org, store, 2);
    const target = monthAdd(defaultTargetMonth(), 1);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);
    expect(result.blocking_errors).toEqual([]);

    const draftView = await viewDraft(result.draft.id, org);
    const itemsById = new Map(draftView!.items.map((it: any) => [`${it.employee_id}:${it.work_date}`, it]));

    const applied = await applyDraft(result.draft.id, org, manager.id);
    expect(applied.applied).toBe(true);

    const rows = await query(
      `SELECT employee_id, work_date::text as work_date, shift_text, hours FROM schedules WHERE employee_id = ANY($1)`,
      [[e1.id, e2.id]]
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      const draftItem = itemsById.get(`${row.employee_id}:${row.work_date}`);
      expect(draftItem).toBeDefined();
      expect(row.shift_text).toBe(draftItem.shift_text);
      expect(Number(row.hours)).toBe(draftItem.hours);
    }
  });

  it('изменение store hours между generate и apply делает черновик stale', async () => {
    const org = await fx.createOrg('Sched Gen StoreChange Org');
    const store = await fx.createStore(org, 'StoreChange Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'SC E1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'SC E2' });
    await fx.createEmployee(org, { role: 'employee', fullName: 'SC E3' });
    await setWeekdayStaffing(org, store, 2);
    const target = monthAdd(defaultTargetMonth(), 1);

    const result = await generateDraft(org, target, manager.id);
    draftIds.push(result.draft.id);
    expect(result.blocking_errors).toEqual([]);

    await query(`UPDATE stores SET close_time_weekday = '22:00' WHERE id = $1`, [store]);

    await expect(applyDraft(result.draft.id, org, manager.id)).rejects.toBeInstanceOf(StaleDraftError);
    void e1; void e2;
  });

  it('API: POST /schedule-drafts/generate, GET /:id, POST /:id/apply — полный роунд-трип', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sched Gen API Org');
    const store = await fx.createStore(org, 'API Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const e1 = await fx.createEmployee(org, { role: 'employee', fullName: 'API E1' });
    const e2 = await fx.createEmployee(org, { role: 'employee', fullName: 'API E2' });
    await fx.createEmployee(org, { role: 'employee', fullName: 'API E3' });
    await setWeekdayStaffing(org, store, 2);
    const target = monthAdd(defaultTargetMonth(), 1);

    const genRes = await app.inject({
      method: 'POST', url: '/schedule-drafts/generate',
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { month: target }
    });
    expect(genRes.statusCode).toBe(200);
    const genBody = genRes.json();
    draftIds.push(genBody.draft_id);
    expect(genBody.blocking_errors).toEqual([]);

    const getRes = await app.inject({
      method: 'GET', url: `/schedule-drafts/${genBody.draft_id}`,
      headers: authAs(manager.telegramId)
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().draft.id).toBe(genBody.draft_id);

    const applyRes = await app.inject({
      method: 'POST', url: `/schedule-drafts/${genBody.draft_id}/apply`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: {}
    });
    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().applied).toBe(true);
    void e1; void e2;
  });

  it('API: staffing-requirements CRUD и schedule-availability CRUD', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Sched Gen Config API Org');
    const store = await fx.createStore(org, 'Config API Store');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const emp = await fx.createEmployee(org, { role: 'employee', fullName: 'Config API Emp' });
    storeIdsWithStaffing.push(store);

    const putRes = await app.inject({
      method: 'PUT', url: `/stores/${store}/staffing-requirements`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { weekday_rows: [{ weekday: 0, required_employees: 2, max_trainees: 1 }] }
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().rows.length).toBe(1);

    const getRes = await app.inject({
      method: 'GET', url: `/stores/${store}/staffing-requirements`,
      headers: authAs(manager.telegramId)
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().rows[0].required_employees).toBe(2);

    const target = monthAdd(defaultTargetMonth(), 1);
    const addRes = await app.inject({
      method: 'POST', url: `/employees/${emp.id}/schedule-availability`,
      headers: { ...authAs(manager.telegramId), 'content-type': 'application/json' },
      payload: { kind: 'vacation', specific_date: daysInMonthList(target)[0] }
    });
    expect(addRes.statusCode).toBe(200);
    const rowId = addRes.json().id;

    const listRes = await app.inject({
      method: 'GET', url: `/employees/${emp.id}/schedule-availability`,
      headers: authAs(manager.telegramId)
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().rows.length).toBe(1);

    const delRes = await app.inject({
      method: 'DELETE', url: `/employees/${emp.id}/schedule-availability/${rowId}`,
      headers: authAs(manager.telegramId)
    });
    expect(delRes.statusCode).toBe(200);
  });
});
