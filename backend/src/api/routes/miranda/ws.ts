/**
 * Realtime-доставка новых сообщений мессенджера — структурно идентично
 * routes/chat/ws.ts, но регистрация в registry идёт по corporate_account_id
 * (активному на ЭТОЙ сессии), не по employee_id/org_id — доставка только
 * участникам конкретных диалогов (core/messenger/realtime-registry.ts).
 */
import { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import * as employeesRepo from '../../../data/repositories/employees.js';
import * as mirandaRepo from '../../../data/repositories/miranda-accounts.js';
import * as pointSessionsRepo from '../../../data/repositories/corporate-account-sessions.js';
import { resolveMirandaPrincipal, MirandaPrincipal } from '../../../core/miranda-accounts/service.js';
import {
  registerConnection,
  unregisterConnection,
  connectionCountForAccount,
  MAX_CONNECTIONS_PER_ACCOUNT
} from '../../../core/messenger/realtime-registry.js';
import { jobLogger } from '../../../cron/job-logger.js';

const HEARTBEAT_MS = 30_000;

/** Этап B — две параллельные ветки ревалидации на каждый heartbeat:
 * обычный сотрудник (employeeId известен) или точка (point-сессия,
 * ревалидируется по хэшу собственного токена, не employee_sessions). */
export async function isMessengerConnectionStillValid(principal: MirandaPrincipal, pointToken: string | null): Promise<boolean> {
  if (principal.actorEmployeeId !== null) {
    const employee = await employeesRepo.findById(principal.actorEmployeeId).catch(() => null);
    if (!employee || employee.is_active === false || employee.access_status !== 'active' || employee.org_id !== principal.orgId) return false;
  } else if (pointToken) {
    const stillValid = await pointSessionsRepo.isStillValid(principal.corporateAccountId, pointSessionsRepo.hashToken(pointToken)).catch(() => false);
    if (!stillValid) return false;
  } else {
    return false;
  }
  const account = await mirandaRepo.getCorporateAccount(principal.corporateAccountId).catch(() => null);
  return !!account && account.is_active && account.org_id === principal.orgId;
}

export async function registerMirandaWsRoutes(app: FastifyInstance) {
  app.get(
    '/miranda/ws',
    {
      websocket: true,
      preHandler: async (request, reply) => {
        const principal = await resolveMirandaPrincipal(request, reply);
        (request as any).mirandaPrincipal = principal;
      }
    },
    (socket: WebSocket, request) => {
      void (async () => {
        const principal = (request as any).mirandaPrincipal as MirandaPrincipal | null;
        if (!principal) {
          socket.close(4000, 'unauthorized');
          return;
        }
        const corporateAccountId = principal.corporateAccountId;
        const pointToken = request.cookies?.[pointSessionsRepo.POINT_COOKIE_NAME] || null;

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
            if (!(await isMessengerConnectionStillValid(principal, pointToken))) {
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
