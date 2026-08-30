/**
 * NETWORK ACCEPTANCE — real diagnostics against the real production
 * origin, real system DNS/TLS (no injected lookup/ca). Not run by
 * `npm test`/CI's default job — only via `npm run test:network-acceptance`.
 * Proves DIRECT mode's diagnostics chain works against the real backend
 * from this real machine — the thing the unit suite (now fully local,
 * see tests/network-diagnostics.test.ts) intentionally can't prove.
 */
import { describe, it, expect } from 'vitest';
import { runDiagnostics } from '../../src/main/network/diagnostics.js';

describe('NETWORK ACCEPTANCE — real DIRECT diagnostics against production', () => {
  it('DNS/TCP/TLS/HTTP all succeed against the real production origin', async () => {
    const report = await runDiagnostics('https://tele2-app-production.up.railway.app', { timeoutMs: 8000 });
    expect(report.overall).toBe('OK');
    expect(report.layers.map((l) => l.layer)).toEqual(['DNS', 'TCP', 'TLS', 'HTTP']);
  }, 15000);
});
