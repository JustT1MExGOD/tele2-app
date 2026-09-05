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

// Идемпотентно: ws.ts вешает cleanup() на оба события 'close' И 'error' одного
// сокета — при обрыве соединения обычно летят ОБА (error, затем close), и без
// охраны ниже счётчик per-employee декрементировался бы дважды за одно реальное
// отключение, постепенно уходя в минус относительно фактического числа
// открытых соединений (hotfix 20.57.1 PASS 2, finding #2). Set.delete()
// возвращает true только при первом вызове для данного сокета — это и есть
// сигнал "уже отменена регистрация", а не отдельный флаг на сокете.
export function unregisterConnection(orgId: string, employeeId: number, socket: WebSocket): void {
  const set = connectionsByOrg.get(orgId);
  const wasRegistered = set ? set.delete(socket) : false;
  if (set && set.size === 0) connectionsByOrg.delete(orgId);
  if (!wasRegistered) return;
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
