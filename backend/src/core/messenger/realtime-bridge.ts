/**
 * LISTEN/NOTIFY bridge мессенджера — структурно идентично
 * core/chat/realtime-bridge.ts, свой канал (t2_messenger_changed), свой
 * broadcastToMembers() (участникам диалога, не всей org).
 */
import { getRealtimeMessage } from './service.js';
import pg from 'pg';
import { broadcastToMembers } from './realtime-registry.js';

export function startMessengerRealtimeBridge(): () => Promise<void> {
  let client: pg.Client | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let active = 0;
  const pending = new Map<string, { orgId: string; conversationId: string; messageId: string }>();
  function drain() {
    while (!stopped && active < 2 && pending.size) {
      const [key, item] = pending.entries().next().value!;
      pending.delete(key);
      active++;
      void getRealtimeMessage(item.messageId, item.conversationId, item.orgId)
        .catch(() => null)
        .then(async (message) => {
          if (stopped || !message) return;
          await broadcastToMembers(item.conversationId, { type: 'message', message });
        })
        .catch(() => {
          /* Periodic REST catches up after a failed read/broadcast. */
        })
        .finally(() => {
          active--;
          drain();
        });
    }
  }
  function connect() {
    if (stopped) return;
    const connection = new pg.Client({
      connectionString: process.env.CHAT_LISTEN_DATABASE_URL || process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      ssl: process.env.PGSSL === 'false' ? false : undefined
    });
    client = connection;
    function disconnected() {
      if (client !== connection) return;
      client = null;
      void connection.end().catch(() => {});
      if (!stopped) {
        retry = setTimeout(connect, 5000);
        retry.unref();
      }
    }
    connection.on('error', disconnected);
    connection.on('end', disconnected);
    connection.on('notification', (event) => {
      if (!stopped && event.channel === 't2_messenger_changed' && event.payload) {
        try {
          const item = JSON.parse(event.payload);
          if (typeof item.orgId === 'string' && typeof item.conversationId === 'string' && typeof item.messageId === 'string' && pending.size < 100) {
            pending.set(`${item.conversationId}:${item.messageId}`, item);
            drain();
          }
        } catch {
          /* Ignore malformed notification; REST remains the source of truth. */
        }
      }
    });
    void connection
      .connect()
      .then(() => (stopped ? undefined : connection.query('LISTEN t2_messenger_changed')))
      .catch(disconnected);
  }
  connect();
  return async () => {
    stopped = true;
    pending.clear();
    if (retry) clearTimeout(retry);
    const current = client;
    client = null;
    if (current) await current.end().catch(() => {});
  };
}
