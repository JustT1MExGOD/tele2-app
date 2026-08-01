# T2 Sales v6 — Control Center

## Что нового
- **Мой день** на главном (`GET /me/day`)
- **Дашборд 7 дней** (`GET /dashboard`) — топ виден всем
- **Месячные планы** — таблица **для всех**, редактирование только manager
- **Тикеты**: ответ manager → личка сотруднику
- **Копирование графика** на следующую неделю
- **Алерты**: 14:00 ноль продаж, 16:00 отставание точки
- **`/ready`** + version 6.0.0

## SQL
Выполни `schema-v6.sql`

## Backend
1. `src/routes-v6.ts`
2. `src/cron/alerts.ts` из `cron-alerts-v6.ts` (опционально)
3. В `index.ts`:
```ts
import { registerV6Routes } from './routes-v6.js';
import { startAlertCron } from './cron/alerts.js'; // если подключил

await registerPlansV5Routes(app);
await registerV6Routes(app);

// после listen:
startAlertCron();
```

## Frontend
Замени `frontend/index.html` на обновлённый.

## Важно про планы
- `GET /plans/employees/month` — **без** auth, видят все
- `PUT /plans/employees/:id/month` — только manager
- В UI: тап по имени для редактирования только если `canManage()`

## Проверка
```
/ready
/dashboard
/me/day   + header X-Telegram-Id
/plans/employees/month
```
