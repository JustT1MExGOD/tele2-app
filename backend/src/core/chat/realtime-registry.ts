/**
 * Org-scoped WebSocket registry для чата (§8 брифа). Один Map на org_id —
 * broadcast() физически не может дотянуться до соединения другой сети,
 * потому что даже не смотрит в её bucket. Соединение регистрируется уже
 * ПОСЛЕ auth/scope-проверки в самом WS-роуте (routes/chat/ws.ts) — сюда
 * никогда не попадает orgId, взятый откуда-то кроме authenticated principal.
 */
import type { WebSocket } from 'ws';
import { jobLogger } from '../../cron/job-logger.js';

const connectionsByOrg = new Map<string, Set<WebSocket>>();
const connectionCountByEmployee = new Map<number, number>();

/** §14 брифа — "realtime connection count/user". Открытых вкладок у одного
 * сотрудника обычно 1-2, десктоп+телефон+телега разом — не больше
 * нескольких; предел даёт запас на реальное использование, не на abuse. */
export const MAX_CONNECTIONS_PER_EMPLOYEE = 8;

export function connectionCountForEmployee(employeeId: number): number {
  return connectionCountByEmployee.get(employeeId) ?? 0;
}

export function registerConnection(orgId: string, employeeId: number, socket: WebSocket): void {
  let set = connectionsByOrg.get(orgId);
  if (!set) {
    set = new Set();
    connectionsByOrg.set(orgId, set);
  }
  set.add(socket);
  connectionCountByEmployee.set(employeeId, connectionCountForEmployee(employeeId) + 1);
}

export function unregisterConnection(orgId: string, employeeId: number, socket: WebSocket): void {
  const set = connectionsByOrg.get(orgId);
  if (set) {
    set.delete(socket);
    if (set.size === 0) connectionsByOrg.delete(orgId);
  }
  const count = connectionCountForEmployee(employeeId) - 1;
  if (count <= 0) connectionCountByEmployee.delete(employeeId);
  else connectionCountByEmployee.set(employeeId, count);
}

export function connectionCountForOrg(orgId: string): number {
  return connectionsByOrg.get(orgId)?.size ?? 0;
}

export function broadcastToOrg(orgId: string, payload: unknown): void {
  const set = connectionsByOrg.get(orgId);
  if (!set || !set.size) return;
  const data = JSON.stringify(payload);
  for (const socket of set) {
    try {
      if (socket.readyState === socket.OPEN) socket.send(data);
    } catch (e: any) {
      // Одно мёртвое соединение не должно ронять broadcast остальным — не
      // логируем body/payload (§17 брифа), только факт и категорию ошибки.
      jobLogger.warn({ event: 'chat_ws_broadcast_send_failed', org_id: orgId, err: e?.message || String(e) }, 'ws send failed');
    }
  }
}
