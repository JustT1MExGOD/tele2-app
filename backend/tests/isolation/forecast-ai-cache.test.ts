/**
 * 20.50.0 (Web Security & Trust Layer, часть 3, API Abuse Protection) —
 * GET /forecast/:storeId::ai_summary кэшируется по (storeId, from), но
 * `from` был полностью клиентским — разные from на каждый запрос давали
 * разные кэш-ключи и свежий Groq-вызов на КАЖДЫЙ запрос вместо "раз в
 * день на точку", как обещал комментарий в коде. Fix — AI-сводка
 * генерируется только когда from===todayMoscow(). Мокаем сам
 * integrations/ai/client.js (не только data/repositories/ai.js, как
 * unit/observability.test.ts) — GROQ_API_KEY в тестовом окружении не
 * задан, поэтому callGroq() и так вернул бы null и для дырявого, и для
 * починенного кода; только прямой мок generateForecastSummary() отличает
 * "не позвали вообще" от "позвали и получили null".
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';
import { todayMoscow } from '../../src/utils/date.js';

const generateForecastSummary = vi.fn().mockResolvedValue('mocked summary');
const getLatestForecastSummary = vi.fn().mockResolvedValue(null);
vi.mock('../../src/integrations/ai/client.js', () => ({
  generateForecastSummary: (...args: unknown[]) => generateForecastSummary(...args),
  getLatestForecastSummary: (...args: unknown[]) => getLatestForecastSummary(...args)
}));

describe('GET /forecast/:storeId — AI-сводка только для today (cache-busting через from закрыт)', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let storeA: string;
  let managerA: { id: number; telegramId: number };

  beforeAll(async () => {
    orgA = await fx.createOrg('Forecast AI Cache Org');
    storeA = await fx.createStore(orgA);
    const employeeA = await fx.createEmployee(orgA, { role: 'employee' });
    managerA = await fx.createEmployee(orgA, { role: 'manager' });

    // 20 дней истории — с запасом на fc.history_days>=7 независимо от
    // того, from=today или from=вчера в конкретном тесте ниже.
    const todayStr = todayMoscow();
    for (let i = 1; i <= 20; i++) {
      const d = new Date(todayStr + 'T12:00:00');
      d.setDate(d.getDate() - i);
      await query(`INSERT INTO sales (employee_id, store_id, sale_date, sim) VALUES ($1,$2,$3,10)`, [
        employeeA.id, storeA, d.toISOString().slice(0, 10)
      ]);
    }
  });

  afterAll(() => fx.cleanup());

  it('from=today, нет кэша — вызывает generateForecastSummary ровно один раз', async () => {
    generateForecastSummary.mockClear();
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/forecast/${storeA}?from=${todayMoscow()}&days=3`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ai_summary).toBe('mocked summary');
    expect(generateForecastSummary).toHaveBeenCalledTimes(1);
  });

  it('from=вчера — НЕ вызывает generateForecastSummary, ai_summary:null (не дёргает Groq на произвольный from)', async () => {
    generateForecastSummary.mockClear();
    const app = await getApp();
    const yesterday = (() => {
      const d = new Date(todayMoscow() + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const res = await app.inject({
      method: 'GET',
      url: `/forecast/${storeA}?from=${yesterday}&days=3`,
      headers: authAs(managerA.telegramId)
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ai_summary).toBeNull();
    expect(generateForecastSummary).not.toHaveBeenCalled();
  });
});
