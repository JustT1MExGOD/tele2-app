/**
 * Фикстуры для тестов изоляции — та же дисциплина, что уже применялась в
 * этом сеансе для test_network: явно созданные объекты, явная очистка в
 * FK-safe порядке, ничего не остаётся после прогона. Каждый вызов create*()
 * запоминает созданную запись в this — cleanup() подчищает именно её.
 */
import { query } from '../../src/data/db/index.js';
import { normalizePhone } from '../../src/utils/phone.js';
import { startTotpEnrollment, confirmTotpEnrollment } from '../../src/auth/mfa/totp.js';
import { generate as generateTotp } from 'otplib';

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

  /**
   * §2/PRIV-MFA-1 (Auth Assurance Hardening, 20.52.1) — auth/guards.ts
   * now blocks any requireActive()-gated route for an admin/supervisor
   * principal with no confirmed MFA factor (see auth/assurance.ts). Most
   * isolation tests create admin/supervisor fixtures via createEmployee()
   * below purely to exercise SOME OTHER route's business logic, not to
   * test the MFA-enrollment gate itself — auto-enrolling here means the
   * one centralized fixture stays correct for the whole suite instead of
   * every individual test file having to know about MFA. Tests that
   * specifically need an UN-enrolled privileged account (to test the
   * gate itself) pass `mfa: false`.
   */
  async enrollTotpFor(employeeId: number): Promise<void> {
    const enrollment = await startTotpEnrollment(employeeId, `fixture-${employeeId}`);
    const code = await generateTotp({ secret: enrollment.secret, epoch: Math.floor(Date.now() / 1000) });
    await confirmTotpEnrollment(employeeId, code);
  }

  async createEmployee(
    orgId: string,
    opts: { role?: Role; fullName?: string; telegramId?: number | null; mfa?: boolean } = {}
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
    // 20.48.0 (Web Security & Trust Layer) — principal.ts::loadUser()
    // резолвит Telegram через identities, не employees.telegram_id
    // напрямую; эта фикстура пишет telegram_id сырым SQL, в обход
    // employees.ts-репозитория (который и синхронизирует identities для
    // production-путей) — держим фикстуру в синхроне вручную, иначе
    // authAs(telegramId) во всех изоляционных тестах перестаёт резолвиться.
    if (telegramId) {
      await query(
        `INSERT INTO identities (employee_id, provider, provider_key) VALUES ($1, 'telegram', $2)`,
        [id, String(telegramId)]
      );
    }
    const role = opts.role || 'employee';
    if ((role === 'admin' || role === 'supervisor') && opts.mfa !== false) {
      await this.enrollTotpFor(id);
    }
    return { id, telegramId: telegramId as number };
  }

  /**
   * 20.48.0 (Web Security & Trust Layer) — phone-сотрудник для тестов
   * /auth/login и т.п.: пишет employees.phone/password_hash И
   * identities(provider='phone') вместе, тем же нормализованным номером,
   * которым реально резолвит /auth/login (identitiesRepo.findEmployeeId) —
   * иначе raw INSERT в employees в обход репозитория не резолвится.
   */
  async createPhoneEmployee(
    orgId: string,
    phone: string,
    passwordHash: string | null,
    opts: { role?: Role; fullName?: string; accessStatus?: string } = {}
  ): Promise<{ id: number; phone: string }> {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error(`createPhoneEmployee: "${phone}" не проходит normalizePhone()`);
    const res = await query(
      `INSERT INTO employees (full_name, phone, password_hash, role, access_status, is_active, org_id)
       VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
      [opts.fullName || 'Test Phone Employee', normalized, passwordHash, opts.role || 'employee', opts.accessStatus || 'active', orgId]
    );
    const id = Number(res.rows[0].id);
    this.employeeIds.push(id);
    await query(`INSERT INTO identities (employee_id, provider, provider_key) VALUES ($1, 'phone', $2)`, [id, normalized]);
    return { id, phone: normalized };
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
      // employee_password_resets.created_by — не ON DELETE CASCADE (0018),
      // блокирует удаление employees, если один из tracked-сотрудников
      // (например admin из session-lifecycle.test.ts) выпускал ссылку
      // сброса пароля для другого; employee_id-строки сами уже каскадятся.
      await query(`DELETE FROM employee_password_resets WHERE created_by = ANY($1)`, [this.employeeIds]);
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
