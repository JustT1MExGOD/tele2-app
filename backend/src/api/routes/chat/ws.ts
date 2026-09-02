/**
 * Realtime-доставка новых сообщений чата (§8/§34 брифа). REST остаётся
 * источником истины (§8 брифа) — WS только толкает уведомления о новых
 * канонических сообщениях, уже созданных через POST /chat/messages; сам
 * канонический контент никогда не создаётся и не подтверждается по WS.
 *
 * Auth — тот же requireActive() в preHandler, что и везде: если он не
 * пройден, @fastify/websocket отвечает обычным HTTP-статусом ДО апгрейда
 * до WS, соединение просто не открывается (не "открывается, потом рвётся").
 *
 * Периодическая ре-валидация (§34: "deleted/disabled employee with open
 * WS") — соединение может простоять часами; is_active/access_status
 * проверяются заново на каждый heartbeat, не только один раз при апгрейде.
 */
import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireActive } from '../../../auth/guards.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import { registerConnection, unregisterConnection, connectionCountForEmployee, MAX_CONNECTIONS_PER_EMPLOYEE } from '../../../core/chat/realtime-registry.js';
import { jobLogger } from '../../../cron/job-logger.js';

const HEARTBEAT_MS = 30_000;

/** Вынесено из замыкания heartbeat-таймера, чтобы юнит-тестам не нужно было
 * ждать реальные 30с — тестируют эту функцию напрямую (см. tests/isolation/
 * chat-realtime.test.ts). */
export async function isConnectionStillValid(employeeId: number, orgId: string): Promise<boolean> {
  const row = await employeesRepo.findById(employeeId).catch(() => null);
  return !!row && row.is_active !== false && row.access_status === 'active' && row.org_id === orgId;
}

export async function registerChatWsRoutes(app: FastifyInstance) {
  app.get(
    '/chat/ws',
    {
      websocket: true,
      preHandler: async (request, reply) => {
        if (!requireActive(request, reply)) return;
      }
    },
    (socket: WebSocket, request) => {
      const orgId = request.user!.org_id;
      const employeeId = request.user!.employee_id!;

      // §14 брифа — предел одновременных realtime-соединений на сотрудника.
      // Апгрейд уже случился (websocket:true отвечает за HTTP-уровень
      // раньше), поэтому "отказ" здесь — closed-код сразу после открытия,
      // не HTTP-статус; клиент видит закрытие с явной причиной, не тихий
      // обрыв.
      if (connectionCountForEmployee(employeeId) >= MAX_CONNECTIONS_PER_EMPLOYEE) {
        socket.close(4008, 'too_many_connections');
        return;
      }

      registerConnection(orgId, employeeId, socket);

      let alive = true;
      socket.on('pong', () => {
        alive = true;
      });

      const heartbeat = setInterval(() => {
        (async () => {
          if (!alive) {
            socket.terminate();
            return;
          }
          alive = false;
          // Ре-валидация принципала на каждый heartbeat — деактивированный/
          // заблокированный сотрудник теряет соединение в пределах одного
          // интервала, не остаётся авторизованным навсегда.
          if (!(await isConnectionStillValid(employeeId, orgId))) {
            socket.close(4001, 'session_invalidated');
            return;
          }
          socket.ping();
        })().catch((e: any) => {
          jobLogger.warn({ event: 'chat_ws_heartbeat_failed', err: e?.message || String(e) }, 'heartbeat check failed');
        });
      }, HEARTBEAT_MS);

      // Клиент не обязан ничего слать (WS тут только push-канал) —
      // входящие сообщения от клиента игнорируются, кроме keep-alive.
      socket.on('message', () => {});

      const cleanup = () => {
        clearInterval(heartbeat);
        unregisterConnection(orgId, employeeId, socket);
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    }
  );
}
