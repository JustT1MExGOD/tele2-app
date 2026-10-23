/**
 * Разовый сид демо-данных на ЛОКАЛЬНУЮ тестовую Postgres (т.к.
 * backend/.env.test.local -> DATABASE_URL=...@127.0.0.1:55432/t2_test).
 * Не для прода. Используется только чтобы снять скринкасты фич.
 */
import { query } from '../src/data/db/index.js';
import { hashPassword } from '../src/auth/password.js';
import { normalizePhone } from '../src/utils/phone.js';
import { todayMoscow } from '../src/utils/date.js';

const dbUrl = process.env.DATABASE_URL || '';
if (!/(^|@)(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)) {
  throw new Error('Этот сид только для локальной БД (DATABASE_URL должен указывать на localhost/127.0.0.1)');
}

async function createPhoneEmployee(
  orgId: string,
  phone: string,
  plainPassword: string,
  opts: { role: string; fullName: string }
) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error(`bad phone ${phone}`);
  const hash = await hashPassword(plainPassword);
  const res = await query(
    `INSERT INTO employees (full_name, phone, password_hash, role, access_status, is_active, org_id)
     VALUES ($1, $2, $3, $4, 'active', true, $5) RETURNING id`,
    [opts.fullName, normalized, hash, opts.role, orgId]
  );
  const id = Number(res.rows[0].id);
  await query(`INSERT INTO identities (employee_id, provider, provider_key) VALUES ($1, 'phone', $2)`, [id, normalized]);
  return id;
}

async function main() {
  console.log('Seeding demo org...');
  const orgRes = await query(
    `INSERT INTO organizations (id, name) VALUES ('demo_org', 'Демо-сеть Т2') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  const orgId = orgRes.rows[0].id as string;

  const stores = [
    { id: 'demo_store_1', name: 'ТЦ Галерея', status: 'ok' },
    { id: 'demo_store_2', name: 'Проспект Мира 12', status: 'warn' },
    { id: 'demo_store_3', name: 'ТРЦ Акварель', status: 'critical' },
  ];

  for (const s of stores) {
    await query(
      `INSERT INTO stores (id, code, name, short_name, hours, close_time_weekday, org_id)
       VALUES ($1, $1, $2, $2, 12, '21:00', $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [s.id, s.name, orgId]
    );
  }

  const todayStr = todayMoscow();

  // Дневной план на все три точки
  for (const s of stores) {
    await query(
      `INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, accessories, insurance, phones)
       VALUES ($1, $2, 12, 6, 8, 4, 20000, 6, 3)
       ON CONFLICT DO NOTHING`,
      [s.id, todayStr]
    );
  }

  console.log('Seeding employees (phone+password login)...');
  const empId1 = await createPhoneEmployee(orgId, '+79990000001', 'DemoPass123!', {
    role: 'employee',
    fullName: 'Анна Смирнова',
  });
  const empId2 = await createPhoneEmployee(orgId, '+79990000002', 'DemoPass123!', {
    role: 'employee',
    fullName: 'Игорь Петров',
  });
  const empId3 = await createPhoneEmployee(orgId, '+79990000003', 'DemoPass123!', {
    role: 'employee',
    fullName: 'Мария Кузнецова',
  });
  const managerId = await createPhoneEmployee(orgId, '+79990000099', 'DemoPass123!', {
    role: 'manager',
    fullName: 'Дмитрий Волков',
  });

  console.log('Seeding sales history (today, below plan on store 2 & 3 for a visible dip)...');
  // store_1 — хорошо выполняет план
  await query(
    `INSERT INTO sales (employee_id, store_id, sale_date, sim, mnp, pa, combo, accessories, insurance, phones)
     VALUES ($1, $2, $3, 11, 5, 7, 3, 18000, 5, 3)`,
    [empId1, stores[0].id, todayStr]
  );
  // store_2 — заметная просадка
  await query(
    `INSERT INTO sales (employee_id, store_id, sale_date, sim, mnp, pa, combo, accessories, insurance, phones)
     VALUES ($1, $2, $3, 3, 1, 2, 0, 2000, 1, 0)`,
    [empId2, stores[1].id, todayStr]
  );
  // store_3 — критическая просадка
  await query(
    `INSERT INTO sales (employee_id, store_id, sale_date, sim, mnp, pa, combo, accessories, insurance, phones)
     VALUES ($1, $2, $3, 1, 0, 0, 0, 0, 0, 0)`,
    [empId3, stores[2].id, todayStr]
  );

  console.log('Пишу график на сегодня (иначе главная считает день выходным)...');
  await query(
    `INSERT INTO schedules (employee_id, work_date, store_id, shift_text, hours) VALUES ($1, $2, $3, '10-21', 10)`,
    [empId1, todayStr, stores[0].id]
  );
  await query(
    `INSERT INTO schedules (employee_id, work_date, store_id, shift_text, hours) VALUES ($1, $2, $3, '10-21', 10)`,
    [empId2, todayStr, stores[1].id]
  );
  await query(
    `INSERT INTO schedules (employee_id, work_date, store_id, shift_text, hours) VALUES ($1, $2, $3, '10-21', 10)`,
    [empId3, todayStr, stores[2].id]
  );

  console.log('Открываю смены сотрудников (для живой карты и профиля)...');
  await query(
    `INSERT INTO shift_sessions (employee_id, store_id, work_date, status, opened_at)
     VALUES ($1, $2, $3, 'open', now())`,
    [empId1, stores[0].id, todayStr]
  );
  await query(
    `INSERT INTO shift_sessions (employee_id, store_id, work_date, status, opened_at)
     VALUES ($1, $2, $3, 'open', now())`,
    [empId2, stores[1].id, todayStr]
  );
  // store_3: смена ещё не открыта — "дыра" на карте

  console.log('Создаю smart-алерт по просевшей точке...');
  await query(
    `INSERT INTO smart_alerts (store_id, employee_id, alert_type, severity, title, body, status)
     VALUES ($1, $2, 'plan_drop', 'critical', 'Критическая просадка плана', 'ТРЦ Акварель — почти нет продаж за сегодня, смена не открыта', 'open')`,
    [stores[2].id, empId3]
  );
  await query(
    `INSERT INTO smart_alerts (store_id, employee_id, alert_type, severity, title, body, status)
     VALUES ($1, $2, 'plan_drop', 'warn', 'Просадка плана', 'Проспект Мира 12 — темп продаж ниже плана', 'open')`,
    [stores[1].id, empId2]
  );

  console.log('Готово.');
  console.log(JSON.stringify({ orgId, stores, empId1, empId2, empId3, managerId }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
