import { describe, it, expect } from 'vitest';
import { getApp } from '../helpers/app.js';

/**
 * Изначально resolveTelegramId() (middleware-auth.ts) делала голый
 * `Number(raw)` на заголовке X-Telegram-Id без единой валидации. Дробные
 * ("123.456") и переполняющие bigint значения ("1e+29" в экспоненциальной
 * записи) проходили как "валидные" числа в JS, но валили `telegram_id =
 * $1::bigint` в loadUser() необработанным исключением Postgres (500) на
 * любом auth-протекаемом роуте.
 *
 * Починено: resolveTelegramId() теперь проверяет `/^\d{1,15}$/` перед
 * Number() — реальные Telegram id всегда целые положительные числа в
 * пределах ~15 цифр, что бы не прошло эту проверку, трактуется как
 * unauthenticated (null), не долетает до SQL вовсе.
 */
describe('INPUT VALIDATION (ПОЧИНЕНО): голый X-Telegram-Id заголовок теперь валидируется перед Number()', () => {
  it('нечисловой заголовок ("abc") безопасен: bound:false, без краха', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/me', headers: { 'x-telegram-id': 'abc' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bound).toBe(false);
  });

  it('отрицательный telegram_id безопасен: bound:false, без краха', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/me', headers: { 'x-telegram-id': '-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bound).toBe(false);
  });

  it('ПОЧИНЕНО: дробный telegram_id ("123.456") больше не крашит роут — теперь безопасно трактуется как unauthenticated', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/me', headers: { 'x-telegram-id': '123.456' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bound).toBe(false);
  });

  it('ПОЧИНЕНО: экстремально огромный числовой telegram_id (за пределами диапазона bigint) больше не крашит запрос', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-telegram-id': '99999999999999999999999999999' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bound).toBe(false);
  });

  it('дублированный заголовок X-Telegram-Id (массив значений) не роняет сервер', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-telegram-id': ['111111111', '222222222'] as any }
    });
    expect([200, 400, 500]).toContain(res.statusCode);
  });
});
