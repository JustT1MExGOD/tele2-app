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

  /**
   * Hotfix 20.57.1 PASS 3, finding #2 — @fastify/rate-limit's default hook
   * is 'onRequest', which runs BEFORE body parsing (Fastify lifecycle:
   * onRequest → preParsing → Parsing → preValidation → preHandler →
   * handler); the keyGenerator above reads req.body.phone, so it was
   * ALWAYS undefined at that point and silently fell back to req.ip on
   * every single call — the phone-based key never actually worked. Fixed
   * by adding `hook: 'preHandler'` (body already parsed by then).
   *
   * The pre-existing test above (11th request 429) could NOT have caught
   * this: every app.inject() call in this file shares the same fake
   * connection/IP, so "keyed by phone" and "silently keyed by IP" produce
   * IDENTICAL behavior when only one phone is ever used per test. The test
   * below is the one that actually discriminates between the two: two
   * DIFFERENT phones from the same IP must get INDEPENDENT quotas.
   */
  it('finding #2 — два разных телефона с одного IP получают НЕЗАВИСИМЫЕ квоты (доказывает keyGenerator реально ключует по телефону, не молча по IP)', async () => {
    const app = await getApp();
    const phoneA = uniquePhone();
    const phoneB = uniquePhone();
    // Отдельный фиктивный IP только для этого теста (trustProxy:1 доверяет
    // одному хопу X-Forwarded-For) — иначе 21 запрос ниже делили бы IP
    // 127.0.0.1 с СОСЕДНИМ тестом файла и упёрлись бы в СОВСЕМ ДРУГОЙ,
    // отдельный Postgres-backed ipDimension-лимит (30/300s, security/
    // rate-limit.ts, независимый от Fastify keyGenerator и не то, что этот
    // тест проверяет).
    const ip = '10.77.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255);
    const headers = { 'x-forwarded-for': ip };

    // 10 запросов на A, затем 11-й — упирается в лимит (10/min) и по
    // Fastify-слою, и по независимому Postgres-backed identityDimension
    // (security/rate-limit.ts вызывается прямо в теле хендлера login с тем
    // же max=10/300s) — оба слоя ожидаемо и легитимно блокируют A здесь,
    // это не то, что тест проверяет.
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers,
        payload: { phone: phoneA, password: 'irrelevant-wrong-password' }
      });
      expect(r.statusCode).not.toBe(429);
    }
    const overA = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers,
      payload: { phone: phoneA, password: 'irrelevant-wrong-password' }
    });
    expect(overA.statusCode).toBe(429);

    // B ещё НИ РАЗУ не отправлялся — его собственная квота (Fastify И
    // Postgres) нетронута. Если бы keyGenerator молча фолбэчился на req.ip
    // (баг), B делил бы с A ОДИН исчерпанный Fastify-пул на этом IP и тоже
    // получил бы 429 здесь, несмотря на то что сам B ни разу не отправлял
    // запрос — именно это различает "ключуется по телефону" от "ключуется
    // по IP". (Postgres-слой у B тоже отдельный по identityDimension —
    // независимо и не ограничивает этот первый запрос.)
    const firstB = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers,
      payload: { phone: phoneB, password: 'irrelevant-wrong-password' }
    });
    expect(firstB.statusCode).not.toBe(429);
  });

  it('finding #2 — нераспознаваемый телефон (валиден по схеме, normalizePhone() возвращает null) безопасно фолбэчится на IP-ключ, не падает 500', async () => {
    const app = await getApp();
    // Схема требует minLength 7/maxLength 16 — это проходит валидацию, но
    // не матчит ни один RU-паттерн normalizePhone(), так что фолбэк на
    // req.ip — намеренное, безопасное поведение (никогда не бросает).
    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '0000000', password: 'irrelevant-wrong-password' }
    });
    expect(r.statusCode).not.toBe(500);
  });

  it('finding #2 — Postgres-backed identity-limiter (security/rate-limit.ts) остаётся активным независимо от Fastify keyGenerator', async () => {
    const { consume, identityDimension } = await import('../../src/security/rate-limit.js');
    const phoneHash = 'pass3-finding2-' + Math.random().toString(36).slice(2);
    for (let i = 0; i < 10; i++) {
      const r = await consume([identityDimension('login', phoneHash, 10, 300)]);
      expect(r.allowed).toBe(true);
    }
    const blocked = await consume([identityDimension('login', phoneHash, 10, 300)]);
    expect(blocked.allowed).toBe(false);
  });
});
