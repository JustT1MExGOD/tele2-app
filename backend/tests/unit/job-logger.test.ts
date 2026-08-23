/**
 * 20.10.0 (Audit & Observability 2.0) — runJob() не должен пробрасывать
 * ошибку наружу (та же гарантия, что раньше давал `.catch(console.error)`
 * на каждом cron.schedule() вызове) — иначе один упавший job уронит весь
 * процесс необработанным rejection'ом.
 */
import { describe, it, expect } from 'vitest';
import { runJob } from '../../src/cron/job-logger.js';

describe('runJob', () => {
  it('успешный fn — не бросает, вызывающий код продолжает выполняться', async () => {
    let ran = false;
    await runJob('test.ok', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('упавший fn — ошибка перехвачена, runJob не пробрасывает её дальше', async () => {
    await expect(
      runJob('test.fail', async () => {
        throw new Error('boom');
      })
    ).resolves.toBeUndefined();
  });

  it('возвращаемое значение fn игнорируется — runJob всегда резолвится в undefined', async () => {
    const result = await runJob('test.value', async () => 42);
    expect(result).toBeUndefined();
  });
});
