/**
 * §5 (Auth Assurance Hardening, 20.52.1) — regression coverage for the
 * business metrics-catalog routes (api/routes/metrics.ts). Never had any
 * test coverage before this — a route collision with the Prometheus
 * /metrics endpoint (app.ts) silently prevented this entire module from
 * registering at all since Prometheus /metrics was added (found by an
 * external security audit, confirmed by reproducing locally). Fixed by
 * moving Prometheus to /metrics/system and making registerAllRoutes()
 * fail loudly on any registration error instead of swallowing it — this
 * test asserts the actual JSON catalog shape, which alone would have
 * caught the original bug (it was returning Prometheus text/plain instead).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('Business metrics catalog (GET/POST/DELETE /metrics)', () => {
  const fx = new TestFixtures();
  afterAll(() => fx.cleanup());

  it('GET /metrics returns the JSON catalog shape, not Prometheus text', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty('id');
    expect(body.items[0]).toHaveProperty('label');
    expect(body.items[0]).toHaveProperty('unit');
  });

  it('GET /metrics is public (no auth required) — matches production frontend usage before login', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
  });

  it('POST /metrics requires manager+; a plain employee gets 403', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Metrics Route Org');
    const employee = await fx.createEmployee(org, { role: 'employee' });
    const res = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: authAs(employee.telegramId),
      payload: { label: 'Test Metric' }
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /metrics as manager creates a metric, then it appears in GET /metrics; DELETE deactivates it', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Metrics Route Manager Org');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const label = `Regression Test Metric ${Date.now()}`;

    const create = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: authAs(manager.telegramId),
      payload: { label }
    });
    expect(create.statusCode).toBe(200);
    const created = create.json();
    expect(created.ok).toBe(true);
    const id = created.item.id as string;

    const list = await app.inject({ method: 'GET', url: '/metrics' });
    const items = list.json().items as Array<{ id: string; label: string }>;
    expect(items.some((m) => m.id === id && m.label === label)).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/metrics/${id}`,
      headers: authAs(manager.telegramId)
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true, id, active: false });
  });

  it('DELETE /metrics/:id refuses to remove a locked base metric', async () => {
    const app = await getApp();
    const org = await fx.createOrg('Metrics Route Locked Org');
    const manager = await fx.createEmployee(org, { role: 'manager' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/metrics/sim',
      headers: authAs(manager.telegramId)
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('locked');
  });
});
