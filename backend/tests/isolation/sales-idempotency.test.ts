import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';

// Регрессия на unification-рефакторинг sales-write.ts: три пути записи
// продажи (POST /sales, POST /sales/quick, /sync/batch) раньше писали
// продажу по-разному (INSERT без GREATEST у quick, отсутствие
// sales_audit/sales_events у quick и sync) и ни один из трёх, кроме
// /sync/batch, не защищался от повторной отправки одного и того же
// запроса (двойной тап, сетевой ретрай) — сумма продажи удваивалась,
// потому что запись аддитивная (+=).
describe('Идемпотентность записи продажи (POST /sales, /sales/quick, /sync/batch)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let employeeA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    storeA = await fx.createStore(orgA);
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
  });

  afterAll(() => fx.cleanup());

  it('POST /sales — повторный запрос с тем же client_id не удваивает сумму', async () => {
    const app = await getApp();
    const clientId = 'test17-idem-' + Date.now();
    const payload = {
      employee_id: employeeA.id,
      store_id: storeA,
      sale_date: '2026-06-23',
      sim: 3,
      client_id: clientId
    };

    const first = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(second.statusCode).toBe(200);
    // Ключ уже занят — эндпоинт возвращает существующую строку sales вместо
    // повторного применения (а не {deduped:true} — та ветка только когда
    // строки sales ещё нет, что здесь не так).
    expect(Number(second.json().sim)).toBe(3);

    const row = await query(
      `SELECT sim FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [employeeA.id, storeA, '2026-06-23']
    );
    expect(Number(row.rows[0].sim)).toBe(3);
  });

  it('POST /sales — без client_id повторный запрос по-прежнему суммируется (обратная совместимость)', async () => {
    const app = await getApp();
    const payload = {
      employee_id: employeeA.id,
      store_id: storeA,
      sale_date: '2026-06-24',
      mnp: 1
    };

    await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });

    const row = await query(
      `SELECT mnp FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [employeeA.id, storeA, '2026-06-24']
    );
    expect(Number(row.rows[0].mnp)).toBe(2);
  });

  it('POST /sales/quick — повторный запрос с тем же client_id не удваивает сумму', async () => {
    const app = await getApp();
    const clientId = 'test17-idem-quick-' + Date.now();
    const payload = {
      text: '2 симки',
      employee_id: employeeA.id,
      store_id: storeA,
      sale_date: '2026-06-25',
      client_id: clientId
    };

    const first = await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().deduped).toBe(true);

    const row = await query(
      `SELECT sim FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [employeeA.id, storeA, '2026-06-25']
    );
    expect(Number(row.rows[0].sim)).toBe(2);
  });

  it('POST /sales/quick — теперь пишет в sales_audit (раньше не писал вообще)', async () => {
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: '/sales/quick',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { text: '1 симка', employee_id: employeeA.id, store_id: storeA, sale_date: '2026-06-26' }
    });

    const audit = await query(
      `SELECT * FROM sales_audit WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3 AND source = 'quick'`,
      [employeeA.id, storeA, '2026-06-26']
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('/sync/batch — повторная синхронизация того же op не меняет итоговую сумму', async () => {
    const app = await getApp();
    const clientId = 'test17-idem-sync-' + Date.now();
    const payload = {
      ops: [
        {
          client_id: clientId,
          type: 'sale',
          store_id: storeA,
          sale_date: '2026-06-27',
          metrics: { pa: 4 }
        }
      ]
    };

    const first = await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(first.json().results[0].status).toBe('applied');

    const second = await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload
    });
    expect(second.json().results[0].status).toBe('duplicate');

    const row = await query(
      `SELECT pa FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [employeeA.id, storeA, '2026-06-27']
    );
    expect(Number(row.rows[0].pa)).toBe(4);
  });

  it('/sync/batch — теперь пишет в sales_audit (раньше не писал вообще, свой инлайн-INSERT)', async () => {
    const app = await getApp();
    await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: {
        ops: [
          {
            client_id: 'test17-idem-sync-audit-' + Date.now(),
            type: 'sale',
            store_id: storeA,
            sale_date: '2026-06-28',
            metrics: { combo: 1 }
          }
        ]
      }
    });

    const audit = await query(
      `SELECT * FROM sales_audit WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3 AND source = 'sync'`,
      [employeeA.id, storeA, '2026-06-28']
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it('одна и та же продажа даёт одинаковый итог независимо от пути внесения (api/quick/sync)', async () => {
    const app = await getApp();
    const date = '2026-06-29';

    await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: { employee_id: employeeA.id, store_id: storeA, sale_date: date, sim: 1 }
    });
    await app.inject({
      method: 'POST',
      url: '/sync/batch',
      headers: { ...authAs(employeeA.telegramId), 'content-type': 'application/json' },
      payload: {
        ops: [
          {
            client_id: 'test17-cross-path-' + Date.now(),
            type: 'sale',
            store_id: storeA,
            sale_date: date,
            metrics: { sim: 1 }
          }
        ]
      }
    });

    const row = await query(
      `SELECT sim FROM sales WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3`,
      [employeeA.id, storeA, date]
    );
    expect(Number(row.rows[0].sim)).toBe(2);

    const auditRows = await query(
      `SELECT source FROM sales_audit WHERE employee_id = $1 AND store_id = $2 AND sale_date = $3 ORDER BY source`,
      [employeeA.id, storeA, date]
    );
    expect(auditRows.rows.map((r: any) => r.source).sort()).toEqual(['api', 'sync']);
  });
});
