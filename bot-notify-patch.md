# Патч бота: HTML-сообщения + T2

В `src/bot/index.ts`:

## 1. Импорт

```ts
import {
  saleNotification,
  privateWelcome,
} from './bot-messages.js';
```

Положи `bot-messages.ts` рядом: `src/bot-messages.ts`  
(или `src/messages/bot-messages.ts` — поправь путь)

## 2. notifyChat с HTML

```ts
export async function notifyChat(text: string) {
  const chatId = process.env.CHAT_ID;
  if (!bot || !chatId) return;
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('notifyChat error', e);
    // fallback без HTML
    try {
      await bot.api.sendMessage(chatId, text.replace(/<[^>]+>/g, ''));
    } catch (_) {}
  }
}
```

## 3. Уведомление о продаже (в index.ts POST /sales)

Вместо простого текста:

```ts
import { saleNotification } from './bot-messages.js';

await notifyChat(
  saleNotification({
    employeeName: info.rows[0].full_name,
    storeName: info.rows[0].store_name,
    metric,
    value: body[metric],
  })
);
```

## 4. /start

```ts
bot.command('start', async (ctx) => {
  const url = process.env.WEBAPP_URL || '';
  const name = ctx.from?.first_name;
  await ctx.reply(privateWelcome(name), {
    parse_mode: 'HTML',
    reply_markup: url
      ? { inline_keyboard: [[{ text: '🍉 Открыть T2 Sales', web_app: { url } }]] }
      : undefined,
  });
});
```

## 5. Cron

Замени `src/cron/reports.ts` на `cron-reports-v4.ts`  
и поправь импорты `bot-messages`.
