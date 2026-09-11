import { describe, it, expect, afterAll } from 'vitest';
import { getApp, authAs } from '../helpers/app.js';
import { TestFixtures } from '../helpers/fixtures.js';
import { query } from '../../src/data/db/index.js';

/**
 * Cross-tenant schema pollution / platform-wide DoS via POST /metrics
 * (src/api/routes/metrics.ts).
 *
 * plan_metrics (the custom-metric catalog) has NO org_id column by
 * design — metric definitions (SIM/MNP/combo/...) are genuinely
 * platform-wide vocabulary shared by every org's sale-entry/plan forms,
 * not per-tenant data. GET /metrics staying global is therefore correct,
 * NOT the bug. The actual bug was that POST/DELETE /metrics — which
 * mutate that shared catalog AND run `ALTER TABLE` on shared tables
 * (sales/store_plans/employee_month_plans/store_month_plans) — were
 * gated only by requireManager(), the lowest privilege tier, letting ANY
 * single org's manager widen schema that affects every org on the
 * platform, with no lifetime cap on how many times.
 *
 * FIXED: create/delete now require platform admin (role === 'admin'),
 * same pattern as api/routes/org/branding.ts's other platform-wide admin
 * routes — capability now matches blast radius. A lifetime cap
 * (MAX_CUSTOM_METRICS) also bounds total schema growth even for a
 * legitimate admin, closing the "no limit on count, only a 5/min rate
 * limit" gap.
 */
describe('ADVERSARIAL: POST/DELETE /metrics — schema-mutating routes now require platform admin, not any org manager', () => {
  const fx = new TestFixtures();
  const createdMetricIds: string[] = [];
  // plan_metrics is a genuinely global, unscoped table (see the fix note
  // above) — its row count persists across test FILES and across repeat
  // runs against the same local test DB, not just within this describe
  // block. Rows this file inserts to probe the cap are hard-DELETEd (not
  // soft-deactivated) so repeat runs don't push the real count further
  // past MAX_CUSTOM_METRICS each time and eventually break the "admin CAN
  // create" test above it.
  const capProbeIds: string[] = [];

  afterAll(async () => {
    await fx.cleanup();
    for (const id of createdMetricIds) {
      await query(`UPDATE plan_metrics SET is_active = false WHERE id = $1`, [id]).catch(() => {});
    }
    if (capProbeIds.length) {
      await query(`DELETE FROM plan_metrics WHERE id = ANY($1)`, [capProbeIds]).catch(() => {});
    }
  });

  it('a non-admin manager of one org is REJECTED from creating a metric — no ALTER TABLE runs, nothing leaks into the shared catalog', async () => {
    const orgAttacker = await fx.createOrg('Metrics Attacker Org');
    const attackerManager = await fx.createEmployee(orgAttacker, { role: 'manager', fullName: 'Attacker Manager' });

    const app = await getApp();
    const uniqueLabel = `Adversarial Pollution ${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: { ...authAs(attackerManager.telegramId), 'content-type': 'application/json' },
      payload: { label: uniqueLabel, unit: 'count' }
    });
    expect(createRes.statusCode).toBe(403);

    // Confirm the shared `sales` table was never touched — the rejection
    // happens before any ALTER TABLE, not just before the response.
    const colCheck = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name LIKE 'm_%'`
    );
    const slugified = uniqueLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    expect(colCheck.rows.some((r: any) => slugified.includes(r.column_name))).toBe(false);
  });

  it('a non-admin manager of one org is REJECTED from deleting a metric', async () => {
    const org = await fx.createOrg('Metrics Delete Attacker Org');
    const manager = await fx.createEmployee(org, { role: 'manager', fullName: 'Delete Attacker Manager' });

    const app = await getApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/metrics/sim', // a real, locked base metric — still must 403 before even reaching the "locked" check
      headers: authAs(manager.telegramId)
    });
    expect(res.statusCode).toBe(403);
  });

  it('a genuine platform admin CAN create a metric, and it correctly becomes visible platform-wide (intended behavior — metrics ARE shared vocabulary)', async () => {
    const orgAdmin = await fx.createOrg('Metrics Admin Org');
    const orgOther = await fx.createOrg('Metrics Other Org');
    const admin = await fx.createEmployee(orgAdmin, { role: 'admin', fullName: 'Platform Admin' });
    const otherEmployee = await fx.createEmployee(orgOther, { role: 'employee', fullName: 'Other Org Employee' });

    const app = await getApp();
    const uniqueLabel = `Admin Created Metric ${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { label: uniqueLabel, unit: 'count' }
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    createdMetricIds.push(created.item.id);

    const colCheck = await query(
      `SELECT table_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name = $1`,
      [created.item.id]
    );
    expect(colCheck.rows.length).toBe(1);

    // Correct, intended behavior: every org's sale-entry form should be
    // able to see the new shared metric — this is the catalog working
    // as designed, not a leak, now that only an admin can populate it.
    const otherViewRes = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: authAs(otherEmployee.telegramId)
    });
    const otherIds = otherViewRes.json().items.map((m: any) => m.id);
    expect(otherIds).toContain(created.item.id);
  });

  it('a lifetime cap (MAX_CUSTOM_METRICS) rejects new metric creation once reached, even for a genuine admin — bounds unlimited schema growth', async () => {
    const org = await fx.createOrg('Metrics Cap Org');
    const admin = await fx.createEmployee(org, { role: 'admin', fullName: 'Cap Test Admin' });
    const app = await getApp();

    // Directly seed plan_metrics up to the cap rather than making ~100
    // real POST calls (slow, and rate-limited at 5/min) — the route's own
    // cap check queries plan_metrics' real row count, so seeding it the
    // same way exercises the identical code path. Computed relative to
    // the CURRENT live count (not a hardcoded 100) so this stays correct
    // regardless of what other rows already exist from earlier test runs
    // against the same persistent local DB.
    const MAX_CUSTOM_METRICS = 100;
    const before = await query(`SELECT COUNT(*)::int AS c FROM plan_metrics`);
    const currentCount = Number(before.rows[0].c);
    const toSeed = Math.max(0, MAX_CUSTOM_METRICS - currentCount);
    for (let i = 0; i < toSeed; i++) {
      const id = `cap_probe_${i}_${Date.now()}`;
      await query(
        `INSERT INTO plan_metrics (id, label, short_label, unit, is_active, sort_order) VALUES ($1,$2,$3,'count',true,999) ON CONFLICT (id) DO NOTHING`,
        [id, `Cap Probe ${i}`, `CP${i}`]
      );
      capProbeIds.push(id);
    }

    const res = await app.inject({
      method: 'POST',
      url: '/metrics',
      headers: { ...authAs(admin.telegramId, admin.telegramGrantToken), 'content-type': 'application/json' },
      payload: { label: `Over The Cap ${Date.now()}`, unit: 'count' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('metric_limit_reached');
  });
});
