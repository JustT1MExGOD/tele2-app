# Картинка-отчёт

Эндпоинт:
- `GET /reports/day/:storeId?date=YYYY-MM-DD&kind=micro|final` → `{ ok, svg }` (kind=micro) или `{ ok, kind:'story', svgs: {plan, fact, tomorrow} }` (kind=final, по умолчанию)

Рендер и PNG (`report-image.ts`, resvg, шрифты из `assets/fonts`):
```ts
import { buildDailyReportPng, buildStoryReportPngs } from '../services/report-image.js';

// один кадр (micro-отчёт в течение дня)
const { png } = await buildDailyReportPng(storeId, date, { kind: 'micro', hourLabel: '14:00' });

// итог дня — 3 кадра альбомом (14.7.0): план → факт → фокус на завтра
const { plan, fact, tomorrow } = await buildStoryReportPngs(storeId, date);
await notifyChatMediaGroup([
  { buffer: plan, filename: `plan_${storeId}_${date}.png`, caption: '📋 план дня' },
  { buffer: fact, filename: `fact_${storeId}_${date}.png`, caption: '🏁 факт дня' },
  { buffer: tomorrow, filename: `tomorrow_${storeId}_${date}.png`, caption: '🔮 фокус на завтра' }
]);
```

Отправка в чат идёт через `cron/reports.ts` (по расписанию) или вручную:
`POST /reports/send-micro` / `POST /reports/send-final` (manager/admin).

Фолбэк-цепочка при сбое (см. `cron/reports.ts`): PNG → SVG-документ → простой текст.
Единственный рендерер — `report-image.ts`; параллельной реализации нет
(убрана в 14.10.0, дублировала тот же путь до тех же данных).
