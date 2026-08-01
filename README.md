# T2 Sales — v12

Telegram Mini App + Fastify + PostgreSQL для сети салонов связи.

## Что в этом апдейте

- Единый auth (employee / manager / **admin**)
- Тикеты поддержки **только для admin** + чат сообщений
- Сотрудник **не может** вносить продажи за других
- Исправление ошибочных продаж (дельта ±)
- Без предвыбора SIM при добавлении
- Уведомления о продаже с **несколькими метриками**
- Дневные планы точек из месячных (ceil, 50/30/20)
- `/me`, `/me/day`, `/access/*` подключены
- Обучение с подсветкой и анимацией

## Структура

```
tele2-app-v12/
  backend/src/     — Node + Fastify
  frontend/        — Mini App (index.html)
  sql/             — патчи схемы
  README.md
```

## Деплой (Railway)

1. Скопируй `backend/*` и `frontend/` в свой репозиторий (frontend рядом с backend или как у тебя на Railway).
2. Env: `DATABASE_URL`, `BOT_TOKEN`, `CHAT_ID`, `ADMIN_TELEGRAM_ID`, `PORT`
3. SQL: выполни `sql/v12-patch.sql`
4. `npm ci && npm run build && npm start` в backend
5. Назначь admin:
   ```sql
   UPDATE employees SET role = 'admin', access_status = 'active'
   WHERE telegram_id = <твой_id>;
   ```

## Важно

- Один процесс бота (иначе 409 Conflict)
- Уникальный constraint sales `(employee_id, store_id, sale_date)`
- schedules unique `(employee_id, work_date)`
