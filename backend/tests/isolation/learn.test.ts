/**
 * Learn (21.x) — пятый шаг конвейера: сработала ли рекомендация?
 * Два независимых измерения (plan_miss_projected — однодневное;
 * anomaly_vs_forecast — рецидив за окно), плюс had_task (была ли задача
 * ДОВЕДЕНА до конца) и агрегированная сводка /alerts/effectiveness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';
import {
  evaluatePlanMissOutcomes,
  evaluateAnomalyRecurrence,
  getEffectivenessSummary
} from '../../src/core/analytics/learn.js';

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

describe('Learn — исход рекомендаций (plan_miss_projected / anomaly_vs_forecast)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeRecovered: string, storeStillMissed: string;
  let storeWithTask: string, storeWithoutTask: string;
  let storeRecurred: string, storeNoRecur: string, storeTooRecent: string, storeSpike: string;
  let employeeA: { id: number; telegramId: number };
  let manager: { id: number; telegramId: number };
  const alertIds: number[] = [];
  const taskIds: number[] = [];

  const today = todayMoscow();
  const yesterday = addDays(today, -1);

  async function insertAlert(storeId: string, alertType: string, payload: any, alertDate: string): Promise<number> {
    const res = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, severity, title, body, payload, status, alert_date)
       VALUES ($1,$2,'warn','t','b',$3,'open',$4::date) RETURNING id`,
      [storeId, alertType, JSON.stringify(payload), alertDate]
    );
    const id = Number(res.rows[0].id);
    alertIds.push(id);
    return id;
  }

  async function insertDoneTask(storeId: string, alertId: number): Promise<number> {
    const res = await query(
      `INSERT INTO tasks (org_id, title, created_by, assigned_to, store_id, alert_id, status, completed_at)
       VALUES ('default','t',$1,$1,$2,$3,'done',now()) RETURNING id`,
      [employeeA.id, storeId, alertId]
    );
    const id = Number(res.rows[0].id);
    taskIds.push(id);
    return id;
  }

  beforeAll(async () => {
    orgA = await fx.createOrg('Learn Org');
    storeRecovered = await fx.createStore(orgA, 'Store Recovered');
    storeStillMissed = await fx.createStore(orgA, 'Store Still Missed');
    storeWithTask = await fx.createStore(orgA, 'Store With Task');
    storeWithoutTask = await fx.createStore(orgA, 'Store Without Task');
    storeRecurred = await fx.createStore(orgA, 'Store Recurred');
    storeNoRecur = await fx.createStore(orgA, 'Store No Recur');
    storeTooRecent = await fx.createStore(orgA, 'Store Too Recent');
    storeSpike = await fx.createStore(orgA, 'Store Spike');
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    manager = await fx.createEmployee(orgA, { role: 'manager' });

    // storeRecovered: план 20, вчера прогноз (в момент алерта) видел ~10,
    // реальный итог дня — 25 (обогнал даже план, не только прогноз).
    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
      [employeeA.id, storeRecovered, yesterday, 25]
    );
    // storeStillMissed: реальный итог 5, прогноз был 10 — не дотянул даже до своего же пессимистичного прогноза.
    await query(
      `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`,
      [employeeA.id, storeStillMissed, yesterday, 5]
    );
  });

  afterAll(async () => {
    if (taskIds.length) await query(`DELETE FROM tasks WHERE id = ANY($1)`, [taskIds]);
    if (alertIds.length) await query(`DELETE FROM smart_alerts WHERE id = ANY($1)`, [alertIds]);
    await fx.cleanup();
  });

  it('evaluatePlanMissOutcomes: факт ≥ прогноза → recovered, факт < прогноза → still_missed', async () => {
    const alertRecovered = await insertAlert(storeRecovered, 'plan_miss_projected', { projectedTotal: 10, planTotal: 20 }, yesterday);
    const alertMissed = await insertAlert(storeStillMissed, 'plan_miss_projected', { projectedTotal: 10, planTotal: 20 }, yesterday);

    const res = await evaluatePlanMissOutcomes(yesterday);
    expect(res.evaluated).toBeGreaterThanOrEqual(2);

    const rows = await query(`SELECT id, payload FROM smart_alerts WHERE id = ANY($1)`, [[alertRecovered, alertMissed]]);
    const byId = new Map(rows.rows.map((r: any) => [Number(r.id), r.payload]));
    expect(byId.get(alertRecovered).outcome).toBe('recovered');
    expect(byId.get(alertMissed).outcome).toBe('still_missed');
  });

  it('had_task: true только для алерта с ДОВЕДЁННОЙ до конца (done) задачей', async () => {
    // storeWithTask реально "исправился" (факт 10 ≥ прогноза 1) — задача
    // выполнена; storeWithoutTask без единой продажи (факт 0 < 1) и без
    // задачи. Заодно наполняет обе ветки summary в последнем тесте файла.
    await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,$4)`, [employeeA.id, storeWithTask, yesterday, 10]);

    const withTask = await insertAlert(storeWithTask, 'plan_miss_projected', { projectedTotal: 1, planTotal: 5 }, yesterday);
    await insertDoneTask(storeWithTask, withTask);
    const withoutTask = await insertAlert(storeWithoutTask, 'plan_miss_projected', { projectedTotal: 1, planTotal: 5 }, yesterday);

    await evaluatePlanMissOutcomes(yesterday);

    const rows = await query(`SELECT id, payload FROM smart_alerts WHERE id = ANY($1)`, [[withTask, withoutTask]]);
    const byId = new Map(rows.rows.map((r: any) => [Number(r.id), r.payload]));
    expect(byId.get(withTask).outcome).toBe('recovered');
    expect(byId.get(withoutTask).outcome).toBe('still_missed');
    expect(byId.get(withTask).had_task).toBe(true);
    expect(byId.get(withoutTask).had_task).toBe(false);
  });

  it('evaluateAnomalyRecurrence: вторая просадка в окне → recurred, без второй — recovered', async () => {
    const first = addDays(today, -10);
    const secondWithinWindow = addDays(first, 3); // внутри 7-дневного окна

    const alertRecurred = await insertAlert(storeRecurred, 'anomaly_vs_forecast', { z: -3.2 }, first);
    await insertAlert(storeRecurred, 'anomaly_vs_forecast', { z: -2.5 }, secondWithinWindow);

    const alertNoRecur = await insertAlert(storeNoRecur, 'anomaly_vs_forecast', { z: -3.0 }, first);

    const res = await evaluateAnomalyRecurrence(today);
    expect(res.evaluated).toBeGreaterThanOrEqual(2);

    const rows = await query(`SELECT id, payload FROM smart_alerts WHERE id = ANY($1)`, [[alertRecurred, alertNoRecur]]);
    const byId = new Map(rows.rows.map((r: any) => [Number(r.id), r.payload]));
    expect(byId.get(alertRecurred).outcome).toBe('recurred');
    expect(byId.get(alertNoRecur).outcome).toBe('recovered');
  });

  it('anomaly_vs_forecast моложе окна рецидива (7 дней) — ещё не оценивается', async () => {
    const recent = addDays(today, -3);
    const alertTooRecent = await insertAlert(storeTooRecent, 'anomaly_vs_forecast', { z: -2.8 }, recent);

    await evaluateAnomalyRecurrence(today);

    const row = await query(`SELECT payload FROM smart_alerts WHERE id = $1`, [alertTooRecent]);
    expect(row.rows[0].payload.outcome).toBeUndefined();
  });

  it('всплеск (z > 0) не оценивается — рецидиву нечего чинить', async () => {
    const first = addDays(today, -10);
    const alertSpike = await insertAlert(storeSpike, 'anomaly_vs_forecast', { z: 4.1 }, first);

    await evaluateAnomalyRecurrence(today);

    const row = await query(`SELECT payload FROM smart_alerts WHERE id = $1`, [alertSpike]);
    expect(row.rows[0].payload.outcome).toBeUndefined();
  });

  it('GET /alerts/effectiveness — admin-only, агрегирует по типу/had_task/outcome', async () => {
    const app = await getApp();

    const forbidden = await app.inject({ method: 'GET', url: '/alerts/effectiveness', headers: authAs(manager.telegramId) });
    expect(forbidden.statusCode).toBe(403);

    const admin = await fx.createEmployee(orgA, { role: 'admin' });
    const res = await app.inject({ method: 'GET', url: '/alerts/effectiveness', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(res.statusCode).toBe(200);

    const summary = await getEffectivenessSummary();
    expect(res.json()).toEqual(summary);
    expect(summary.plan_miss_projected.with_task.recovered).toBeGreaterThanOrEqual(1);
    expect(summary.plan_miss_projected.without_task.still_missed).toBeGreaterThanOrEqual(1);
    expect(summary.anomaly_vs_forecast.without_task.recurred).toBeGreaterThanOrEqual(1);
    expect(summary.anomaly_vs_forecast.without_task.recovered).toBeGreaterThanOrEqual(1);
  });
});
