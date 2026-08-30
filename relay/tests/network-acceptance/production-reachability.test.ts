/**
 * NETWORK ACCEPTANCE — real calls to the real production origin. Not run
 * by `npm test`/`npx vitest run`/CI's default job — only via
 * `npm run test:network-acceptance` (see docs/DESKTOP-TESTING.md for the
 * UNIT/INTEGRATION/NETWORK ACCEPTANCE/AFFECTED NETWORK ACCEPTANCE
 * distinction). This is intentionally the ONE place in the relay test
 * suite that still talks to the real internet — proving the relay's
 * `forwardToUpstream` genuinely works against the real production
 * backend, not just local fixtures, without letting that non-determinism
 * leak into the default suite developers/CI run on every change.
 */
import { describe, it, expect } from 'vitest';
import { createUpstreamAgent, forwardToUpstream } from '../../src/forward.js';

const PRODUCTION_ORIGIN = 'https://tele2-app-production.up.railway.app';

describe('NETWORK ACCEPTANCE — relay forwardToUpstream against real production', () => {
  it('a real GET /healthz through the relay transport reaches the real backend', async () => {
    const agent = createUpstreamAgent();
    const result = await forwardToUpstream(
      { method: 'GET', path: '/healthz', hadOriginHeader: false, clientHeaders: new Headers(), body: null },
      PRODUCTION_ORIGIN,
      agent,
      8000
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body.toString())).toMatchObject({ status: 'ok' });
  }, 15000);

  it('the SSRF guard rejects a real loopback destination even with a real DNS lookup in play', async () => {
    const agent = createUpstreamAgent();
    await expect(
      forwardToUpstream(
        { method: 'GET', path: '/healthz', hadOriginHeader: false, clientHeaders: new Headers(), body: null },
        'https://localhost:1',
        agent,
        5000
      )
    ).rejects.toBeTruthy();
  });
});
