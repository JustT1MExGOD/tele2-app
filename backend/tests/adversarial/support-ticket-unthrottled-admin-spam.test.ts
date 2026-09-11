import { describe, it, expect } from 'vitest';
import { getApp } from '../helpers/app.js';

/**
 * Unauthenticated resource-exhaustion / admin-notification-spam gap:
 * POST /support (src/api/routes/ops/support.ts) is intentionally reachable
 * without auth (guests without an employee card can open a ticket).
 * Unlike every other "expensive" or abuse-relevant route in the codebase
 * (POST /metrics: 5/min, GET /forecast/:storeId: 20/min, GET
 * /export/sales.csv: 10/min, POST /access/request: 5/min — see
 * tests/isolation/api-abuse-rate-limits.test.ts), POST /support used to
 * have NO `config.rateLimit` of its own at all, falling back to only the
 * global limiter (app.ts, 300 requests/min per IP, shared across ALL
 * routes) — a real spam vector since each successful call fires
 * `notifyAdmin()` (a live Telegram message to the admin chat).
 *
 * FIXED: POST /support now has its own 5/min per-IP limit, matching the
 * only other guest-accessible write route in this codebase
 * (POST /access/request).
 */
describe('ADVERSARIAL: POST /support — now has its own 5/min rate limit, matching the other guest-write route', () => {
  it('POST /support — лимит 5/мин, 6-й анонимный запрос 429', async () => {
    const app = await getApp();

    let last;
    for (let i = 0; i < 6; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/support',
        headers: { 'content-type': 'application/json' },
        payload: { message: `Спам-тест анонимного тикета #${i}` }
      });
    }
    expect(last!.statusCode).toBe(429);
  });
});
