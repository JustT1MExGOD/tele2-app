# T2 Sales

**Операционная система продаж для розничной сети T2**  
Telegram Mini App · Fastify · PostgreSQL · Railway

> Не таблица с ботом — а рабочий инструмент смены: план, факт, график, касса, BFQ, live-сеть и поддержка в одном месте.

---

## Зачем это

Google Sheets и чаты не масштабируются: формулы ломаются, роли размыты, офлайна нет, «кто сейчас на точке» видно только по переписке.

**T2 Sales** даёт:

- личный кабинет продавца с дневным и месячным планом;
- внесение продаж за секунды (в том числе голосом/фразой);
- график, кассу, BFQ и отчёты без ручной сводки;
- live-снимок сети для управляющего;
- смену как сессию (открыл → работал → закрыл с самоотчётом);
- офлайн-очередь: продажа сохранится без Wi‑Fi и уйдёт при появлении сети.

---

## Стек

| Слой | Технологии |
|------|------------|
| Клиент | Telegram Mini App, один `index.html`, Design System v13 |
| API | Node.js 18+, Fastify 5, TypeScript |
| БД | PostgreSQL 16 (Railway) |
| Бот | Grammy (отчёты, напоминания, уведомления) |
| Деплой | Railway, Nixpacks, static frontend из `/frontend` |

---

## Возможности

### Для сотрудника
- Привязка Telegram → карточка сотрудника
- **Мой день:** смена, факт/план, прогресс, инсайт «на чём сфокусироваться»
- Месячный план и сравнение с собой (7 / 30 дней)
- Быстрое внесение продаж (мульти-метрики)
- **Быстрый ввод:** «две симки и одно mnp»
- Открытие / закрытие **смены-сессии** с гео и самоотчётом
- Офлайн-сохранение продаж
- Геймификация: уровень, XP, стрики, «идеальная смена»
- Обучение (интерактивный тур)
- Поддержка (тикеты + FAQ)

### Для менеджера / admin
- График на месяц (bulk), цвета точек
- Месячные планы сотрудников и дневные планы точек (50/30/20)
- BFQ, VMR, штрафы, экспорт CSV
- Касса: факт / 1С / дельта
- **Сеть live:** кто на смене, % плана, кассовый разрыв
- Умные алерты (тишина на точке, 0 MNP при SIM, касса)
- What-if по перестановке смен
- Роли, заявки на доступ, супервайзер по своим точкам
- Объявления сети с «прочитал»
- Admin: очередь поддержки, ответ в личку

### Метрики
SIM · MNP · ПА · Комбо · Телефоны · Аксессуары · Настройки · Страховки · Wink · ШПД · ФО · Кредит · Плоттер · НВ

---

## Архитектура (кратко)

```
Telegram WebApp
      │  X-Telegram-Id
      ▼
Fastify API  ──►  PostgreSQL
      │
      ├── /me, /sales, /schedules, /plans, /bfq
      ├── /shifts, /network/live, /sync/batch
      ├── /cash, /support, /access
      └── static: frontend/index.html
      │
Grammy bot  ──►  чаты отчётов + личные уведомления
Cron        ──►  микро/итог отчёты, алерты, напоминания смен
```

**Часовой пояс:** Europe/Moscow (все «сегодня» и cron).

---

## Структура репозитория

```
tele2-app/
├── backend/                 ← Root Directory на Railway
│   ├── package.json
│   ├── tsconfig.json
│   ├── railway.json
│   ├── src/
│   │   ├── index.ts         # точка входа, health, sales, cash, register*
│   │   ├── routes-v3.ts     # /me, BFQ, bulk schedule, export
│   │   ├── routes-plans-v5.ts
│   │   ├── routes-v8.ts     # access gate, supervisor
│   │   ├── routes-support.ts
│   │   ├── routes-v13.ts    # смены, NLP, offline, live, insights
│   │   ├── middleware-auth.ts
│   │   ├── services/        # plans, bfq, nlp, insights, alerts, …
│   │   ├── bot/
│   │   ├── cron/
│   │   ├── db/
│   │   └── utils/date.ts
│   └── frontend/
│       ├── index.html       # Mini App UI v13
│       └── offline-queue.js # IndexedDB → /sync/batch
├── docs/
│   └── INTEGRATION-V13.md
└── README.md
```

---

## Быстрый старт

### 1. Переменные окружения (Railway)

| Variable | Описание |
|----------|----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BOT_TOKEN` | токен бота от @BotFather |
| `ADMIN_TELEGRAM_ID` | ваш TG id (алерты / поддержка) |
| `REPORT_CHAT_ID` | чат микро/итог отчётов (опционально) |
| `PORT` | задаёт Railway |
| `BOT_POLLING` | `false` — отключить polling при конфликте 409 |

### 2. База

Накатить миграции/схемы (v7 cash, v8 access, **v13** sessions/alerts/offline и т.д.) через Query в Railway или `psql`:

```bash
psql "$DATABASE_URL" -f sql/v13-schema.sql
```

### 3. Локально

```bash
cd backend
npm ci
npm run build
npm start
# http://localhost:3000  (или PORT)
```

### 4. Деплой

- GitHub → Railway
- **Root Directory:** `backend`
- Build: `npm ci && npm run build`
- Start: `npm start`
- Healthcheck: `/health`

В логах ожидайте:

```text
✅ Plans routes registered
✅ Access (v8) routes registered
✅ Support routes registered
✅ V13 routes registered
🚀 Сервер на 0.0.0.0:…
```

### 5. Mini App

1. @BotFather → Bot Settings → Menu Button → URL  
   `https://<your-app>.up.railway.app/`
2. Открыть из Telegram, привязать сотрудника во вкладке **Мой**

---

## Ключевые API

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/health` | статус + дата МСК |
| GET | `/me` | профиль / bound |
| GET | `/me/day` | смена + daily_plan + progress |
| POST | `/sales` | продажа |
| POST | `/sales/quick` | NLP-фраза → продажа |
| POST | `/shifts/open` · `/close` | сессия смены |
| GET | `/network/live` | live-карта сети |
| POST | `/sync/batch` | офлайн-синк |
| GET | `/plans/employees/month` | месячная сводка |
| GET | `/plans/stores/daily` | дневные планы точек |
| GET | `/bfq` | рейтинг BFQ |
| GET | `/cash/table` | касса |
| GET | `/dashboard` | топ за 7 дней |
| GET | `/export/bi/daily` | JSON «источник истины» |

Заголовок авторизации Mini App: **`X-Telegram-Id`**.

---

## Роли

| Роль | Права |
|------|--------|
| `employee` | свои продажи, свой план, просмотр |
| `manager` | график, чужие продажи, планы, BFQ manual, касса, алерты |
| `admin` | всё manager + поддержка, роли |
| `supervisor` | срез по назначенным точкам |

---

## Версии (логика продукта)

| Версия | Фокус |
|--------|--------|
| v1–2 | Google Sheets + Apps Script |
| v3–5 | Mini App, планы, BFQ, график |
| v8 | Access gate, supervisor |
| v12 | Стабилизация ЛК, касса, multi-metric |
| **v13** | Смены-сессии, NLP, offline, live, insights, gamification, smart alerts |

---

## Разработка

```bash
cd backend
npm run dev          # tsx watch (если настроен)
npm run build        # tsc → dist/
```

**Правила:**

- даты — через `todayMoscow()` / `Europe/Moscow`;
- не дублировать маршруты `/me` вне `routes-v3`;
- новые фичи — отдельный `routes-vN` + `register*` в `index.ts`;
- не коммитить `.env` и секреты.

---

## Известные ограничения

- Точный heatmap по часам продаж — после поля `sale_hour` в `sales`.
- Один bot token = один polling (иначе Telegram 409).
- WebView Telegram кэширует `index.html` — после деплоя UI переоткрыть Mini App.
- What-if и прогноз — эвристики, не ML.

---

## Лицензия и контакты

Внутренний продукт сети.  
Поддержка в приложении → тикеты admin · или напрямую владельцу бота.

---

**T2 Sales** — смена, цифры и сеть в одном касании.
**v13.0**
