/**
 * Realtime-доставка новых сообщений мессенджера — структурно идентично
 * routes/chat/ws.ts, но регистрация в registry идёт по corporate_account_id
 * (активному на ЭТОЙ сессии), не по employee_id/org_id — доставка только
 * участникам конкретных диалогов (core/messenger/realtime-registry.ts).
 */
import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireActive } from '../../../auth/guards.js';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as mirandaRepo from '../../../data/repositories/miranda-accounts.js';
import * as messengerService from '../../../core/messenger/service.js';
import {
  registerConnection,
  unregisterConnection,
  connectionCountForAccount,
  MAX_CONNECTIONS_PER_ACCOUNT
} from '../../../core/messenger/realtime-registry.js';
import { jobLogger } from '../../../cron/job-logger.js';

const HEARTBEAT_MS = 30_000;

export async function isMessengerConnectionStillValid(employeeId: number, orgId: string, corporateAccountId: number): Promise<boolean> {
  const employee = await employeesRepo.findById(employeeId).catch(() => null);
  if (!employee || employee.is_active === false || employee.access_status !== 'active' || employee.org_id !== orgId) return false;
  const account = await mirandaRepo.getCorporateAccount(corporateAccountId).catch(() => null);
  return !!account && account.is_active && account.org_id === orgId;
}

export async function registerMirandaWsRoutes(app: FastifyInstance) {
  app.get(
    '/miranda/ws',
    {
      websocket: true,
      preHandler: async (request, reply) => {
        if (!requireActive(request, reply)) return;
      }
    },
    (socket: WebSocket, request) => {
      void (async () => {
        const orgId = request.user!.org_id;
        const employeeId = request.user!.employee_id!;
        const sessionToken = request.sessionToken;
        if (!sessionToken) {
          socket.close(4000, 'no_session_token');
          return;
        }
        const corporateAccountId = await messengerService.resolveActiveCorporateAccount(sessionToken);
        if (!corporateAccountId) {
          socket.close(4000, 'no_active_corporate_account');
          return;
        }

        if (connectionCountForAccount(corporateAccountId) >= MAX_CONNECTIONS_PER_ACCOUNT) {
          socket.close(4008, 'too_many_connections');
          return;
        }

        registerConnection(corporateAccountId, socket);

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
            if (!(await isMessengerConnectionStillValid(employeeId, orgId, corporateAccountId))) {
              socket.close(4001, 'session_invalidated');
              return;
            }
            socket.ping();
          })().catch((e: any) => {
            jobLogger.warn({ event: 'messenger_ws_heartbeat_failed', err: e?.message || String(e) }, 'heartbeat check failed');
          });
        }, HEARTBEAT_MS);

        socket.on('message', () => {});

        const cleanup = () => {
          clearInterval(heartbeat);
          unregisterConnection(corporateAccountId, socket);
        };
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      })().catch((e: any) => {
        jobLogger.warn({ event: 'messenger_ws_setup_failed', err: e?.message || String(e) }, 'ws setup failed');
        socket.close(4000, 'setup_failed');
      });
    }
  );
}
