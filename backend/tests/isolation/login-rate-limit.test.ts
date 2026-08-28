/**
 * 20.48.0 (Web Security & Trust Layer) — POST /auth/login ключует rate-limit
 * по sha256(normalizePhone(phone)), не по IP: закрывает distributed
 * brute-force по одному номеру через много IP, и разные форматы записи
 * одного номера ("+7999...", "8999...") бьют в один и тот же лимит.
 */
import { describe, it, expect } from 'vitest';
import { getApp } from '../helpers/app.js';

function uniquePhone(): string {
  return '+7906' + Math.floor(1000000 + Math.random() * 8999999);
}

describe('POST /auth/login — rate-limit по нормализованному телефону', () => {
  it('лимит (10/min) упирается по номеру независимо от формата записи — 11-й запрос 429', async () => {
    const app = await getApp();
    const canonical = uniquePhone();
    const digitsOnly = canonical.slice(1); // тот же номер без "+" — тот же нормализованный ключ

    const formats = [canonical, digitsOnly];
    let last;
    for (let i = 0; i < 11; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { phone: formats[i % formats.length], password: 'irrelevant-wrong-password' }
      });
    }
    expect(last!.statusCode).toBe(429);
  });
});
