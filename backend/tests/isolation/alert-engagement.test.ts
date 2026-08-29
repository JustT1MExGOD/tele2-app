/**
 * Product Analytics & Feedback Loop (20.34) — поверх Learn (сработала ли
 * рекомендация) добавлены три новых измерения: открыли ли алерт вообще
 * (first_opened_at), отклонили ли явно (status='dismissed'), похоже ли на
 * ложную тревогу (recovered БЕЗ задачи). fileParallelism: false в
 * vitest.config.ts — дельты внутри одного теста надёжны, другие файлы не
 * пишут в БД параллельно.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as alertsRepo from '../../src/data/repositories/alerts.js';

describe('Product Analytics — вовлечённость по алертам (open/dismissed/false-positive)', () => {
  const fx = new TestFixtures();
  const alertIds: number[] = [];

  async function insertAlert(storeId: string, alertType: string, status = 'open'): Promise<number> {
    const res = await query(
      `INSERT INTO smart_alerts (store_id, alert_type, severity, title, body, payload, status, alert_date)
       VALUES ($1,$2,'warn','t','b','{}','${status}', current_date) RETURNING id`,
      [storeId, alertType]
    );
    const id = Number(res.rows[0].id);
    alertIds.push(id);
    return id;
  }

  afterAll(async () => {
    if (alertIds.length) await query(`DELETE FROM smart_alerts WHERE id = ANY($1)`, [alertIds]);
    await fx.cleanup();
  });

  it('markOpened: первый вызов ставит first_opened_at, повторный не переписывает время', async () => {
    const org = await fx.createOrg('Engagement Org');
    const store = await fx.createStore(org, 'Engagement Store');
    const id = await insertAlert(store, 'plan_miss_projected');

    await alertsRepo.markOpened(id);
    const first = await query(`SELECT first_opened_at FROM smart_alerts WHERE id = $1`, [id]);
    expect(first.rows[0].first_opened_at).not.toBeNull();

    const stamp = first.rows[0].first_opened_at;
    await new Promise((r) => setTimeout(r, 5));
    await alertsRepo.markOpened(id);
    const second = await query(`SELECT first_opened_at FROM smart_alerts WHERE id = $1`, [id]);
    expect(new Date(second.rows[0].first_opened_at).getTime()).toBe(new Date(stamp).getTime());
  });

  it('POST /alerts/:id/read — manager может отметить просмотр, обычный сотрудник — нет', async () => {
    const org = await fx.createOrg('Engagement Read Org');
    const store = await fx.createStore(org, 'Engagement Read Store');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const id = await insertAlert(store, 'anomaly_vs_forecast');

    const app = await getApp();
    // 20.52.0 — /alerts/:id/read получил org-scope check (schema: { body:
    // AlertOrgBody }), тем же паттерном, что уже у /ack и /status — нужен
    // валидный (пусть пустой) JSON body, иначе TypeBox-валидация отвечает
    // 400 раньше, чем запрос доходит до requireManager()/org-проверки.
    const forbidden = await app.inject({ method: 'POST', url: `/alerts/${id}/read`, headers: authAs(employee.telegramId), payload: {} });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({ method: 'POST', url: `/alerts/${id}/read`, headers: authAs(manager.telegramId), payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    const row = await query(`SELECT first_opened_at FROM smart_alerts WHERE id = $1`, [id]);
    expect(row.rows[0].first_opened_at).not.toBeNull();
  });

  it('summarizeEngagement: total/opened/dismissed считаются дельтой корректно', async () => {
    const org = await fx.createOrg('Engagement Delta Org');
    // Три РАЗНЫЕ точки — partial unique index (store_id, alert_type,
    // alert_date) WHERE status='open' (0007) не даёт завести два открытых
    // алерта одного типа за один день на ОДНОЙ точке (реальный dedup, не
    // баг), поэтому три независимых алерта одного типа/даты нужны на трёх
    // разных точках.
    const storeOpened = await fx.createStore(org, 'Engagement Delta Store Opened');
    const storeDismissed = await fx.createStore(org, 'Engagement Delta Store Dismissed');
    const storeNeither = await fx.createStore(org, 'Engagement Delta Store Neither');

    const before = await alertsRepo.summarizeEngagement();
    const beforeRow = before.find((r) => r.alert_type === 'plan_miss_projected') || { total: 0, opened: 0, dismissed: 0 };

    const opened = await insertAlert(storeOpened, 'plan_miss_projected');
    await insertAlert(storeDismissed, 'plan_miss_projected', 'dismissed');
    await insertAlert(storeNeither, 'plan_miss_projected'); // ни открыт, ни отклонён
    await alertsRepo.markOpened(opened);

    const after = await alertsRepo.summarizeEngagement();
    const afterRow = after.find((r) => r.alert_type === 'plan_miss_projected')!;

    expect(afterRow.total - beforeRow.total).toBe(3);
    expect(afterRow.opened - beforeRow.opened).toBe(1);
    expect(afterRow.dismissed - beforeRow.dismissed).toBe(1);
  });

  it('GET /alerts/effectiveness — новые поля корректно выведены из бакетов (внутренняя согласованность, не зависит от других тестовых файлов)', async () => {
    const { getEffectivenessSummary } = await import('../../src/core/analytics/learn.js');
    const summary = await getEffectivenessSummary();

    for (const type of ['plan_miss_projected', 'anomaly_vs_forecast'] as const) {
      const entry = summary[type];
      const withTotal = (entry.with_task.recovered || 0) + (entry.with_task.still_missed || 0) + (entry.with_task.recurred || 0);
      const withoutTotal = (entry.without_task.recovered || 0) + (entry.without_task.still_missed || 0) + (entry.without_task.recurred || 0);
      const evaluatedTotal = withTotal + withoutTotal;

      expect(entry.recovery_rate_with_task).toBe(withTotal > 0 ? (entry.with_task.recovered || 0) / withTotal : null);
      expect(entry.recovery_rate_without_task).toBe(withoutTotal > 0 ? (entry.without_task.recovered || 0) / withoutTotal : null);
      expect(entry.false_positive_rate).toBe(evaluatedTotal > 0 ? (entry.without_task.recovered || 0) / evaluatedTotal : null);

      if (entry.open_rate !== null) expect(entry.open_rate).toBeGreaterThanOrEqual(0);
      if (entry.open_rate !== null) expect(entry.open_rate).toBeLessThanOrEqual(1);
      if (entry.dismissed_rate !== null) expect(entry.dismissed_rate).toBeGreaterThanOrEqual(0);
      expect(entry.total).toBeGreaterThanOrEqual(0);
    }
  });
});
