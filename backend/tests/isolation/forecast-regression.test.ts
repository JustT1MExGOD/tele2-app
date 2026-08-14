import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';
import { forecastStore } from '../../src/services/forecast.js';

// 19.1 Forecast v2 — forecastStore() бэкпортировал фикс, уже проверенный
// в forecastRemainingOfMonth (заполнение пропущенных дней явными нулями,
// без него сглаженный уровень никогда не видит реальный ноль и
// застревает на старом пике). Регресс на реальной БД, не только на
// чистых функциях (unit/forecast-model.test.ts).
describe('forecastStore — интеграционный регресс на реальной истории', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let employeeA: { id: number; telegramId: number };
  let managerA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    storeA = await fx.createStore(orgA);
    employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });

    const todayStr = todayMoscow();
    // 15 дней активных продаж (sim=50/день), заканчивающихся 6 дней назад,
    // затем 5 дней подряд БЕЗ единой продажи (today-5 .. today-1) — точка
    // явно "затихла" недавно. Старый баг: без заполнения нулей уровень
    // остался бы у ~50 (последний ненулевой день), новый прогноз должен
    // отражать недавнюю тишину, а не старый пик.
    for (let i = 6; i < 21; i++) {
      const d = new Date(todayStr + 'T12:00:00');
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      await query(
        `INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,50)`,
        [employeeA.id, storeA, dateStr]
      );
    }
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('прогноз отражает недавнюю тишину, а не старый пик 15-дневной давности', async () => {
    const fc = await forecastStore(storeA, todayMoscow(), 3);
    expect(fc.history_days).toBe(15);
    // Уровень должен быть заметно ниже старого пика в 50 — 5 дней нулей
    // подряд перед сегодняшней датой должны были утянуть сглаженный
    // уровень вниз, а не остаться незамеченными.
    for (const item of fc.items) {
      expect(item.predicted.sim).toBeLessThan(25);
    }
  });

  it('GET /forecast/:storeId отдаёт ai_summary (null без GROQ_API_KEY, но числа не ломаются)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/forecast/${storeA}?days=3`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(3);
    expect('ai_summary' in body).toBe(true);
    // Тестовое окружение без GROQ_API_KEY — генерация должна тихо
    // фолбэчиться на null, не падать и не блокировать числовой прогноз.
    expect(body.ai_summary === null || typeof body.ai_summary === 'string').toBe(true);
  });
});
