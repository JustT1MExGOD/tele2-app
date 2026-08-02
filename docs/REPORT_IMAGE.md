# Картинка-отчёт

Эндпоинты:
- GET /reports/day/:storeId?date=YYYY-MM-DD → { svg, url }
- GET /reports/day/:storeId.svg?date=... → raw SVG

В боте (cron итога) можно:
```ts
import { buildDailyReportSvg } from '../services/report-image.js';
const svg = await buildDailyReportSvg(storeId, date, brand);
await bot.api.sendDocument(chatId, new InputFile(Buffer.from(svg), `report-${storeId}-${date}.svg`));
```

Для PNG нужен отдельный worker (sharp/resvg/playwright) — SVG уже «картинка» без тяжёлых deps.
