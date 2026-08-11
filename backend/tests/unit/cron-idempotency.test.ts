import { describe, it, expect, afterAll } from 'vitest';
import { claimCronSend } from '../../src/cron/reports.js';
import { query } from '../../src/db/index.js';

// Регрессия: ни micro/final отчёты, ни напоминания о завтрашней смене не
// были защищены от повторной отправки. Два реальных сценария: (1) Railway
// держит старый контейнер живым, пока новый не пройдёт healthcheck — при
// деплое ровно в минуту отчёта оба процесса могли независимо тикнуть и
// оба отправить фото; (2) есть ручная кнопка «отправить сейчас» —
// менеджер мог нажать её в ту же минуту, что и автоматический тик.
describe('claimCronSend — идемпотентность cron-рассылок', () => {
  const keys: string[] = [];

  afterAll(async () => {
    if (keys.length) await query(`DELETE FROM cron_send_log WHERE key = ANY($1)`, [keys]);
  });

  it('первый claim по ключу — true (можно отправлять)', async () => {
    const key = 'test17-cron-' + Date.now() + '-a';
    keys.push(key);
    expect(await claimCronSend(key)).toBe(true);
  });

  it('повторный claim по тому же ключу — false (уже отправлено, пропускаем)', async () => {
    const key = 'test17-cron-' + Date.now() + '-b';
    keys.push(key);
    expect(await claimCronSend(key)).toBe(true);
    expect(await claimCronSend(key)).toBe(false);
    expect(await claimCronSend(key)).toBe(false);
  });

  it('два параллельных claim одним и тем же ключом — ровно один получает true', async () => {
    const key = 'test17-cron-' + Date.now() + '-c';
    keys.push(key);
    const [r1, r2] = await Promise.all([claimCronSend(key), claimCronSend(key)]);
    const trueCount = [r1, r2].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it('разные ключи (разные точка/дата/час) независимы друг от друга', async () => {
    const keyA = 'test17-cron-' + Date.now() + '-store-A-2026-06-01-10';
    const keyB = 'test17-cron-' + Date.now() + '-store-B-2026-06-01-10';
    keys.push(keyA, keyB);
    expect(await claimCronSend(keyA)).toBe(true);
    expect(await claimCronSend(keyB)).toBe(true);
  });
});
