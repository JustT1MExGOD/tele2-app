# T2 Sales

> Учёт продаж, планов и графика для салонов **T2**
> Telegram Mini App · Bot · API · PostgreSQL

## О проекте

**T2 Sales** — замена Google-таблиц для ежедневной работы точек.

Сотрудники вносят продажи через **Telegram Mini App**, управляющие видят план/факт, график, BFQ и получают оформленные отчёты в чат.

## Возможности (v4)

### Mini App
- Главное — сводка дня, топ, быстрые действия
- План дня — карточки точек
- Планы на месяц — как лист «Общее план»
- График — месяц, цвета точек, редактор смен (manager)
- Мой план — после привязки Telegram
- BFQ — полный расчёт + VMR/штрафы
- Команда — сотрудники, роли, CRUD
- Поддержка — FAQ + тикеты админу
- История / экспорт CSV
- Светлая / тёмная тема

### Цвета точек
| Точка | Цвет |
|-------|------|
| Космонавтов 20А | `#6d9eeb` |
| Калинина 2 | `#ff6d01` |
| Калинина 11 | `#ffd966` |

### Бот
- HTML-сообщения в личке
- Уникальные уведомления о продажах
- Микро- и итоговые отчёты
- Напоминание о смене завтра (20:00 МСК)

### Роли
| Роль | Права |
|------|--------|
| employee | продажи, свой план, просмотр |
| manager | график, BFQ, CRUD, экспорт, планы |
| admin | как manager |

## Структура

```
tele2-app/
├── backend/src/
│   ├── index.ts
│   ├── routes-v3.ts
│   ├── routes-v4.ts
│   ├── middleware-auth.ts
│   ├── bot-messages.ts
│   ├── bot/index.ts
│   ├── cron/reports.ts
│   ├── services/bfq.ts
│   ├── db/index.ts
│   └── utils/date.ts
├── frontend/index.html
└── README.md
```

## Быстрый старт

1. SQL: выполнить `schema-v4.sql`, назначить manager
2. Backend: `npm install && npm run dev`
3. В index.ts: `await registerV3Routes(app); await registerV4Routes(app);`
4. Env: DATABASE_URL, BOT_TOKEN, CHAT_ID, WEBAPP_URL, ADMIN_CHAT_ID
5. Frontend: положить обновлённый index.html

## API v4 (дополнение)

| Метод | Путь | Кто |
|-------|------|-----|
| GET | /plans/monthly | все |
| PUT | /plans/monthly/:storeId | manager |
| POST/PATCH/DELETE | /employees | manager |
| POST/PATCH/DELETE | /stores | manager |
| GET | /support/faq | все |
| POST | /support | все |
| GET | /support/tickets | manager |

Заголовок: `X-Telegram-Id`

## Деплой Railway

- Root Directory = backend
- Start = npm start
- Не фиксировать порт 3000
- Frontend в образе

## Лицензия

Private · внутренний инструмент команды T2.
