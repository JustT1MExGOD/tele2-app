/**
 * 20.82.0 — coverage for the global persistent mirror of explicit sensitive
 * route limits. The in-memory @fastify/rate-limit layer alone resets on
 * restart; the Postgres layer must share the same route budget and continue
 * after the per-process limit is already exhausted.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { query } from '../../src/data/db/index.js';
import { getApp } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { authAs } from '../helpers/app.js';

describe('Distributed route rate-limit mirror', () => {
  const fx = new TestFixtures();

  afterAll(async () => {
    await fx.cleanup();
    await query(`DELETE FROM security_rate_limit_counters WHERE bucket_key LIKE 'route:%'`);
  });

  it('continues enforcing a sensitive route budget in Postgres after the process-local limit is exhausted', async () => {
    const app = await getApp();
    const orgId = await fx.createOrg();
    const employee = await fx.createEmployee(orgId, { role: 'employee' });
    const headers = authAs(employee.telegramId);
    const ip = '10.95.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255);

    let first = 0;
    for (let i = 0; i < 5; i++) {
      first = (await app.inject({
        method: 'POST',
        url: '/metrics',
        headers: { ...headers, 'x-forwarded-for': ip },
        payload: { key: `security_rl_${Date.now()}_${i}`, label: 'Security RL', type: 'metric' }
      })).statusCode;
      expect(first).toBe(403); // authenticated, but employee cannot mutate global metrics
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: { ...headers, 'x-forwarded-for': ip },
      payload: { key: `security_rl_${Date.now()}_blocked`, label: 'Security RL', type: 'metric' }
    });
    expect(blocked.statusCode).toBe(429);
    // The in-memory layer denies request #6 before the mirror hook runs, so
    // the persisted counter caps at exactly `max` — it never races past the
    // budget that the immediate layer already enforces.
    const { rows } = await query(`SELECT count FROM security_rate_limit_counters WHERE bucket_key = $1`, [`route:POST /metrics:acct:${employee.id}`]);
    expect(Number(rows[0].count)).toBe(5);
  });

  it('denies a request whose persisted budget was already exhausted before this process existed', async () => {
    const app = await getApp();
    const orgId = await fx.createOrg();
    const employee = await fx.createEmployee(orgId, { role: 'employee' });
    const key = `route:POST /metrics:acct:${employee.id}`;
    // Simulate the counter state a restart would leave behind: the in-memory
    // plugin's view is empty, but Postgres remembers the budget as spent.
    await query(
      `INSERT INTO security_rate_limit_counters (bucket_key, window_start, count)
       VALUES ($1, $2, 5)`,
      [key, new Date(Math.floor(Date.now() / 60000) * 60000).toISOString()]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: { ...authAs(employee.telegramId), 'x-forwarded-for': '10.96.' + Math.floor(Math.random() * 255) + '.1' },
      payload: { label: 'Security RL restart' }
    });
    // Without the persistent mirror this would be 403 (role) or 200 —
    // the fresh in-memory limiter had never seen this request path.
    expect(res.statusCode).toBe(429);
  });
});
