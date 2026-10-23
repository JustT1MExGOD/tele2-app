/**
 * T2 Miranda, этап 1 (Этап A плана, §8 Stage 1) — изоляция корпоративных
 * аккаунтов/устройств: чужой employee не видит/не активирует pending
 * привязку другого; revoke мгновенно блокирует; admin не может
 * переключиться без явного гранта; каждое действие пишет audit_log.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs, authAsSession, setupTotpAndStepUp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import * as sessionsRepo from '../../src/data/repositories/sessions.js';

describe('T2 Miranda — аккаунты/устройства', () => {
  const fx = new TestFixtures();
  const deviceIds: number[] = [];
  const corporateAccountIds: number[] = [];

  afterAll(async () => {
    if (deviceIds.length) {
      await query(`DELETE FROM miranda_device_bindings WHERE device_id = ANY($1)`, [deviceIds]);
      await query(`DELETE FROM miranda_devices WHERE id = ANY($1)`, [deviceIds]);
    }
    if (corporateAccountIds.length) {
      await query(`DELETE FROM miranda_admin_account_grants WHERE corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`UPDATE employee_sessions SET active_corporate_account_id = NULL WHERE active_corporate_account_id = ANY($1)`, [corporateAccountIds]);
      await query(`DELETE FROM corporate_accounts WHERE id = ANY($1)`, [corporateAccountIds]);
    }
    await query(`DELETE FROM audit_log WHERE action LIKE 'MIRANDA_%' AND actor_employee_id = ANY($1)`, [fx.employeeIds.length ? fx.employeeIds : [-1]]);
    await fx.cleanup();
  });

  it('unauthenticated POST /miranda/devices/register — 401', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: '/miranda/devices/register', payload: { platform: 'windows' } });
    expect(res.statusCode).toBe(401);
  });

  it('employee регистрирует устройство (через phone-сессию) — pending, admin видит его в очереди', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Register Org');
    const emp = await fx.createPhoneEmployee(org, '+79990000001', null, { role: 'employee', fullName: 'Королёв' });
    const token = await sessionsRepo.createSession(emp.id, false, 'employee');

    const res = await app.inject({
      method: 'POST',
      url: '/miranda/devices/register',
      headers: { ...authAsSession(token), 'content-type': 'application/json' },
      payload: { platform: 'windows', label: 'Касса у входа' }
    });
    expect(res.statusCode).toBe(200);
    const { deviceId, deviceSecret, status } = res.json();
    expect(status).toBe('pending');
    deviceIds.push(deviceId);
    const regBindingRow = await query(`SELECT corporate_account_id FROM miranda_device_bindings WHERE device_id = $1`, [deviceId]);
    corporateAccountIds.push(Number(regBindingRow.rows[0].corporate_account_id));

    const admin = await fx.createEmployee(org, { role: 'admin' });
    const pending = await app.inject({ method: 'GET', url: '/miranda/devices', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().items.some((i: any) => i.device_id === deviceId)).toBe(true);

    // Активация до approve — остаётся pending, ничего не ломает.
    const activate = await app.inject({
      method: 'POST',
      url: '/miranda/devices/activate',
      headers: { ...authAsSession(token), 'content-type': 'application/json' },
      payload: { deviceSecret }
    });
    expect(activate.statusCode).toBe(202);
    expect(activate.json().status).toBe('pending');
  });

  it('другой сотрудник с чужим device_secret не активирует и не видит привязку (изоляция)', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Isolation Org');
    const owner = await fx.createPhoneEmployee(org, '+79990000002', null, { role: 'employee', fullName: 'Владелец устройства' });
    const ownerToken = await sessionsRepo.createSession(owner.id, false, 'employee');
    const stranger = await fx.createPhoneEmployee(org, '+79990000003', null, { role: 'employee', fullName: 'Посторонний' });
    const strangerToken = await sessionsRepo.createSession(stranger.id, false, 'employee');

    const reg = await app.inject({
      method: 'POST',
      url: '/miranda/devices/register',
      headers: { ...authAsSession(ownerToken), 'content-type': 'application/json' },
      payload: { platform: 'android' }
    });
    const { deviceId, deviceSecret } = reg.json();
    deviceIds.push(deviceId);
    const bindingRow = await query(`SELECT corporate_account_id FROM miranda_device_bindings WHERE device_id = $1`, [deviceId]);
    corporateAccountIds.push(Number(bindingRow.rows[0].corporate_account_id));

    const strangerActivate = await app.inject({
      method: 'POST',
      url: '/miranda/devices/activate',
      headers: { ...authAsSession(strangerToken), 'content-type': 'application/json' },
      payload: { deviceSecret }
    });
    expect(strangerActivate.statusCode).toBe(404);
    expect(strangerActivate.json().error).toBe('unknown_device');
  });

  it('полный цикл: approve требует requireAdmin+step-up, активирует сессию, revoke мгновенно блокирует следующий запуск, всё аудируется', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Lifecycle Org');
    const store = await fx.createStore(org, 'Космонавтов 20А');
    const emp = await fx.createPhoneEmployee(org, '+79990000004', null, { role: 'employee', fullName: 'Королёв' });
    const empToken = await sessionsRepo.createSession(emp.id, false, 'employee');
    const admin = await fx.createEmployee(org, { role: 'admin' });

    const reg = await app.inject({
      method: 'POST',
      url: '/miranda/devices/register',
      headers: { ...authAsSession(empToken), 'content-type': 'application/json' },
      payload: { platform: 'windows', storeId: store, label: 'ПК у входа' }
    });
    expect(reg.statusCode).toBe(200);
    const { deviceId, deviceSecret } = reg.json();
    deviceIds.push(deviceId);

    // Непривилегированный сотрудник не может подтвердить привязку.
    const pendingList = await app.inject({ method: 'GET', url: '/miranda/devices', headers: authAsSession(empToken) });
    expect(pendingList.statusCode).toBe(403);

    const bindingRow = await query(`SELECT id, corporate_account_id FROM miranda_device_bindings WHERE device_id = $1`, [deviceId]);
    const bindingId = bindingRow.rows[0].id;
    const corporateAccountId = Number(bindingRow.rows[0].corporate_account_id);
    corporateAccountIds.push(corporateAccountId);

    // requireAdmin без step-up — отказ.
    const approveNoStepUp = await app.inject({ method: 'POST', url: `/miranda/devices/${bindingId}/approve`, headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(approveNoStepUp.statusCode).toBe(403);
    expect(approveNoStepUp.json().error).toBe('step_up_required');

    const stepUp = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));
    const approve = await app.inject({
      method: 'POST',
      url: `/miranda/devices/${bindingId}/approve`,
      headers: { ...authAs(admin.telegramId), ...stepUp }
    });
    expect(approve.statusCode).toBe(200);

    const activate = await app.inject({
      method: 'POST',
      url: '/miranda/devices/activate',
      headers: { ...authAsSession(empToken), 'content-type': 'application/json' },
      payload: { deviceSecret }
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().status).toBe('active');
    expect(Number(activate.json().corporateAccountId)).toBe(corporateAccountId);

    const sessionRow = await query(`SELECT active_corporate_account_id FROM employee_sessions WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [empToken]);
    expect(Number(sessionRow.rows[0].active_corporate_account_id)).toBe(corporateAccountId);

    const revoke = await app.inject({
      method: 'POST',
      url: `/miranda/devices/${bindingId}/revoke`,
      headers: { ...authAs(admin.telegramId), ...stepUp }
    });
    expect(revoke.statusCode).toBe(200);

    const reActivate = await app.inject({
      method: 'POST',
      url: '/miranda/devices/activate',
      headers: { ...authAsSession(empToken), 'content-type': 'application/json' },
      payload: { deviceSecret }
    });
    expect(reActivate.statusCode).toBe(404);
    expect(reActivate.json().error).toBe('unknown_device');

    const auditActions = await query(
      `SELECT action FROM audit_log WHERE target_type IN ('miranda_device', 'miranda_device_binding') AND target_id = ANY($1::text[]) ORDER BY id ASC`,
      [[String(deviceId), String(bindingId)]]
    );
    expect(auditActions.rows.map((r: any) => r.action)).toEqual(
      expect.arrayContaining(['MIRANDA_DEVICE_REGISTERED', 'MIRANDA_DEVICE_APPROVED', 'MIRANDA_DEVICE_REVOKED'])
    );
  });

  it('admin не может переключиться на корпоративный аккаунт без явного гранта; с грантом — переключается, всё аудируется', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Switch Org');
    const target = await fx.createPhoneEmployee(org, '+79990000005', null, { role: 'employee', fullName: 'Целевой сотрудник' });
    const admin = await fx.createPhoneEmployee(org, '+79990000006', null, { role: 'admin', fullName: 'Админ' });
    await fx.enrollTotpFor(admin.id);
    const adminToken = await sessionsRepo.createSession(admin.id, true, 'admin');

    const acctRes = await query(
      `INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`,
      [org, target.id, 'Целевой сотрудник']
    );
    const corporateAccountId = Number(acctRes.rows[0].id);
    corporateAccountIds.push(corporateAccountId);

    const switchNoGrant = await app.inject({
      method: 'POST',
      url: '/miranda/session/switch',
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { corporateAccountId }
    });
    expect(switchNoGrant.statusCode).toBe(403);
    expect(switchNoGrant.json().error).toBe('not_granted');

    const grant = await app.inject({
      method: 'POST',
      url: '/miranda/admin-grants',
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { adminEmployeeId: admin.id, corporateAccountId }
    });
    expect(grant.statusCode).toBe(200);

    const available = await app.inject({ method: 'GET', url: '/miranda/accounts/available', headers: authAsSession(adminToken) });
    expect(available.statusCode).toBe(200);
    expect(available.json().items.some((i: any) => Number(i.corporate_account_id) === corporateAccountId)).toBe(true);

    const switchOk = await app.inject({
      method: 'POST',
      url: '/miranda/session/switch',
      headers: { ...authAsSession(adminToken), 'content-type': 'application/json' },
      payload: { corporateAccountId }
    });
    expect(switchOk.statusCode).toBe(200);

    const sessionRow = await query(`SELECT active_corporate_account_id FROM employee_sessions WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [adminToken]);
    expect(Number(sessionRow.rows[0].active_corporate_account_id)).toBe(corporateAccountId);

    const auditActions = await query(
      `SELECT action FROM audit_log WHERE target_type IN ('corporate_account') AND target_id = $1 ORDER BY id ASC`,
      [String(corporateAccountId)]
    );
    expect(auditActions.rows.map((r: any) => r.action)).toEqual(
      expect.arrayContaining(['MIRANDA_ADMIN_ACCOUNT_GRANTED', 'MIRANDA_ADMIN_ACCOUNT_SWITCH'])
    );
  });

  it('device_exclusive аккаунт — второе одновременное устройство не подтверждается, 409; после revoke первого — подтверждается', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Device Exclusive Org');
    const store = await fx.createStore(org, 'Космонавтов 20А');
    const emp = await fx.createPhoneEmployee(org, '+79990000009', null, { role: 'employee', fullName: 'Точка Космонавтов 20А' });
    const empToken = await sessionsRepo.createSession(emp.id, false, 'employee');
    const admin = await fx.createEmployee(org, { role: 'admin' });
    const stepUp = await setupTotpAndStepUp(admin.id, authAs(admin.telegramId));

    const reg1 = await app.inject({
      method: 'POST',
      url: '/miranda/devices/register',
      headers: { ...authAsSession(empToken), 'content-type': 'application/json' },
      payload: { platform: 'windows', storeId: store, label: 'Касса 1' }
    });
    const device1 = reg1.json();
    deviceIds.push(device1.deviceId);
    const binding1Row = await query(`SELECT id, corporate_account_id FROM miranda_device_bindings WHERE device_id = $1`, [device1.deviceId]);
    const binding1Id = binding1Row.rows[0].id;
    const corporateAccountId = Number(binding1Row.rows[0].corporate_account_id);
    corporateAccountIds.push(corporateAccountId);

    const markExclusive = await app.inject({
      method: 'PATCH',
      url: `/miranda/accounts/${corporateAccountId}/device-exclusive`,
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { deviceExclusive: true }
    });
    expect(markExclusive.statusCode).toBe(200);

    const approve1 = await app.inject({
      method: 'POST',
      url: `/miranda/devices/${binding1Id}/approve`,
      headers: { ...authAs(admin.telegramId), ...stepUp }
    });
    expect(approve1.statusCode).toBe(200);

    // Второе устройство того же (точечного) аккаунта — регистрируется на второй
    // сессии того же сотрудника, т.к. pending-binding всегда создаётся на
    // employee_id запрашивающего.
    const reg2 = await app.inject({
      method: 'POST',
      url: '/miranda/devices/register',
      headers: { ...authAsSession(empToken), 'content-type': 'application/json' },
      payload: { platform: 'windows', storeId: store, label: 'Касса 2' }
    });
    const device2 = reg2.json();
    deviceIds.push(device2.deviceId);
    const binding2Row = await query(`SELECT id FROM miranda_device_bindings WHERE device_id = $1`, [device2.deviceId]);
    const binding2Id = binding2Row.rows[0].id;

    const approve2Conflict = await app.inject({
      method: 'POST',
      url: `/miranda/devices/${binding2Id}/approve`,
      headers: { ...authAs(admin.telegramId), ...stepUp }
    });
    expect(approve2Conflict.statusCode).toBe(409);
    expect(approve2Conflict.json().error).toBe('device_exclusive_conflict');

    const revoke1 = await app.inject({
      method: 'POST',
      url: `/miranda/devices/${binding1Id}/revoke`,
      headers: { ...authAs(admin.telegramId), ...stepUp }
    });
    expect(revoke1.statusCode).toBe(200);

    const approve2Ok = await app.inject({
      method: 'POST',
      url: `/miranda/devices/${binding2Id}/approve`,
      headers: { ...authAs(admin.telegramId), ...stepUp }
    });
    expect(approve2Ok.statusCode).toBe(200);
  });

  it('GET /miranda/accounts — requireAdmin, видит только аккаунты своей сети', async () => {
    const app = await getApp();
    const orgA = await fx.createOrg('Miranda Accounts List Org A');
    const orgB = await fx.createOrg('Miranda Accounts List Org B');
    const empA = await fx.createPhoneEmployee(orgA, '+79990000007', null, { role: 'employee', fullName: 'Сотрудник A' });
    const empB = await fx.createPhoneEmployee(orgB, '+79990000008', null, { role: 'employee', fullName: 'Сотрудник B' });
    const adminA = await fx.createEmployee(orgA, { role: 'admin' });

    const acctA = await query(`INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`, [orgA, empA.id, 'Аккаунт A']);
    const acctB = await query(`INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`, [orgB, empB.id, 'Аккаунт B']);
    const corporateAccountIdA = Number(acctA.rows[0].id);
    const corporateAccountIdB = Number(acctB.rows[0].id);
    corporateAccountIds.push(corporateAccountIdA, corporateAccountIdB);

    const empActivate = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: authAs(adminA.telegramId, adminA.telegramGrantToken) });
    expect(empActivate.statusCode).toBe(200);
    const ids = empActivate.json().items.map((i: any) => Number(i.corporate_account_id));
    expect(ids).toContain(corporateAccountIdA);
    expect(ids).not.toContain(corporateAccountIdB);

    const empSessionToken = await sessionsRepo.createSession(empA.id, false, 'employee');
    const nonAdmin = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: authAsSession(empSessionToken) });
    expect(nonAdmin.statusCode).toBe(403);
  });

  // 20.76.0 (§C плана, "деактивация — не удаление") — без include_inactive
  // деактивированный аккаунт был не виден НИОТКУДА и восстановить его
  // было нечем (нашлось при аудите фронтенда: кнопки "Восстановить" не
  // было нигде, потому что список её физически не возвращал).
  it('GET /miranda/accounts — деактивированный аккаунт пропадает из списка по умолчанию и виден с include_inactive=1', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Accounts Inactive Org');
    const emp = await fx.createPhoneEmployee(org, '+79990000012', null, { role: 'employee', fullName: 'Сотрудник' });
    const admin = await fx.createEmployee(org, { role: 'admin' });

    const acct = await query(`INSERT INTO corporate_accounts (org_id, employee_id, display_label) VALUES ($1, $2, $3) RETURNING id`, [org, emp.id, 'Аккаунт']);
    const corporateAccountId = Number(acct.rows[0].id);
    corporateAccountIds.push(corporateAccountId);

    const beforeDeactivate = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(beforeDeactivate.json().items.map((i: any) => Number(i.corporate_account_id))).toContain(corporateAccountId);
    expect(beforeDeactivate.json().items.find((i: any) => Number(i.corporate_account_id) === corporateAccountId).is_active).toBe(true);

    const deactivate = await app.inject({ method: 'POST', url: `/miranda/accounts/${corporateAccountId}/deactivate`, headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(deactivate.statusCode).toBe(200);

    const defaultList = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(defaultList.json().items.map((i: any) => Number(i.corporate_account_id))).not.toContain(corporateAccountId);

    const withInactive = await app.inject({ method: 'GET', url: '/miranda/accounts?include_inactive=1', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    const found = withInactive.json().items.find((i: any) => Number(i.corporate_account_id) === corporateAccountId);
    expect(found).toBeDefined();
    expect(found.is_active).toBe(false);

    const reactivate = await app.inject({ method: 'POST', url: `/miranda/accounts/${corporateAccountId}/reactivate`, headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(reactivate.statusCode).toBe(200);

    const afterReactivate = await app.inject({ method: 'GET', url: '/miranda/accounts', headers: authAs(admin.telegramId, admin.telegramGrantToken) });
    expect(afterReactivate.json().items.map((i: any) => Number(i.corporate_account_id))).toContain(corporateAccountId);
  });

  it('POST /miranda/accounts — requireAdmin, создаёт явный аккаунт, отклоняет чужого сотрудника/чужую точку, конфликт на дубль, аудируется', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Miranda Create Account Org');
    const otherOrg = await fx.createOrg('Miranda Create Account Other Org');
    const store = await fx.createStore(org, 'Космонавтов 20А');
    const emp = await fx.createPhoneEmployee(org, '+79990000010', null, { role: 'employee', fullName: 'Новый сотрудник' });
    const empOtherOrg = await fx.createPhoneEmployee(otherOrg, '+79990000011', null, { role: 'employee', fullName: 'Чужой сотрудник' });
    const admin = await fx.createEmployee(org, { role: 'admin' });

    const nonAdminToken = await sessionsRepo.createSession(emp.id, false, 'employee');
    const forbidden = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAsSession(nonAdminToken), 'content-type': 'application/json' },
      payload: { employeeId: emp.id, displayLabel: 'Новый аккаунт' }
    });
    expect(forbidden.statusCode).toBe(403);

    const crossOrg = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { employeeId: empOtherOrg.id, displayLabel: 'Чужой' }
    });
    expect(crossOrg.statusCode).toBe(403);
    expect(crossOrg.json().error).toBe('forbidden');

    const badStore = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { employeeId: emp.id, storeId: 'no-such-store' }
    });
    expect(badStore.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { employeeId: emp.id, storeId: store, displayLabel: 'Касса у входа' }
    });
    expect(created.statusCode).toBe(201);
    const corporateAccountId = Number(created.json().item.id);
    corporateAccountIds.push(corporateAccountId);
    expect(Number(created.json().item.employee_id)).toBe(emp.id);

    const dup = await app.inject({
      method: 'POST',
      url: '/miranda/accounts',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { employeeId: emp.id, storeId: store }
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('conflict');

    const auditActions = await query(
      `SELECT action FROM audit_log WHERE target_type = 'corporate_account' AND target_id = $1 ORDER BY id ASC`,
      [String(corporateAccountId)]
    );
    expect(auditActions.rows.map((r: any) => r.action)).toEqual(expect.arrayContaining(['MIRANDA_ACCOUNT_CREATED']));
  });
});
