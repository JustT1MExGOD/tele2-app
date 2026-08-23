/**
 * Фикстуры для тестов изоляции — та же дисциплина, что уже применялась в
 * этом сеансе для test_network: явно созданные объекты, явная очистка в
 * FK-safe порядке, ничего не остаётся после прогона. Каждый вызов create*()
 * запоминает созданную запись в this — cleanup() подчищает именно её.
 */
import { query } from '../../src/data/db/index.js';

let counter = 0;
/** Уникальный префикс на тестовый прогон — safety net на случай, если
 * cleanup() предыдущего прогона не отработал (упавший тест и т.п.). */
const RUN_ID = `t17_${Date.now()}_`;

export type Role = 'trainee' | 'employee' | 'senior' | 'manager' | 'supervisor' | 'admin';

export class TestFixtures {
  orgIds: string[] = [];
  storeIds: string[] = [];
  employeeIds: number[] = [];

  private nextId(label: string) {
    counter += 1;
    return `${RUN_ID}${label}_${counter}`;
  }

  async createOrg(name = 'Test Org'): Promise<string> {
    const id = this.nextId('org');
    await query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [id, name]);
    this.orgIds.push(id);
    return id;
  }

  async createStore(orgId: string, name = 'Test Store'): Promise<string> {
    const id = this.nextId('store');
    await query(
      `INSERT INTO stores (id, code, name, short_name, hours, close_time_weekday, org_id)
       VALUES ($1, $1, $2, $2, 12, '21:00', $3)`,
      [id, name, orgId]
    );
    this.storeIds.push(id);
    return id;
  }

  async createEmployee(
    orgId: string,
    opts: { role?: Role; fullName?: string; telegramId?: number | null } = {}
  ): Promise<{ id: number; telegramId: number }> {
    // telegramId: null — незанятая карточка (для тестов /me/bind); undefined —
    // сгенерировать случайный, как раньше.
    const telegramId = opts.telegramId === null
      ? null
      : opts.telegramId ?? Math.floor(9_000_000_000 + Math.random() * 900_000_000);
    const res = await query(
      `INSERT INTO employees (full_name, telegram_id, role, access_status, is_active, org_id)
       VALUES ($1, $2, $3, 'active', true, $4)
       RETURNING id`,
      [opts.fullName || 'Test Employee', telegramId, opts.role || 'employee', orgId]
    );
    const id = Number(res.rows[0].id);
    this.employeeIds.push(id);
    return { id, telegramId: telegramId as number };
  }

  /** FK-safe порядок: сначала записи, ссылающиеся на store/employee, потом
   * сами employees/stores, потом organizations — тот же порядок, что при
   * удалении test_network этим сеансом. */
  async cleanup() {
    if (this.storeIds.length) {
      await query(`DELETE FROM sales WHERE store_id = ANY($1)`, [this.storeIds]);
      await query(`DELETE FROM schedules WHERE store_id = ANY($1)`, [this.storeIds]);
      await query(`DELETE FROM store_cash WHERE store_id = ANY($1)`, [this.storeIds]);
    }
    if (this.employeeIds.length) {
      await query(`DELETE FROM sales WHERE employee_id = ANY($1)`, [this.employeeIds]);
      await query(`DELETE FROM schedules WHERE employee_id = ANY($1)`, [this.employeeIds]);
      await query(`DELETE FROM employees WHERE id = ANY($1)`, [this.employeeIds]);
    }
    if (this.storeIds.length) {
      await query(`DELETE FROM stores WHERE id = ANY($1)`, [this.storeIds]);
    }
    if (this.orgIds.length) {
      await query(`DELETE FROM organizations WHERE id = ANY($1)`, [this.orgIds]);
    }
    this.orgIds = [];
    this.storeIds = [];
    this.employeeIds = [];
  }
}
