# 🍉 Tele2 Sales

> Система учёта продаж, планов и графика для торговых точек Tele2  
> Telegram Mini App + Bot + API + PostgreSQL

[![Railway](https://img.shields.io/badge/Deploy-Railway-0B0D0E?style=flat-square&logo=railway)](https://railway.app)
[![Telegram](https://img.shields.io/badge/Mini%20App-Telegram-2AABEE?style=flat-square&logo=telegram)](https://telegram.org)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)

---

## О проекте

**Tele2 Sales** — замена Google-таблиц для ежедневной работы салонов связи.

Сотрудники вносят продажи через **Telegram Mini App**, руководители видят план/факт по точкам, график смен и получают автоматические отчёты в чат.

| Было | Стало |
|------|--------|
| Google Sheets + Apps Script | PostgreSQL + Node.js + Mini App |
| Ручные правки в ячейках | Кнопки и формы в Telegram |
| Один монолитный скрипт | Модульный backend + API |
| UTC-сюрпризы | Дата и время по **Москве** |

---

## Возможности

### Mini App
- **Главное** — сводка продаж за день, топ сотрудников, быстрые действия
- **План дня** — карточки точек: GI / товарка / Ростелеком / кредиты (план · факт · %)
- **График** — месяц по всем сотрудникам + кто на смене сегодня
- **Мой план** — личный прогресс после привязки Telegram → сотрудник
- **Команда** — список сотрудников и продажи
- **BFQ** — рейтинг за месяц
- **Умный ввод продажи** — точка подставляется из графика
- **Светлая / тёмная тема**
- Pull-to-refresh, скелетоны, пустые состояния

### Telegram-бот
- `/start` — открыть Mini App  
- `/stores` `/employees` `/schedule` `/sales`  
- Уведомления о продажах в рабочий чат  
- Микро- и итоговые отчёты по расписанию точек  

### API
REST для магазинов, сотрудников, продаж, графика, планов, статистики и BFQ.

---

## Стек

```
Telegram Mini App  ──►  Fastify API  ──►  PostgreSQL
        │                    │
        │                    ├── grammy (бот)
        │                    └── node-cron (отчёты)
        ▼
   HTML / CSS / JS
```

| Слой | Технологии |
|------|------------|
| Frontend | Telegram WebApp JS, vanilla HTML/CSS/JS |
| Backend | Node.js, Fastify, TypeScript, grammy |
| DB | PostgreSQL |
| Deploy | Railway |
| Timezone | `Europe/Moscow` |

---

## Структура репозитория

```text
tele2-app/
├── backend/
│   ├── src/
│   │   ├── index.ts          # API + static + bootstrap
│   │   ├── db/index.ts       # PostgreSQL pool
│   │   ├── bot/index.ts      # Telegram bot
│   │   ├── cron/reports.ts   # Микро / итоговые отчёты
│   │   ├── services/bfq.ts   # Расчёт BFQ
│   │   └── utils/date.ts     # todayMoscow / nowTimeMoscow
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html            # Mini App UI v2
└── README.md
```

---

## Быстрый старт (локально)

### 1. База

Создай БД `tele2` и выполни схему (таблицы `stores`, `store_plans`, `employees`, `schedules`, `sales`, …).

### 2. Backend

```bash
cd backend
cp .env.example .env   # заполни переменные
npm install
npm run dev
```

Сервер: `http://localhost:3000`

### 3. Проверка

```text
GET /health
GET /stores
GET /plans
GET /employees
```

---

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `DATABASE_URL` | Строка подключения PostgreSQL |
| `BOT_TOKEN` | Токен бота от @BotFather |
| `CHAT_ID` | ID чата для отчётов и уведомлений |
| `WEBAPP_URL` | Публичный URL Mini App (https://…) |
| `PORT` | Порт (на Railway задаётся автоматически) |

Пример `.env`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/tele2
BOT_TOKEN=123456:ABC...
CHAT_ID=-1002331320182
WEBAPP_URL=https://tele2-app-production.up.railway.app
```

---

## Деплой на Railway

1. Репозиторий подключён к Railway  
2. **Root Directory** → `backend`  
3. **Start Command** → `npm start` (или `npx tsx src/index.ts`)  
4. Variables: `DATABASE_URL`, `BOT_TOKEN`, `CHAT_ID`, `WEBAPP_URL`  
5. Папка `frontend` должна попадать в образ (рядом с `backend` или внутри него)  
6. Networking: **не** фиксируй порт `3000` вручную — слушай `process.env.PORT`

После деплоя:

```text
https://<your-app>.up.railway.app/health
https://<your-app>.up.railway.app/
```

В @BotFather укажи **Web App URL** на этот адрес.

---

## API (кратко)

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/health` | Статус |
| `GET` | `/stores` | Точки |
| `GET` | `/plans` | Планы точек (шаблон) |
| `GET` | `/employees` | Сотрудники |
| `GET` | `/me` | Текущий сотрудник по `X-Telegram-Id` |
| `POST` | `/me/bind` | Привязка Telegram → сотрудник |
| `GET` | `/sales?date=` | Продажи за день |
| `POST` | `/sales` | Добавить продажу (метрики **прибавляются**) |
| `GET` | `/schedules?date=` | График на день |
| `POST` | `/schedules` | Смена |
| `GET` | `/schedules/month?month=YYYY-MM` | График за месяц |
| `GET` | `/stats/daily?date=` | Сводка по точкам |
| `GET` | `/employee/progress/:id` | План/факт сотрудника |
| `GET` | `/bfq?month=YYYY-MM` | BFQ рейтинг |

Все даты — **календарный день по Москве**.

---

## Точки (по умолчанию)

| ID | Код | Адрес | Часы |
|----|-----|-------|------|
| `kosmonavtov` | 1017607 | Космонавтов 20А | 11 |
| `kalinina2` | 888967 | Калинина 2 | 12 |
| `kalinina11` | 203068 | Калинина 11 | 13 |

Планы хранятся в `store_plans` (`plan_date IS NULL` = шаблон).

---

## Скрин / UX

Интерфейс вдохновлён внутренними приложениями Tele2:

- чёрная шапка + «pill» с датой  
- белые карточки-секции  
- строки с иконкой и шевроном  
- нижняя навигация: Главное · План · График · Мой · Команда  
- FAB «+» для быстрой продажи  

---

## Разработка

```bash
# backend
cd backend
npm run dev          # tsx, hot reload через перезапуск

# сборка
npm run build
npm start            # node dist/index.js
```

Рекомендуемый порядок фич:
1. Данные и API  
2. Mini App экраны  
3. Бот и уведомления  
4. Отчёты по cron  
5. BFQ и админка  

---

## Roadmap

- [x] Точки, сотрудники, продажи, планы  
- [x] Mini App v2 (план дня, график, тема)  
- [x] Уведомления и автоотчёты  
- [x] Привязка Telegram → сотрудник  
- [ ] Полноценный BFQ как в старой таблице  
- [ ] Редактор графика из Mini App  
- [ ] Роли (сотрудник / управляющий)  
- [ ] История и экспорт  

---

## Лицензия

Private · внутренний инструмент команды.

---

<p align="center">
  <b>Tele2 Sales</b><br>
  <sub>Сделано для салонов · работает в Telegram</sub>
</p>
