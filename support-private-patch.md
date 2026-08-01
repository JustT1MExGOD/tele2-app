# Поддержка → личные сообщения админу

В `.env` / Railway Variables:

```env
ADMIN_TELEGRAM_ID=1123320611
```

(твой личный Telegram user id)

## В `src/bot/index.ts` добавь:

```ts
export async function notifyAdmin(text: string) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!bot || !adminId) {
    console.warn('ADMIN_TELEGRAM_ID не задан — тикет не отправлен в личку');
    return;
  }
  try {
    await bot.api.sendMessage(adminId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('notifyAdmin error', e);
    try {
      await bot.api.sendMessage(adminId, text.replace(/<[^>]+>/g, ''));
    } catch (_) {}
  }
}
```

## В `routes-v4.ts` (POST /support)

Замени отправку в CHAT_ID на:

```ts
import { notifyAdmin } from './bot/index.js';
import { supportTicketAdmin } from './bot-messages.js';

// вместо notifyChat(...):
if (!autoAnswer) {
  await notifyAdmin(
    supportTicketAdmin({
      from: full_name,
      category,
      message,
      ticketId: ticket.id,
    })
  );
}
```

Тикеты поддержки больше **не** уходят в общий чат точки.
