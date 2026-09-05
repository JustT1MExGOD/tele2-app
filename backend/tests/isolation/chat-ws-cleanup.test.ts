/**
 * Hotfix 20.57.1 PASS 2, finding #2 — WEBSOCKET CLEANUP (idempotent unregister).
 *
 * routes/chat/ws.ts registers the SAME cleanup() closure on both the 'close'
 * AND 'error' socket events — a real network failure typically emits both
 * for the same disconnect (error, then close), so cleanup() runs twice per
 * actual disconnection. Before this fix, unregisterConnection() in
 * realtime-registry.ts unconditionally decremented connectionCountByEmployee
 * on every call, so a single error+close pair would decrement the counter
 * twice for one lost socket — drifting the count below the real number of
 * open connections and eventually letting MORE than MAX_CONNECTIONS_PER_
 * EMPLOYEE sockets stay open at once (the check in ws.ts trusts this counter).
 *
 * Tested here directly at the registry level (not over a real WS server):
 * the bug and the fix both live entirely in unregisterConnection()'s own
 * idempotency, independent of how many times — or in what event order — a
 * caller happens to invoke it for the same socket. This is the same
 * fake-socket pattern as a Set keyed by object identity — any distinct
 * object works as a "socket", real ws.WebSocket behavior is not exercised.
 */
import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import {
  registerConnection,
  unregisterConnection,
  connectionCountForEmployee,
  connectionCountForOrg,
  MAX_CONNECTIONS_PER_EMPLOYEE
} from '../../src/core/chat/realtime-registry.js';

function fakeSocket(): WebSocket {
  return {} as WebSocket;
}

describe('realtime-registry — idempotent unregisterConnection (WS cleanup double-fire)', () => {
  it('error-затем-close на одном сокете — счётчик уменьшается только один раз', () => {
    const orgId = `ws-cleanup-org-${crypto.randomUUID()}`;
    const employeeId = Math.floor(Math.random() * 1_000_000_000);
    const socket = fakeSocket();

    registerConnection(orgId, employeeId, socket);
    expect(connectionCountForEmployee(employeeId)).toBe(1);

    // 'error' handler fires cleanup() first...
    unregisterConnection(orgId, employeeId, socket);
    expect(connectionCountForEmployee(employeeId)).toBe(0);

    // ...then 'close' fires the SAME cleanup() for the SAME socket — must be a no-op.
    unregisterConnection(orgId, employeeId, socket);
    expect(connectionCountForEmployee(employeeId)).toBe(0); // не -1
  });

  it('только close (без error) — базовый случай не сломан', () => {
    const orgId = `ws-cleanup-org-${crypto.randomUUID()}`;
    const employeeId = Math.floor(Math.random() * 1_000_000_000);
    const socket = fakeSocket();

    registerConnection(orgId, employeeId, socket);
    unregisterConnection(orgId, employeeId, socket);
    expect(connectionCountForEmployee(employeeId)).toBe(0);
    expect(connectionCountForOrg(orgId)).toBe(0);
  });

  it('несколько параллельных сокетов одного сотрудника — двойной cleanup одного не задевает остальные', () => {
    const orgId = `ws-cleanup-org-${crypto.randomUUID()}`;
    const employeeId = Math.floor(Math.random() * 1_000_000_000);
    const sockets = Array.from({ length: 4 }, () => fakeSocket());

    for (const s of sockets) registerConnection(orgId, employeeId, s);
    expect(connectionCountForEmployee(employeeId)).toBe(4);

    // Двойной cleanup (error+close) на одном из четырёх.
    unregisterConnection(orgId, employeeId, sockets[0]);
    unregisterConnection(orgId, employeeId, sockets[0]);
    expect(connectionCountForEmployee(employeeId)).toBe(3);

    for (const s of sockets.slice(1)) unregisterConnection(orgId, employeeId, s);
    expect(connectionCountForEmployee(employeeId)).toBe(0);
  });

  it('счётчик никогда не уходит в отрицательные значения — множественный cleanup всех сокетов', () => {
    const orgId = `ws-cleanup-org-${crypto.randomUUID()}`;
    const employeeId = Math.floor(Math.random() * 1_000_000_000);
    const sockets = Array.from({ length: 3 }, () => fakeSocket());
    for (const s of sockets) registerConnection(orgId, employeeId, s);

    // Каждый сокет "падает" с error+close — двойной cleanup на всех.
    for (const s of sockets) {
      unregisterConnection(orgId, employeeId, s);
      unregisterConnection(orgId, employeeId, s);
    }
    expect(connectionCountForEmployee(employeeId)).toBe(0);
    expect(connectionCountForOrg(orgId)).toBe(0);
  });

  it('§14: лимит 8 соединений остаётся корректным после error+close дребезга — 9-е реальное соединение всё ещё считается лишним', () => {
    const orgId = `ws-cleanup-org-${crypto.randomUUID()}`;
    const employeeId = Math.floor(Math.random() * 1_000_000_000);
    const sockets = Array.from({ length: MAX_CONNECTIONS_PER_EMPLOYEE }, () => fakeSocket());
    for (const s of sockets) registerConnection(orgId, employeeId, s);
    expect(connectionCountForEmployee(employeeId)).toBe(MAX_CONNECTIONS_PER_EMPLOYEE);

    // Один из открытых сокетов получает дребезг error+close (двойной cleanup),
    // но остальные 7 остаются реально открытыми — без idempotency-фикса
    // счётчик упал бы до 6 (двойной декремент), ложно разрешая ЕЩЁ ДВА новых
    // соединения вместо одного.
    unregisterConnection(orgId, employeeId, sockets[0]);
    unregisterConnection(orgId, employeeId, sockets[0]);
    expect(connectionCountForEmployee(employeeId)).toBe(MAX_CONNECTIONS_PER_EMPLOYEE - 1);

    // ws.ts's guard: `if (connectionCountForEmployee(employeeId) >= MAX...) reject`
    expect(connectionCountForEmployee(employeeId) >= MAX_CONNECTIONS_PER_EMPLOYEE).toBe(false);
    const ninth = fakeSocket();
    registerConnection(orgId, employeeId, ninth);
    expect(connectionCountForEmployee(employeeId)).toBe(MAX_CONNECTIONS_PER_EMPLOYEE);
    expect(connectionCountForEmployee(employeeId) >= MAX_CONNECTIONS_PER_EMPLOYEE).toBe(true);

    for (const s of sockets.slice(1)) unregisterConnection(orgId, employeeId, s);
    unregisterConnection(orgId, employeeId, ninth);
    expect(connectionCountForEmployee(employeeId)).toBe(0);
  });
});
