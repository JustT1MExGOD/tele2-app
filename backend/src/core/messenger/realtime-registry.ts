/**
 * Participant-scoped WebSocket registry для мессенджера — ключевое отличие
 * от core/chat/realtime-registry.ts (там один Set на org_id, broadcast всей
 * сети). Здесь участник диалога — corporate_account_id (§4 плана), и
 * доставка должна дойти только до реально подключённых участников ЭТОГО
 * диалога, не до всей организации. Один сокет регистрируется per
 * corporate_account_id (устройство/вкладка уже активировало конкретный
 * аккаунт на своей сессии, см. core/miranda-accounts/service.ts) —
 * broadcastToMembers() сам резолвит участников через репозиторий и шлёт
 * только тем из них, у кого сейчас есть открытый socket.
 */
import type { WebSocket } from 'ws';
import { jobLogger } from '../../cron/job-logger.js';
import * as messengerRepo from '../../data/repositories/messenger.js';

const connectionsByCorporateAccount = new Map<number, Set<WebSocket>>();

/** §14 брифа (перенесено из чата) — предел одновременных соединений на
 * один корпоративный аккаунт, не на employee_id (один сотрудник с двумя
 * аккаунтами на разных точках — два независимых лимита). */
export const MAX_CONNECTIONS_PER_ACCOUNT = 8;

export function connectionCountForAccount(corporateAccountId: number): number {
  return connectionsByCorporateAccount.get(corporateAccountId)?.size ?? 0;
}

export function registerConnection(corporateAccountId: number, socket: WebSocket): void {
  let set = connectionsByCorporateAccount.get(corporateAccountId);
  if (!set) {
    set = new Set();
    connectionsByCorporateAccount.set(corporateAccountId, set);
  }
  set.add(socket);
}

// Тот же идемпотентный Set.delete()-приём, что у core/chat/realtime-registry.ts
// (hotfix 20.57.1 PASS 2, finding #2) — 'error' и 'close' оба могут сработать
// на одном сокете, второй вызов должен быть no-op.
export function unregisterConnection(corporateAccountId: number, socket: WebSocket): void {
  const set = connectionsByCorporateAccount.get(corporateAccountId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) connectionsByCorporateAccount.delete(corporateAccountId);
}

export async function broadcastToMembers(conversationId: string, payload: unknown): Promise<void> {
  const members = await messengerRepo.listMembers(conversationId);
  const data = JSON.stringify(payload);
  for (const member of members) {
    const set = connectionsByCorporateAccount.get(Number(member.corporate_account_id));
    if (!set || !set.size) continue;
    for (const socket of set) {
      try {
        if (socket.readyState === socket.OPEN) socket.send(data);
      } catch (e: any) {
        jobLogger.warn(
          { event: 'messenger_ws_broadcast_send_failed', corporate_account_id: member.corporate_account_id, err: e?.message || String(e) },
          'ws send failed'
        );
      }
    }
  }
}
