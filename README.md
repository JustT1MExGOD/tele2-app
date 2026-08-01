# 🍉 T2 Sales

<p align="center">
  <b>Продажи · План · График · BFQ</b><br>
  <sub>Telegram Mini App для салонов T2</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Telegram-Mini%20App-2AABEE?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="Postgres" />
  <img src="https://img.shields.io/badge/Railway-Deployed-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" alt="Railway" />
</p>

---

## Зачем это

Раньше всё крутилось в **Google Таблицах + Apps Script**: продажи, планы, график, BFQ, отчёты в Telegram. Работало, но было тяжело масштабировать, неудобно с телефона и без нормальных ролей.

**T2 Sales** — полная замена:

| Было | Стало |
|------|--------|
| Google Sheets | PostgreSQL |
| Apps Script | Node.js + Fastify |
| Корявый UI таблицы | Telegram Mini App |
| Однотипные сообщения | HTML-карточки, уникальные уведомления |
| Все как админы | employee / manager / admin |
| Ручной план точек | Месячные планы сотрудников → дневные → точки 50/30/20 |

Сотрудник открывает бота → Mini App → вносит продажу за 5 секунд.  
Управляющий видит план/факт, график, BFQ и правит планы с телефона.

---

## Возможности

### Mini App
- **Главное** — сводка дня, быстрые действия
- **План дня** — карточки по точкам
- **Планы на месяц** — таблица по сотрудникам (факт / план / %, как Excel)
- **График** — календарь на месяц, цвета точек, редактор смен
- **Мой план** — после привязки Telegram
- **BFQ** — полный расчёт + VMR / штрафы
- **Команда** — сотрудники, роли, CRUD
- **Поддержка** — FAQ + тикеты в личку админу
- **История и экспорт CSV**
- Светлая / тёмная тема

### Цвета точек в графике
| Точка | Цвет | Доля дневного плана |
|-------|------|---------------------|
| Космонавтов 20А | `#6d9eeb` | **50%** |
| Калинина 11 | `#ffd966` | **30%** |
| Калинина 2 | `#ff6d01` | **20%** |

### Бот
- Красивые HTML-сообщения в личке
- Уникальные уведомления о продажах в рабочий чат
- Микро-отчёты и итоговые отчёты с прогресс-барами
- Напоминание о смене завтра (20:00 МСК)
- Тикеты поддержки → **личные сообщения** админу

### Роли
| Роль | Права |
|------|--------|
| `employee` | продажи, свой план, просмотр |
| `manager` | график, BFQ, CRUD, экспорт, месячные планы |
| `admin` | как manager |

---

## Архитектура

```text
┌─────────────────┐     HTTPS      ┌──────────────────┐      SQL      ┌────────────┐
│ Telegram Mini   │ ──────────────►│  Fastify API     │ ────────────►│ PostgreSQL │
│ App (frontend)  │                │  + static UI     │              └────────────┘
└─────────────────┘                │                  │
                                   │  grammy bot      │────► Telegram API
                                   │  node-cron       │       (чат + личка)
                                   └──────────────────┘
```

**Стек**
- **Frontend:** vanilla HTML/CSS/JS, Telegram WebApp API
- **Backend:** Node.js, TypeScript, Fastify, grammy
- **DB:** PostgreSQL
- **Деплой:** Railway
- **Время:** Europe/Moscow

---

## Логика планов (v5)

```text
1. Manager задаёт МЕСЯЧНЫЙ план на сотрудника
   (SIM, MNP, ПА, Combo, телефоны, …)

2. Дневной план сотрудника =
   остаток месячного плана / оставшиеся смены

3. Пул на день =
   сумма остатков всех сотрудников / оставшиеся дни месяца

4. Разнос на точки:
   Космонавтов 20А  → 50%
   Калинина 11      → 30%
   Калинина 2       → 20%
```

Таблица «Планы на месяц» показывает **факт за месяц** по каждому человеку с цветом выполнения.

---

## Структура репозитория

```text
tele2-app/
├── backend/
│   ├── src/
│   │   ├── index.ts              # точка входа, базовые роуты
│   │   ├── routes-v3.ts          # /me, BFQ, bulk schedule, history, export
│   │   ├── routes-v4.ts          # CRUD employees/stores, support, FAQ
│   │   ├── routes-plans-v5.ts    # месячные планы сотрудников, дневные точки
│   │   ├── middleware-auth.ts    # X-Telegram-Id → роль
│   │   ├── bot-messages.ts       # HTML-тексты бота
│   │   ├── bot/index.ts          # grammy: команды, notifyChat, notifyAdmin
│   │   ├── cron/reports.ts       # микро/итог + напоминания смен
│   │   ├── services/
│   │   │   ├── bfq.ts
│   │   │   └── plans.ts
│   │   ├── db/index.ts
│   │   └── utils/date.ts         # todayMoscow, etc.
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html                # Mini App
└── README.md
```

---

## Быстрый старт

### 1. Клонировать и зависимости

```bash
git clone https://github.com/<you>/tele2-app.git
cd tele2-app/backend
npm install
```

### 2. Переменные окружения

Создай `.env` (или Variables в Railway):

```env
DATABASE_URL=postgresql://user:pass@host:5432/railway
BOT_TOKEN=123456:ABC...
CHAT_ID=-100...
ADMIN_TELEGRAM_ID=1123320611
WEBAPP_URL=https://tele2-app-production.up.railway.app
PORT=3000
```

| Переменная | Зачем |
|------------|--------|
| `DATABASE_URL` | Postgres |
| `BOT_TOKEN` | токен от @BotFather |
| `CHAT_ID` | рабочий чат (продажи + отчёты) |
| `ADMIN_TELEGRAM_ID` | личка для тикетов поддержки |
| `WEBAPP_URL` | URL Mini App для кнопки в боте |

### 3. База

Выполни миграции по порядку (если ещё не накатывал):

- роли, `sales_audit`
- `bfq_manual`, `bfq_questionnaires`
- `support_tickets`, `support_faq`, `stores.color`
- `employee_month_plans`, `stores.plan_share`

Назначь управляющего:

```sql
UPDATE employees SET role = 'manager' WHERE id = 1;
```

### 4. Локальный запуск

```bash
cd backend
npm run dev
# или
npm run build && npm start
```

Открой `http://localhost:3000` — должен открыться Mini App UI.  
API: `http://localhost:3000/health`

### 5. Бот

1. @BotFather → `/newbot` или взять существующий
2. **Bot Settings → Menu Button** → URL = `WEBAPP_URL`
3. Напиши боту `/start` с аккаунта админа (чтобы личка работала)

---

## Деплой на Railway

1. New Project → Deploy from GitHub
2. **Root Directory** = `backend`
3. **Start Command** = `npm start` (или из `package.json`)
4. Подключи **PostgreSQL** plugin → `DATABASE_URL` подтянется
5. Добавь Variables: `BOT_TOKEN`, `CHAT_ID`, `ADMIN_TELEGRAM_ID`, `WEBAPP_URL`
6. Убедись, что фронт попадает в образ (`frontend/` рядом или копируется в build)
7. Не фиксируй порт `3000` вручную — слушай `process.env.PORT` на `0.0.0.0`

После деплоя:

```text
https://<your-app>.up.railway.app/health
```

---

## API (обзор)

Базовый URL: `https://<host>`

Авторизация manager-методов: заголовок

```http
X-Telegram-Id: <telegram_user_id>
```

### Основные

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/health` | статус + сегодня (МСК) |
| `GET` | `/stores` | точки |
| `GET` | `/employees` | активные сотрудники |
| `GET` | `/sales?date=` | продажи за день |
| `POST` | `/sales` | добавить продажу (partial upsert) |
| `GET` | `/schedules?date=` | график на день |
| `GET` | `/schedules/month?month=` | график на месяц |
| `POST` | `/schedules/bulk` | bulk смен (manager) |
| `GET` | `/stats/daily` | сводка по точкам |
| `GET` | `/me` | кто я (по Telegram) |
| `POST` | `/me/bind` | привязка Telegram → сотрудник |

### BFQ

| Метод | Путь |
|-------|------|
| `GET` | `/bfq?month=` |
| `GET` | `/bfq/:employeeId` |
| `POST` | `/bfq/manual` |

### Планы v5

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/plans/employees/month?month=` | таблица факт/план/% |
| `PUT` | `/plans/employees/:id/month` | месячный план сотрудника |
| `GET` | `/plans/employees/:id/daily` | дневной план сотрудника |
| `GET` | `/plans/stores/daily` | дневные планы точек 50/30/20 |
| `POST` | `/plans/stores/daily/materialize` | записать дневные планы в БД |

### CRUD / поддержка

| Метод | Путь |
|-------|------|
| `POST/PATCH/DELETE` | `/employees`, `/employees/:id` |
| `POST/PATCH/DELETE` | `/stores`, `/stores/:id` |
| `GET` | `/support/faq` |
| `POST` | `/support` |
| `GET` | `/support/tickets` |
| `GET` | `/export/sales.csv`, `/export/bfq.csv`, `/export/schedules.csv` |

---

## Сценарии использования

### Сотрудник
1. Открывает бота → Mini App
2. **Мой** → привязывает себя
3. **+** → продажа (точка из графика подставится)
4. Смотрит свой план и BFQ

### Управляющий
1. Привязан с ролью `manager`
2. **График** → тап по дню → ставит смену
3. **Планы на месяц** → тап по ФИО → задаёт месячный план
4. Смотрит дневные планы точек
5. **Команда** → добавляет сотрудников / точки, экспорт CSV
6. Тикеты поддержки приходят в личку

### Бот в чате
- Каждая продажа → красивое уведомление
- По расписанию → микро-отчёты
- В конце дня → итоговый отчёт
- В 20:00 → «завтра смена» тем, у кого есть график

---

## Troubleshooting

| Проблема | Что проверить |
|----------|----------------|
| Mini App пустой / скелетоны | `/employees`, `/stores` — если таймаут, смотри Postgres |
| `already declared for route` | дубль `registerV3Routes` / роута `/me` |
| `relation does not exist` | не накатили SQL |
| Build `Cannot find module` | файл не в `src/` или неверный import path |
| Бот молчит | `BOT_TOKEN`, webhook/polling, `/start` |
| Тикет не в личку | `ADMIN_TELEGRAM_ID`, админ написал боту `/start` |
| Неверный день | всё на `Europe/Moscow` через `todayMoscow()` |

---

## Roadmap

- [x] Продажи, план дня, график, BFQ
- [x] Роли, история, экспорт
- [x] Цвета точек, T2-брендинг
- [x] Месячные планы сотрудников → дневные → точки
- [x] Поддержка + FAQ → личка админу
- [x] CRUD сотрудников и точек
- [x] Красивые отчёты и напоминания смен
- [ ] Ответ на тикет из Mini App → push сотруднику
- [ ] Редактор FAQ из приложения
- [ ] Дашборд за произвольный период

---

## Лицензия

Private · внутренний инструмент команды T2.

---

<p align="center">
  <b>T2 Sales</b><br>
  <sub>Сделано, чтобы таблица больше не была рабочим местом</sub>
</p>
