# T2 Sales

### Операционная система розничных продаж сети T2  
**Telegram Mini App · Fastify · PostgreSQL · Grammy · Railway**

![version](https://img.shields.io/badge/version-19.21.0-2AABEE?style=flat-square)
![ci](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white)
![node](https://img.shields.io/badge/node-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify&logoColor=white)
![postgres](https://img.shields.io/badge/PostgreSQL-Railway-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![ai](https://img.shields.io/badge/AI%20Copilot-Groq%20%C2%B7%20free-34B37E?style=flat-square)
![status](https://img.shields.io/badge/status-в%20проде%20%C2%B7%202%20сети%20%C2%B7%207%20точек-success?style=flat-square)

> Не «таблица + бот в чате».  
> Единая рабочая среда смены: план, факт, график, касса, BFQ, live-сеть, обучение, роли, отчёты и AI Copilot — в одном касании.

**Актуальная версия клиента:** `19.21.0`  
**Часовой пояс истины:** `Europe/Moscow`

---

## Оглавление

1. [Зачем это существует](#1-зачем-это-существует)
2. [Кому и что даёт](#2-кому-и-что-даёт)
3. [Стек и инфраструктура](#3-стек-и-инфраструктура)
4. [Архитектура](#4-архитектура)
5. [Структура репозитория](#5-структура-репозитория)
6. [Модель данных](#6-модель-данных)
7. [Роли и доступ](#7-роли-и-доступ)
8. [Функциональность по модулям](#8-функциональность-по-модулям)
9. [Метрики продаж](#9-метрики-продаж)
10. [Планирование](#10-планирование)
11. [Касса](#11-касса)
12. [Telegram-бот и отчёты](#12-telegram-бот-и-отчёты)
13. [Обучение](#13-обучение)
14. [HTTP API](#14-http-api)
15. [Переменные окружения](#15-переменные-окружения)
16. [Локальный запуск](#16-локальный-запуск)
17. [Деплой на Railway](#17-деплой-на-railway)
18. [Миграции SQL](#18-миграции-sql)
19. [Mini App в BotFather](#19-mini-app-в-botfather)
20. [Типовые сбои](#20-типовые-сбои)
21. [История версий](#21-история-версий)
22. [Дорожная карта](#22-дорожная-карта)
23. [Соглашения по разработке](#23-соглашения-по-разработке)
24. [Безопасность](#24-безопасность)
25. [Чеклист запуска с нуля](#25-чеклист-запуска-с-нуля)

---

## 1. Зачем это существует

Google Sheets + переписка в Telegram живут на одной точке и трёх людях. На сети точек:

| Боль | Почему Sheets не тянет |
|------|------------------------|
| Разные «истины» | копии файла, формулы, ручной ввод |
| Нет ролей | все правят всё или не видят ничего |
| Нет офлайна | продажа потерялась без Wi‑Fi |
| Нет сессии смены | непонятно, кто реально на точке |
| Отчёты вручную | копипаста, ошибки, задержки |
| Онбординг | «почитай чат за месяц» |

**T2 Sales** — источник истины: сотрудник работает в Mini App, бот уведомляет, PostgreSQL хранит факт, Railway держит API.

---

## 2. Кому и что даёт

### Сотрудник (`employee`, `trainee`, `senior`)
- Профиль: смена, дневной/месячный план, BFQ, геймификация (XP/уровень/стрик), история смен
- Продажи только за себя, мульти-метрики, дельты
- Быстрый ввод текстом: «две симки и одно mnp» (NLP-разбор)
- Смена-сессия: open/close + гео + план/факт живьём, пока смена открыта, заметка-передача следующему на этой точке
- Свои задачи (назначает manager) — принять в работу / закрыть
- График, план точек (дневной план — теперь считается от месячного плана точки, не от долей сотрудников), промокоды РТК, калькуляторы (комбо/школа)
- Кастомная аватарка (видна и в «Команде»)
- Офлайн-очередь продаж (без сети — уходит при появлении Wi‑Fi)
- Обязательное обучение с персонажем-маскотом (без skip в первый раз)
- Поддержка / FAQ

### Управляющий (`manager`, `senior` — операционно то же самое)
- Всё сотрудника +
- **Command Center** — единый экран «что происходит / где проблема / что делать» вместо трёх разрозненных мест
- **Задачи** — создать/назначить с контекстом прямо из просадки или алерта, тред комментариев
- **Профиль точки** / **Профиль сотрудника** — план/факт/прогноз/тренд/Health Score на одном экране
- **Алерты 2.0** — полный жизненный цикл (open→in_progress→acked/dismissed), включая аномалии (z-score против прогноза, не только план)
- График (bulk, сводная таблица месяца по всей команде), месячные планы сотрудников и точек, кастомные названия точек
- Чужие продажи и дельты, касса, BFQ, заявки на доступ, CSV-экспорты
- Live-карта сети
- Отдельный курс обучения manager

### Admin
- Всё manager + тикеты поддержки (эскалация к разработчику), назначение ролей (только строго ниже своей), переключатель сети в UI, кабинет супервайзера в режиме просмотра, заведение новых сетей без SQL

### Supervisor
- Свой сектор целиком (несколько сетей сразу) — отдельный визуал, 4 своих вкладки (Обзор/Точки/Люди/Тренд), выполнение и прогноз месячного плана по сектору

### Сеть
- Единые микро/итог отчёты в чат (расписание — по точке, не глобальное), автоанонс версий в отдельный Telegram-канал
- Еженедельная/месячная сводка по сети (страница «Отчёты»), экспорт / BI
- Новые сети и точки без единой строчки SQL — через UI

---

## 3. Стек и инфраструктура

| Слой | Технология | Зачем |
|------|------------|-------|
| Клиент | Telegram WebApp, `index.html` | UI, offline-queue, tutorial |
| API | Node.js 18+, Fastify 5, TypeScript | REST + static |
| БД | PostgreSQL (Railway) | источник истины |
| Бот | Grammy | отчёты, напоминания, notify |
| Cron | setInterval, логика МСК | микро/итог, алерты |
| AI | Groq API (`llama-3.3-70b-versatile`) | итог смены + гипотеза при просадке — бесплатно, без vendor lock-in |
| Хостинг | Railway / Nixpacks | API + фронт |

Клиент **не** ходит в БД: Mini App → подписанная `X-Telegram-Init-Data` → API → Postgres.

---

## 4. Архитектура

```mermaid
flowchart TB
    subgraph TG["Telegram"]
        MA["Mini App<br/>(frontend/*)"]
        CH["Bot chats"]
    end

    subgraph BE["Fastify backend (backend/src)"]
        AUTH["middleware-auth.ts<br/>authPlugin (preHandler) · initData HMAC"]
        ROUTES["27 routes-*.ts<br/>core/employees/sales/schedules/stats/cash/<br/>command-center/tasks/store-profile/employee-profile/<br/>forecast/live-alerts/avatar/…"]
        SVC["services/<br/>plans · bfq · sales-write · shift-pace ·<br/>gamification · live-map · alerts · anomaly ·<br/>forecast · supervisor-analytics · ai.ts"]
        CRON["cron/<br/>reports.ts · digest.ts"]
        BOT["bot/ (Grammy)"]
    end

    PG[("PostgreSQL<br/>(Railway)")]
    GROQ["Groq API<br/>llama-3.3-70b-versatile"]

    MA -- "X-Telegram-Init-Data<br/>(подписанный, прод)" --> AUTH
    AUTH --> ROUTES --> SVC
    CRON --> SVC
    SVC --> PG
    SVC -- "shift summary /<br/>dip hypothesis" --> GROQ
    BOT <--> CH
    ROUTES --> BOT
    CRON --> BOT
```

Клиент **не** ходит в БД напрямую — только через API. «Сегодня» всегда через `todayMoscow()` (`Europe/Moscow`), не UTC контейнера. AI Copilot (`services/ai.ts`) не в горячем пути запросов — вызывается только при закрытии смены, в cron итоговых отчётов и при открытии страницы «Прогноз» (кэшируется на день), no-op без `GROQ_API_KEY`. Рендер SVG→PNG-картинок (отчёты, карточка анонса версии) — в отдельном пуле `worker_threads`, не блокирует основной event loop.

---

## 5. Структура репозитория

```text
tele2-app/
├── README.md
├── docs/INTEGRATION-V13.md
├── sql/                      (исторические ручные SQL-снимки, не источник схемы — см. §18)
└── backend/                 ← Root Directory на Railway
    ├── package.json
    ├── tsconfig.json
    ├── railway.json
    ├── migrations/              (пронумерованные .sql, применяются сами — см. §18; 0001_baseline.sql … 0011_stores_id_primary_key.sql)
    ├── assets/fonts/            (DejaVu Sans — рендер SVG-отчётов; Google Sans TTF — та же resvg-карточка анонса)
    ├── tests/
    │   ├── setup.ts             (жёсткая проверка: DATABASE_URL только localhost/127.0.0.1)
    │   ├── helpers/              (app.ts → buildApp()+inject(), fixtures.ts → TestFixtures)
    │   ├── unit/                 (чистые функции: forecast-модель, sales-write, caption-builder…)
    │   ├── isolation/            (auth/multi-tenant регресс — org-scoping, race conditions, идемпотентность)
    │   └── adversarial/          (security-регресс: auth bypass, unauth disclosure, cross-tenant IDOR, identity spoofing — 19.11.0)
    ├── src/
    │   ├── index.ts                    (bootstrap: миграции → buildApp() → listen → бот/крон)
    │   ├── app.ts                      (Fastify instance, cors: origin:false, helmet/rate-limit, static, регистрация routeModules)
    │   ├── env.ts                      (dotenv, импортируется первым — гарантирует порядок)
    │   ├── middleware-auth.ts          (authPlugin — глобальный preHandler, requireAuth/requireActive/requireManager/…, assertStoreInOrg/assertEmployeeInOrg, ROLE_LEVEL)
    │   ├── changelog.ts                (список версий для автоанонса — только minor-эпики, не хотфиксы)
    │   ├── db/                         (пул соединений, миграционный раннер)
    │   ├── services/telegram-auth.ts   (проверка initData HMAC)
    │   ├── routes-core.ts              (/stores, /plans — org-scoped)
    │   ├── routes-employees.ts         (CRUD сотрудников/точек, кастомные названия точек)
    │   ├── routes-avatar.ts            (загрузка/раздача кастомной аватарки, bytea в Postgres)
    │   ├── routes-sales.ts             (/sales)
    │   ├── routes-schedules.ts         (/schedules, /schedules/bulk)
    │   ├── routes-stats.ts             (/stats, /dashboard)
    │   ├── routes-cash.ts              (/cash)
    │   ├── routes-promos.ts            (промокоды RTK)
    │   ├── routes-reports.ts           (SVG-отчёты по точке, страница «Отчёты»)
    │   ├── routes-me.ts                (/me, /me/bind, /me/day)
    │   ├── routes-bfq.ts               (/bfq: расчёт, ручной VMR/штраф, анкета)
    │   ├── routes-export.ts            (история продаж, аудит, CSV-экспорты)
    │   ├── routes-plans-v5.ts          (месячные/дневные планы сотрудников и точек, сводная таблица)
    │   ├── routes-v8.ts                (заявки на доступ, назначение роли, кабинет супервайзера-доступа)
    │   ├── routes-support.ts
    │   ├── routes-shifts.ts            (/shifts/*, NLP-разбор продажи, офлайн-очередь /sync/batch)
    │   ├── routes-insights.ts          (личная аналитика: /me/insight, /me/self-stats)
    │   ├── routes-live-alerts.ts       (живая карта, умные алерты, what-if)
    │   ├── routes-comms.ts             (объявления сети, каналы)
    │   ├── routes-forecast.ts          (прогноз, heatmap, когорты, BI-экспорт)
    │   ├── routes-v14.ts               (branding, org/stores)
    │   ├── routes-metrics.ts
    │   ├── routes-supervisor.ts        (кабинет супервайзера)
    │   ├── routes-command-center.ts    (единый экран manager/supervisor/admin)
    │   ├── routes-tasks.ts             (задачи из просадки/алерта)
    │   ├── routes-store-profile.ts     (Store Intelligence, Health Score)
    │   ├── routes-employee-profile.ts  (Employee 2.0, Health Score)
    │   ├── services/   (plans, bfq, nlp(sales-nlp), sales-write, shift-pace, insights, gamification,
    │   │                live-map, alerts, anomaly, forecast, metrics-catalog, heatmap, network-digest,
    │   │                supervisor-analytics, report-image, svg-render-pool, tenant, release-announce,
    │   │                what-if, ai.ts ← AI Copilot)
    │   ├── workers/svg-render.worker.ts (resvg SVG→PNG в отдельном потоке — см. §12)
    │   ├── bot/        (index.ts, messages.ts)
    │   ├── cron/       (reports.ts, digest.ts)
    │   └── utils/date.ts
    └── frontend/
        ├── index.html   (разметка + подключение styles.css и js/*.js по порядку)
        ├── styles.css
        ├── fonts/       (Google Sans WOFF2 — фронтовый шрифт, отдельно от assets/fonts/ TTF для resvg)
        ├── js/          (01-core → 19-reports, 21 файл, классические <script>, общая глобальная область — порядок подключения важен)
        └── offline-queue.js
```

---

## 6. Модель данных

| Таблица | Смысл |
|--------|--------|
| `organizations` | сеть точек — branding, `sector_id`, `chat_id`/`sales_thread_id`/`reports_thread_id` |
| `sectors` | группа сетей, назначается супервайзеру целиком |
| `stores` | точки: code, color, `org_id`, `display_name` (кастомное название, 19.7.0), micro-report расписание |
| `employees` | FIO, telegram_id (UNIQUE), role, access_status, org_id, avatar_data/avatar_mime (19.7.0) |
| `schedules` | смена на день (UNIQUE employee+date) |
| `sales` | факт метрик (аддитивная запись, единая точка входа — `applySaleUpsert()`) |
| `sales_audit` | аудит правок метрик (кто/когда/сколько) |
| `sales_events` | сырые события продаж — источник точного heatmap по часу |
| `employee_month_plans` | месячный план человека |
| `store_month_plans` | месячный план точки — независимый ручной ввод (не доля от планов сотрудников, с 15.13.0) |
| `store_plans` | материализованный дневной снапшот плана точки (кэш для BFQ/live/отчётов, крон 6:00 МСК) |
| `store_forecasts` | кэш прогноза (SES + сезонность по дню недели) |
| `store_cash` | факт / 1С |
| `shift_sessions` | open/close смены, handover_note, гео |
| `tasks` / `task_comments` | задачи из просадки/алерта, тред комментариев |
| `smart_alerts` | Alerts 2.0 — полный жизненный цикл, включая `anomaly_vs_forecast` |
| `rtk_promocodes` | пул промокодов, org-scoped |
| `announcements` / `announcement_reads` | объявления сети + кто прочитал |
| `channels` / `channel_messages` | внутренние каналы сети |
| `access_requests` | заявки на доступ (org-scoped по выбору при регистрации) |
| `support_*` | тикеты, FAQ, вложения, шаблоны (эскалация к разработчику, admin-only) |
| `offline_sync_log` | идемпотентность офлайн-очереди по `client_id` |
| `cron_send_log` | claim-защита от повторной отправки авто-отчётов/напоминаний |
| `ai_audit` | лог AI Copilot: kind (`shift_summary`/`dip_comment`/`forecast_summary`), employee/store, prompt, response, model |
| `app_settings` | служебные ключ-значение (напр. `last_announced_version`) |

Критичные UNIQUE: `schedules(employee_id, work_date)`, `store_cash(store_id, cash_date)`,
`employees.telegram_id`, upsert-ключ `sales`, partial unique на одну открытую
`shift_sessions` на сотрудника.

---

## 7. Роли и доступ

Полная лестница (с 15.9.0): `trainee < employee < senior < manager < supervisor < admin`
(`ROLE_LEVEL` в `middleware-auth.ts`). Назначить можно только роль строго
ниже своей (`canAssignRole()`) — admin без ограничений.

| role | Права |
|------|--------|
| `trainee` | стажёр — минимум прав, растёт до `employee` |
| `employee` | свои продажи, свой план, смена-сессия |
| `senior` | операционно как `manager` (сотрудники/точки/график/касса/чужие продажи/экспорты), но намеренно **без** Command Center и кабинета супервайзера — разделены «операционные права» и «видимость аналитики» |
| `manager` | всё senior + видит Command Center, Store/Employee Profile, алерты, задачи |
| `admin` | всё manager + поддержка (эскалация), назначение ролей, переключатель сети, кабинет супервайзера |
| `supervisor` | свой сектор (несколько сетей) целиком — отдельный визуал, отдельные 4 вкладки, не пересекается с обычными 5 |

| access_status | UI |
|---------------|-----|
| `none` | регистрация (пикер сети → форма заявки) |
| `pending` | ожидание одобрения |
| `rejected` / `blocked` | отказ |
| `active` | полный доступ по своей роли |

**Auth — только через подписанную Telegram initData**, не через голый
заголовок (см. §24). `X-Telegram-Id` без initData работает лишь в
локальной разработке или при явном `ALLOW_INSECURE_AUTH=true`.

Мультитенантность: `organizations` (= «сеть точек», с `sector_id`/`chat_id`/
`sales_thread_id`/`reports_thread_id`) группируются в `sectors` — их видит
целиком `supervisor` через `supervisor_sectors`. Почти все read/write роуты
скоуплены по `org_id` через `resolveViewOrgId()`/`assertStoreInOrg()`/
`assertEmployeeInOrg()`; admin может явно переключить сеть просмотра
переключателем в UI (`?org_id=`/`body.org_id`), остальные роли — только
своя сеть, с одним исключением: собственная запись (продажа/смена) видна
всегда, даже если сегодня сотрудник работает на точке чужой сети внутри
той же организации («подмена»).

Вернуть себе доступ (только для локальной отладки/восстановления —
на проде делать через миграцию или прямой SQL по read-only согласованию,
не как рутинную операцию):

```sql
UPDATE employees
SET access_status = 'active', is_active = true, role = 'admin'
WHERE telegram_id = <TG_ID>;
```

---

## 8. Функциональность по модулям

Нижняя навигация (5 вкладок): **Главная · План · График · Профиль · Команда**
(для supervisor — отдельный набор из 4: Обзор · Точки · Люди · Тренд).

- **Главная** — приветствие с живым индикатором смены (открыта/закрыта) и
  «N дн. до выходного», код/адрес своей точки в шапке, свайп-панель «Мой
  день» / «Сеть сегодня», Command Center (health-score сети + просадки с
  AI-гипотезой), калькуляторы (комбо/школа), промокоды, быстрые действия
- **Профиль** (бывш. «Мой») — смена (открыть/закрыть, живой план/факт,
  заметка-передача), дневной план по всем ненулевым метрикам, «Прогресс за
  месяц» тем же форматом, что карточка точки в «План», история своих
  продаж, кастомная аватарка, обучение
- **План** — все точки сети, карточки свёрнуты по умолчанию, план дня по
  блокам (Блок GI / Товарка / Ростелеком / Кредиты)
- **График** — месяц, календарная сетка с выравниванием по дням недели,
  сводная таблица команды с точкой на каждый день (важно при подменах),
  bulk-правка
- **Касса** — факт / 1С / Δ, внести кассу наверху, последние 2 дня сразу
  видны
- **BFQ** — рейтинг качества, план берётся из живого источника
  (`employee_month_plans`), не из фантомного нулевого шаблона
- **Command Center** (`manager`/`supervisor`/`admin`) — единый экран: что
  происходит / где проблема / что делать, кнопки действий ведут в задачи
- **Задачи** — список по сети с фильтрами, тред комментариев, авто-закрытие
  при выполнении связанного алерта
- **Алерты** (Alerts 2.0) — open → in_progress → acked/dismissed,
  `anomaly_vs_forecast` ловит и провалы, и необычные всплески (z-score)
- **Профиль точки / Профиль сотрудника** — план/факт/прогноз/тренд + Health
  Score, объяснимая композиция без выдуманных метрик
- **Отчёты** — SVG-картинка точки, CSV-экспорты, авто-сводка по сети
  (понедельник + 1-е число, 09:00 МСК)
- **Прогноз** — SES-модель + сезонность по дню недели, AI-объяснение сверху
  расчёта (Groq), «Кого куда поставить» (эвристика по нагрузке на смену)
- **Live-карта** — кто на смене, % плана, статус, по всей сети
- **Промо РТК** — скрытый список, used/keep, org-scoped
- **Поддержка** — FAQ + тикеты (эскалация к разработчику, admin)
- **Заявки на доступ** — пикер сети при регистрации, approve/reject
- **Кабинет супервайзера** — свой визуал, весь сектор, выполнение и
  прогноз месячного плана по сектору и по каждой точке

---

## 9. Метрики продаж

`sim`, `mnp`, `pa`, `combo`, `phones`, `accessories`, `settings`, `insurance`, `wink`, `shpd`, `focus`, `credit_request`, `credit_issued`, `plotter`, `hb`

**Комбо (клиент):**  
`цена×(1−скидка/100) + цена×0.28 + 1950`

**Школа (клиент):**  
`цена − цена×0.7 + цена×0.3 + 3600 + 3490`

---

## 10. Планирование

Месячный план сотрудника и месячный план точки — **два независимых
источника**, вводятся вручную (`employee_month_plans` / `store_month_plans`,
с 15.13.0 — точка больше не считается как доля от сумм планов сотрудников).

**День сотрудника:**  
`ceil((план_месяца_сотрудника − факт_сотрудника_с_начала_месяца) / max(1, оставшиеся_смены))`

**День точки:**  
`(план_месяца_точки − факт_точки_с_начала_месяца) / оставшиеся_дни_месяца`
— та же формула, что у сотрудника, только на уровне точки, без долевого
распределения.

Дневной снапшот (`store_plans`) материализуется автоматически: кроном
каждый день в 06:00 МСК и мгновенно при сохранении месячного плана точки
(`PUT /plans/stores/:id/month`) — ручной кнопки для этого в интерфейсе
больше нет, обе ситуации, ради которых её нажимали, автоматизированы
(убрана как мёртвый код в 19.3.0).

---

## 11. Касса

```text
Δ = cash_fact − (cash_1c + 2000)
```

---

## 12. Telegram-бот и отчёты

Расписание — **по точке**, не глобальная константа: `stores.micro_report_times`
(массив времён), `close_time_weekday`/`close_time_sunday` (когда слать итог),
`skip_sunday_micro_times`. У каждой сети/точки может быть своё — например,
круглосуточная точка РТТ Гуреева шлёт итог в 21:00, обычная точка — в своё
время закрытия. Уведомления идут в чат и тему (`sales_thread_id`/
`reports_thread_id`) конкретной сети, если она форум с темами.

Итог дня — альбом из 3 картинок (план дня → факт → фокус на завтра), тем же
resvg-пайплайном, что и микро-отчёты, рендер — в отдельном `worker_threads`
(не блокирует основной процесс, §17.4.0). Итог: блоки GI · Товарка ·
Ростелеком · Кредиты · Прочее.

**AI Copilot в итоговом отчёте** (`cron/reports.ts` → `generateDipComment`): если факт дня по точке < 85% от плана — в подпись к финальному кадру отчёта и в `ai_audit` уходит гипотеза от модели; если план закрыт — заготовленная фраза-похвала без вызова модели. Тот же комментарий подтягивается в Command Center через `/supervisor/health` (`drops[].ai_comment`).

Все автоматические отправки (микро/итог-отчёты, напоминания, автоанонс
версии) защищены atomic-claim паттерном (`cron_send_log`/`app_settings`,
`INSERT ... ON CONFLICT DO NOTHING`) — deploy-окно Railway (старый контейнер
живёт, пока новый не пройдёт healthcheck) не может задвоить отправку.

**409 Conflict** = два polling на одном токене → 1 реплика Railway, без локального бота, `deleteWebhook`, опционально `BOT_POLLING=false`.

---

## 13. Обучение

Персонаж-маскот «Арбузыч» 🍉 — два визуальных режима: полноэкранные
cutscene-главы (вступление/переходы/квиз/финал, с мини-праздником между
главами) и coach-оверлей поверх реального UI («нажми сюда», подсветка
конкретного элемента).

### Сотрудник
Автостарт при первом входе, 22 шага по главам. **Skip запрещён** до
`t2_tutorial_done`. Практика — тапы по nav/FAB, тесты, калькулятор, быстрый
ввод; добавление продажи тренируется на настоящей форме в dry-run режиме
(ничего не пишется в базу и в чат). Прохождение начисляет XP и бейдж через
`POST /me/tutorial-complete` — известно бэкенду, не только `localStorage`.

### Manager
Отдельный курс, 17 шагов: заявки, график, планы, касса, live, роли.

```js
localStorage.removeItem('t2_tutorial_done')       // сотрудник
localStorage.removeItem('t2_tutorial_mgr_done')   // manager
```

---

## 14. HTTP API

База: `https://<app>.up.railway.app`  
Auth: `X-Telegram-Init-Data` (подписанный, прод) — см. §24. `X-Telegram-Id`
только в деве.

| Группа | Примеры |
|--------|---------|
| System | `GET /health` |
| Me / access | `/me`, `/me/day`, `/me/bind`, `/me/insight`, `/me/self-stats`, `/access/status`, `/access/request`, `/access/orgs` |
| Avatar | `POST /me/avatar`, `GET /avatars/:employeeId` |
| Sales / shifts | `/sales`, `/sales/quick`, `/sales/:id/zero`, `/shifts/open\|close\|current`, `/sync/batch` |
| Plans / schedule | `/plans/*`, `/plans/employees/*`, `/plans/stores/*`, `/schedules`, `/schedules/month`, `/schedules/bulk` |
| BFQ / cash | `/bfq`, `/bfq/:employeeId`, `/cash/table`, `PUT /cash` |
| Stores / org | `/stores`, `/org/stores`, `POST /employees`, `POST /stores` |
| Command Center / Tasks / Alerts | `/command-center`, `/tasks`, `/tasks/:id`, `/alerts`, `/alerts/:id/ack` |
| Profiles | `/stores/:id/profile`, `/employees/:id/profile` |
| Forecast / analytics | `/forecast/:storeId`, `/heatmap/*`, `/staffing-hints`, `/cohorts/newbies`, `/network/live`, `/schedule/what-if(/apply)` |
| Reports | `/reports/day/:storeId`, `/export/bi/daily` |
| Promo / support / comms | `/promos`, `/support`, `/announcements`, `/channels/:id/messages` |
| Supervisor | `/supervisor/dashboard`, `/supervisor/health`, `PUT /supervisor/:id/sector` |
| Export | CSV: `/export/sales.csv`, `/export/bfq.csv`, `/export/schedules.csv` |

Каждый роут, отдающий чужие/сетевые данные, гейтится `requireAuth`/
`requireActive`/`requireManager`/`requireSupervisor` + org-scope — см. §7, §24.

---

## 15. Переменные окружения

| Variable | Нужно | Описание |
|----------|-------|----------|
| `DATABASE_URL` | да | Postgres |
| `BOT_TOKEN` | да | BotFather |
| `PORT` | Railway | listen port |
| `ADMIN_TELEGRAM_ID` | желательно | admin |
| `REPORT_CHAT_ID` | желательно | глобальный фолбэк-чат отчётов (по умолчанию — чат сети из `organizations.chat_id`) |
| `RELEASE_CHANNEL_ID` | нет | отдельный Telegram-канал для автоанонса версий (с 18.11.0) — без него анонс тихо пропускается |
| `BOT_POLLING` | нет | `false` отключает getUpdates |
| `ALLOW_INSECURE_AUTH` | нет | `true` включает dev-фоллбэк на голый `X-Telegram-Id` без проверки initData (**не включать в проде**) |
| `GROQ_API_KEY` | нет | ключ Groq (console.groq.com, free tier, без карты) — включает AI Copilot; без ключа обе функции no-op'ают |
| `GROQ_MODEL` | нет | override модели, дефолт `llama-3.3-70b-versatile` |

---

## 16. Локальный запуск

```bash
cd backend
npm ci
npm run build
npm start
curl -s localhost:3000/health
```

### Тесты (изоляция сети, эпик 17.0)

Тесты пишут и удаляют данные через реальные роуты — только на **локальный**
одноразовый Postgres, никогда на прод (жёсткая проверка в `tests/setup.ts`:
`DATABASE_URL` обязан указывать на `localhost`/`127.0.0.1`).

```bash
# создать backend/.env.test.local (в репозиторий не попадает) с
# DATABASE_URL на свой локальный Postgres, например:
# DATABASE_URL=postgresql://postgres@127.0.0.1:5432/t2_test

cd backend
npm run migrate   # один раз — накатить схему (см. §18, backend/migrations/)
npm test
```

В CI (`.github/workflows/ci.yml`) то же самое происходит автоматически на
каждый push — Postgres поднимается в одноразовом контейнере, схема
накатывается тем же `npm run migrate`, что и на проде.

---

## 17. Деплой на Railway

1. Root Directory = **`backend`**  
2. Variables: БД, токен, chat ids  
3. Build: `npm ci && npm run build`  
4. Start: `npm start`  
5. Health: `/health`  
6. **Replicas = 1**  
7. **Деплой ждёт зелёный CI** (с 17.3.0) — `checkSuites: true` на deployment trigger сервиса (Railway GraphQL API, `deploymentTriggerUpdate`, настройки нет в `railway.json` — только через API/дашборд). Красный `.github/workflows/ci.yml` теперь блокирует деплой, а не просто сигнализирует постфактум

Лог успеха: серия `✅ ... routes registered` (по одной на каждый модуль
`routes-*.ts`), `📦 Применены миграции: ...` (если были новые), `🚀 Сервер на 0.0.0.0:…`, `🤖 Bot polling started`.

---

## 18. Миграции SQL

С 17.5.0 — система миграций (`backend/src/db/migrate.ts`), не ad hoc SQL
руками на Railway. Пронумерованные файлы в `backend/migrations/`, трекинг —
таблица `schema_migrations` (`name`, `applied_at`). **Важно**: именно
`backend/migrations/`, не `sql/` на корне репозитория — Root Directory
сервиса на Railway = `backend`, всё, что снаружи, в контейнер не попадает.

**Новое изменение схемы**: создать `backend/migrations/00NN_описание.sql` со
следующим номером — и всё, применяется само:

- **На проде** — автоматически при следующем деплое, до открытия порта
  (`index.ts`, до `app.listen()`). Если миграция падает — сервер не
  стартует (лучше не поднимаемся, чем поднимаемся с неверной схемой);
  `railway.json` → `restartPolicyType: ON_FAILURE` в этом случае будет
  ретраить старт, так что упавшую миграцию нужно чинить новым коммитом,
  а не полагаться на ретраи.
- **В CI** (`.github/workflows/ci.yml`) — `npm run migrate` на чистом
  Postgres на каждый push, тем самым же кодом, что и на проде.
- **Локально** — `cd backend && npm run migrate` (нужен `DATABASE_URL` в
  окружении).

Файл уже применённой миграции задним числом не редактируется — новое
изменение, даже мелкое, всегда новый номер.

`backend/migrations/0001_baseline.sql` — снапшот схемы на момент введения
системы (17.5.0), на самом проде НЕ исполнялся — `schema_migrations` там
сразу засеяна записью об этом файле, чтобы не пытаться заново создать уже
существующие таблицы. Исполняется только на чистой БД (CI, локальный тест).

---

## 19. Mini App в BotFather

Menu Button → URL `https://<service>.up.railway.app/`  
Открывать из Telegram. После деплоя — полное закрытие WebApp (кэш).

---

## 20. Типовые сбои

| Симптом | Действие |
|---------|----------|
| 409 getUpdates | два polling на одном `BOT_TOKEN` — один инстанс бота, `railway logs` на дубли реплик |
| Отказ в доступе / `bound:false` | `access_status` не `active`, или сотрудник не привязан к `telegram_id` — SQL-проверка (§7) или approve заявки |
| 401 на своих же данных из реального Telegram-клиента | initData не проходит HMAC (устаревший/битый `initData`, часы клиента, не тот `BOT_TOKEN`) — не путать с `ALLOW_INSECURE_AUTH`, в проде он должен быть выключен |
| Планы-нули на «План дня» | нет месячного плана точки (`store_month_plans`) — снапшот материализуется из него автоматически, руками вносить не нужно (см. §10) |
| Касса «не та» | формула Δ = факт − (1С + 2000), см. §11 |
| 404 на существующем роуте | модуль не в `routeModules` в `app.ts` — проверь регистрацию |
| Сервер не стартует после деплоя, `restartPolicyType: ON_FAILURE` ретраит | упавшая миграция — смотри `railway logs` на `❌ Миграции упали`, чини новым коммитом (§18), не полагайся на ретраи |

```powershell
$h = @{ "X-Telegram-Id" = "ID" }  # только для локальной разработки / ALLOW_INSECURE_AUTH=true
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/access/status" -Headers $h
Invoke-RestMethod "$base/me" -Headers $h
```

---

## 21. История версий

| Версия | Суть |
|--------|------|
| Sheets + Apps Script | первые отчёты |
| v3–v5 | Mini App, планы, BFQ, bulk |
| v8 | access gate, supervisor |
| v12 | ЛК, касса, multi-metric |
| **v13** | смены, NLP, offline, live, insights |
| **13.3** | месяц+архив, промо, gate UI |
| **13.4** | tutorial employee + manager |
| **14.0–14.1** | Кабинет супервайзера, PNG-отчёты, кастомные метрики |
| **14.2** | initData HMAC-проверка, закрыты открытые роуты, убрана SQL-инъекция в offline sync, XSS-фиксы во фронтенде, отчёты/дашборд считают метрики динамически (кастомные больше не пропадают), убран мёртвый код (routes-v4/v6/v7/promos → routes-employees.ts) |
| **14.3** | Рефакторинг: index.ts (963 строки) разбит на routes-core/sales/schedules/stats/cash/promos/reports.ts; index.html (6091 строка) разбит на styles.css + 13 файлов в frontend/js/. Заодно найден и исправлен баг: `replyTicket` была объявлена дважды (кнопка «Ответить» в разделе «Поддержка» не работала) |
| **14.3.1–14.3.2** | Хотфиксы после разбивки 14.3: 26 GET-запросов во фронтенде не слали `X-Telegram-Init-Data` (получали 401 на защищённых роутах); `todayMoscow()` вызывалась в `01-core.js` до того, как определялась в `02-nav-utils.js` — падал весь скрипт, ломая план/график/кабинет/команду разом |
| **14.4.0** | Техдолг перед AI-эпохой: убрана мёртвая ветка `shift_open`/`shift_close` в `/sync/batch` (офлайн-очередь умеет только `sale`, смены туда никогда не попадали); `middleware-auth-v8.ts` (был просто ре-экспортом) убран, `routes-v8.ts` импортирует `middleware-auth.ts` напрямую; удалены осиротевшие `bot-messages.ts` и `index-snippet.txt`; добавлен `npm run smoke:frontend` — vm-тест порядка подключения `frontend/js/*.js`, ловит класс бага из 14.3.1 |
| **14.5.0** | Command Center v1: виджет «Сеть за минуту» на главной для manager/supervisor/admin (health-score + топ-3 просадки, через `/supervisor/health` — эндпоинт для виджетов существовал с 14.x, но не был подключён ни к одному экрану); в кабинете супервайзера впервые появился список алертов (`/alerts`) с подтверждением (`/alerts/:id/ack`) — раньше эти роуты не имели UI вообще, алерты уходили только админу в личку и накапливались без возможности снять; удалены осиротевшие `supervisor-page.html`/`supervisor-ui.js`/`supervisor-ui.css` (не подключены к index.html, реальный кабинет супервайзера — `08-access-supervisor.js`) |
| **14.6.0** | Смена как сессия: закрытие смены вместо тоста «идеальная / нет» показывает разбор — score, факт/план по SIM/MNP/ПА/Комбо, явную причину «до идеальной смены не хватило» (`ideal_missing` от `/shifts/close`), плюс XP/уровень/стрик за эту смену (`evaluateShiftClose` в gamification.ts считал это и раньше, просто не возвращал наружу — экран его игнорировал) |
| **14.6.1** | Хотфикс: вкладка «Заявки на доступ» перекидывала на главную — в `index.html` отсутствовал контейнер `page-access` (потерялся при разбивке 14.3.0), `switchPage()` не находил элемент и молча падал на home. Кнопка живёт на вкладке «Команда» → «Управление», не на главной |
| **14.7.0** | Отчёт-история: итог дня в чат теперь уходит альбомом из 3 картинок вместо одной — план дня → факт → фокус на завтра (цели + кто в графике + подсказка по пиковому часу из `store_hour_profile`). Тот же resvg-рендерер и та же цепочка фолбэков (PNG → SVG-документ → текст), просто на 3 кадра; при сбое media group откатывается на старый одиночный финал. Превью-страница «Отчёт-картинка» показывает то же самое, что реально уйдёт в чат. Микро-отчёты не менялись |
| **14.8.0** | What-if v2: сценарий из нескольких переносов разом вместо одного (бэкенд `simulateScheduleMoves` уже принимал массив — не хватало только UI: список переносов с добавлением/удалением). Сравнение сценариев A/B: посчитал один набор переносов → «Сохранить как A» → очистил, собрал другой → авто-сравнение при пересчёте. Метрика сравнения — не сумма Δ SIM по сети (перенос внутри сети всегда даёт в сумме ноль, сравнивать по этому бессмысленно), а худшая просевшая точка: какой сценарий меньше вредит своему самому слабому месту |
| **14.9.0** | Автоанонс обновлений: важные версии (minor-эпики, не хотфиксы) сами приходят в рабочий чат картинкой с кратким описанием при старте сервера — тем же resvg-пайплайном, что и отчёты. Список версий для анонса — `src/changelog.ts`; какая версия уже анонсирована — `app_settings.last_announced_version`, отправка отмечается только при успехе. Заодно: `.btn-ghost` использовался в 5 местах (в т.ч. до этой сессии) без единого объявления в CSS — рендерился браузерным дефолтом; добавлен стиль в тон `.btn-main`. Плановый эпик «Порог перед ИИ» сдвинут на 14.10.0 |
| **14.10.0** | Порог перед ИИ: `db/index.ts` и `bot/index.ts` читали `process.env` на верхнем уровне модуля — из-за хостинга ES-импортов это выполнялось раньше `dotenv.config()` в `index.ts`, так что `npm run dev` тихо не видел `.env` (в Railway не заметно — там переменные уже в окружении до старта node). Добавлен `src/env.ts`, первый импорт index.ts, гарантирующий порядок. Убран дублирующий SVG-рендерер в `routes-reports.ts` (`buildDayReportSvgInline`) — параллельная реализация того же пути к тем же данным, не настоящий фолбэк. Статус мультитенантности явно задокументирован в `tenant.ts`: сейчас только branding, изоляция данных — сознательно отложенный эпик мультитенанта. Полная регрессия по 17 разделам приложения на реальных данных — без единой ошибки |
| **15.0.0** | AI Copilot v1, первая ИИ-эпоха. Сознательно бесплатно и без чата/tool-calling — оба сценария одношаговые, бэкенд сам собирает контекст кодом, модель вызывается через Groq (бесплатный тариф, `llama-3.3-70b-versatile`, без карты): (1) итог смены сотруднику — короткий комментарий сразу после `/shifts/close`, на основе факта/плана/XP; (2) комментарий к просадке точки — встроен в существующий cron итоговых отчётов (`cron/reports.ts`): если факт дня < 85% от плана, модель даёт гипотезу вместо голой цифры; если план закрыт — берётся случайная заготовленная фраза-похвала без вызова модели. Комментарий уходит и в подпись к отчёту в чат, и в БД — оттуда его подтягивает Command Center на главной (`/supervisor/health`, поле `drops[].ai_comment`). Новая таблица `ai_audit` — лог всех промптов/ответов модели. Без ключа `GROQ_API_KEY` обе функции тихо no-op'ают (summary → `null`, комментарий → заготовленный фолбэк-текст), остальное приложение не затронуто |
| **15.0.1** | Хотфикс: касса (`GET /cash/table`, `PUT /cash`) была ошибочно закрыта на `requireManager` — 403 для обычного employee, хотя фронтенд (`09-cash-metrics.js`) всегда показывал форму внесения кассы всем сотрудникам точки, не только управляющим. Заменено на `requireActive` (любой активный сотрудник); неиспользуемый фронтендом `GET /cash` (список) оставлен manager-only |
| **15.0.2** | Итоговый отчёт-альбом (план/факт/фокус на завтра) больше не подписывает каждую из 3 картинок по отдельности — заголовок кадра и так есть на самой картинке. Вместо трёх caption — одно сообщение под альбомом с итогом дня и AI-комментарием (`cron/reports.ts`) |
| **15.0.3** | Manager/admin теперь могут отменить ошибочно внесённую метрику за день (`PUT /sales/:id/zero`, кнопка «Удалить» в карточке сотрудника → «Исправить ошибочный ввод») — `sales` аддитивная, поэтому это обнуление конкретной колонки с записью в `sales_audit`, а не удаление всей записи за день. AI-гипотеза при просадке точки теперь смотрит на все ~18 метрик `store_plans`, а не только SIM/MNP/ПА/Комбо — раньше просадка по, например, страховкам или аксессуарам была для модели невидима |
| **15.0.4** | Удаление кастомных метрик плана получило UI — `DELETE /metrics/:id` существовал на бэкенде (soft-delete, базовые метрики защищены), но был недоступен из приложения. «Управление» → «Метрики плана» теперь показывает список своих метрик с кнопкой «Удалить» перед формой создания новой |
| **15.1.0** | Обучение v3 — «игровой уровень» с персонажем Арбузычем (🍉). Два визуальных режима: полноэкранные cutscene-главы (`#tutorialScreen`) для вступления/переходов/квиза/финала и доработанный coach-оверлей (`#tutorialOverlay`, сильнее затемнение, аватар-бабл) для «нажми сюда» на реальном UI. Оба трека (employee 22 шага, manager 17 шагов) переписаны и разбиты на главы с мини-праздником (`confettiBurst()`) между ними. Добавление продажи в главе «Продажи» теперь тренируют на настоящей форме (`07-add-sale.js`) в dry-run режиме — `window.__tutorialDryRun` перехватывает `submitSale()` до реального `POST /sales`, ничего не пишется в базу и в чат. Новый `POST /me/tutorial-complete` идемпотентно начисляет XP и бейдж (`tutorial_done`/`tutorial_mgr_done`) через уже существующие `addXp`/`grantBadge` — раньше прохождение обучения вообще не было известно бэкенду, только `localStorage` |
| **15.7.0** | «Кого куда поставить» (`services/forecast.ts` → `getStaffingHints()`). Абсолютной меры «нужно N человек» нет — прогноз в штуках метрик, не в человеко-часах, поэтому эвристика относительная: нагрузка на человека в графике (прогноз / headcount по `schedules`) сравнивается со средней по сети на ту же дату; кто выше среднего на 30%+ или вообще без headcount при ненулевом прогнозе — попадает в подсказку. Новый `GET /staffing-hints` (manager/admin), блок на странице «Прогноз» на 7 дней вперёд, кнопка «Предложить перенос» переиспользует `proposeMoveForStore()` из 15.4.0 (расширен вторым параметром — датой). Честно помечено как эвристика, не точный расчёт |
| **15.6.0** | Объявления сети (`/announcements`) не работали вообще — бэкенд отдаёт голый массив (как `/sales`, `/employees`), а фронтенд ждал `{items:[...]}`; `data.items` на массиве всегда `undefined`, экран показывал «Нет объявлений» независимо от реальных данных (в базе на момент фикса лежало 5 штук). Заодно добавлена настоящая причина заводить read-tracking — новый `GET /announcements/:id/reads` (manager/admin) и кнопка «Кто прочитал» показывают по именам, кто уже видел обязательное объявление, а кто ещё нет; раньше read-статус был виден только самому сотруднику про себя |
| **15.5.0** | Единообразие метрик. Метки одной и той же метрики раньше жили в шести независимых копиях (`01-core.js`, `03-home.js`, `04-schedule.js`, `05-my-plan.js` — три штуки в одном файле, `06-team-bfq.js`, `11-v13.js`) и на бэкенде тоже в двух (`routes-metrics.ts` и `services/metrics-catalog.ts`) — расходились по деталям, например «Аксессуары» на одном экране и «Аксы» на другом для одного и того же показателя. Бэкенд: `GET /metrics` теперь просто вызывает `getMetricDefs()` вместо своего отдельного захардкоженного фолбэка. Фронтенд: `METRICS` в `01-core.js` — единственный источник, новые `metricLabel(id)`/`metricShort(id)` читают из него; все экраны переведены на них. Заодно «Мои продажи сегодня» перебирает `METRICS` вместо фиксированного списка из 15 id — кастомные метрики тоже попадают в сводку |
| **15.4.0** | «Действие из просадки»: под каждой карточкой просадки в Command Center (`03-home.js`) и кабинете супервайзера (`08-access-supervisor.js`) — кнопка «Предложить перенос». Ведёт на страницу «Прогноз» и сразу выставляет проблемную точку в поле «На точку» What-if-сценария (`proposeMoveForStore()` в `13-v14.js`, дожидается `fillStoreSelects()` перед подстановкой значения, иначе селект перезатирается) — супервайзеру остаётся выбрать только сотрудника и «с точки». Заодно кабинет супервайзера стал показывать `ai_comment` под просадкой, как и главная — раньше это было только в Command Center |
| **15.3.0** | Прогноз (`services/forecast.ts`) переписан с нуля. Старая модель брала среднее строго по тому же дню недели за последние 8 недель — на датасете короче 8 недель (как сейчас) подходящих точек нет вообще, отсюда прогноз всегда 0 для любой точки. Новая модель: простое экспоненциальное сглаживание (`α=0.3`) для уровня тренда × сезонная поправка на день недели с усадкой к нейтральной 1.0 (`k=3`), пока по дню недели мало наблюдений — даёт осмысленное число с первого дня и уточняется по мере накопления истории. Ответ `/forecast/:storeId` дополнен `history_days`; фронтенд показывает предупреждение, если истории меньше 14 дней. Проверено на реальных данных: Космонавтов (4 дня истории) — 10-13 SIM/день вместо нуля; Калинина 11 (0 продаж в базе вообще) — честный 0 с пояснением вместо молчаливо «сломанного» экрана |
| **15.2.2** | Хотфикс: время открытия смены в «Мой» показывало UTC вместо МСК (открыл в 9:55 — писало 6:55) — `sess.opened_at.slice(11,16)` резал сырую UTC ISO-строку без конвертации часового пояса. Новый `timeMoscow()` в `01-core.js` форматирует явно через `Intl.DateTimeFormat` с `timeZone: 'Europe/Moscow'` |
| **15.2.1** | Хотфикс: `store_plans` материализовался только вручную кнопкой «Записать дневные планы в БД» — если никто не нажал, у точки не было плана на день, и отчёт-картинка/«Фокус на завтра» рендерились пустыми (факт 0, план «—»), как случилось с Калининой 11 на 04-05.08. Теперь `cron/reports.ts` в 06:00 МСК сам материализует план на сегодня и на завтра через уже существующий `materializeStoreDailyPlans()` (`services/plans.ts`). Данные за 05-06.08 пересчитаны вручную через продовый `POST /plans/stores/daily/materialize` |
| **15.2.0** | UI-полировка heatmap/прогноз/касса/команда под общий стиль приложения (Command Center, `.cc-*`/`.mt-*` токены вместо инлайн-стилей): heatmap — классы `.hm-cell` вместо сырых inline `rgba()`; прогноз — исправлена вёрстка (`.mt-grid` был 3-колоночным на 4 метрики, теперь `.mt-grid-4`); касса — настоящая строка заголовков колонок; команда — цветной кружок-инициал вместо статичной 👤, тон = есть ли у сотрудника продажи сегодня. Заодно найден и исправлен `var(--muted)` — использовался в 8 местах (`.sv-*`), нигде не был определён. Добавлен `@media (prefers-reduced-motion: reduce)` — раньше не учитывался нигде, при этом две бесконечные анимации (Арбузыч, spotlight-пульс) крутились всегда. Пустые состояния heatmap/промокодов/live-сети больше не показывают технические заметки вроде «Нужен sales_events (sql/v8-0-roadmap.sql)» |
| **15.8.0** | Эпик мультитенанта, фаза A — секторы и сети точек. *(в записях этого сеанса раньше называлось «эпик 17.0» как внутреннее кодовое имя — не путать с реальной версией 17.0.0+, это другой, более поздний эпик про CI/тесты)* `organizations`/`org_id` существовали в схеме с 14.x, но были write-orphaned (ни один INSERT/UPDATE их не трогал) и влияли только на брендинг — реальные данные читались по всей сети без фильтра. Новая таблица `sectors`, `organizations` получили `sector_id`/`chat_id` (= «сеть точек» по смыслу, переиспользована как есть), `supervisor_sectors` заменяет ручное назначение точек супервайзеру (`supervisor_stores`) — теперь назначение на сектор целиком, супервайзер сразу видит все точки всех сетей внутри (`middleware-auth.ts` → `getUserStoreIds`, `services/supervisor-analytics.ts` → `resolveSupervisorStores`). Уведомления (продажа, микро/итог-отчёты, алерты 14:00/16:00, анонс релиза) теперь роутятся по чату **точки** — `getStoreChatId()`/`getOrgChatId()` в `tenant.ts`, `notifyChat*` уже принимали `chatId`, просто никто его не передавал. Алерты 14:00/16:00 раньше слали одно агрегированное сообщение по всей сети в общий чат — теперь группируются по сети и шлют по сообщению на сеть в её чат. Убран хардкоженный TS-массив `SCHEDULES` в `cron/reports.ts` (3 точки, расписание отчётов руками в коде) — читается из `stores.micro_report_times`/`skip_sunday_micro_times`/`close_time_weekday`/`close_time_sunday`, которые уже были в схеме, но нигде не читались; новая точка получает расписание сразу, без правки кода. `POST /employees`/`POST /stores` и bot-approval пишут `org_id` (раньше не писали никогда); закрыта дыра в `listStoresForOrg()` — молча фолбэчилась на все точки при пустом фильтре. Обратная совместимость: единственная существующая сеть перенесена в `sector='default'`/`org='default'` с тем же `chat_id`, что был в `CHAT_ID` — поведение не изменилось. Изоляция данных на уровне экранов (сотрудники/график/промокоды/касса видны только своей сети) — фаза B, следующим заходом |
| **15.9.0** | Полная лестница ролей вместо плоского `employee/manager/supervisor/admin`: `Стажёр(trainee) → Продавец(employee) → Старший продавец(senior) → Руководитель(manager) → Супервайзер(supervisor) → Admin`. `senior` — новая роль, операционно как руководитель (сотрудники/точки/график/касса/продажи/экспорты — везде, где раньше `requireManager`), но намеренно без доступа к Command Center и кабинету супервайзера — решили разделить «операционные права» и «видимость аналитики» на два независимых флага (`isManager()`/`canManage()` расширены до senior, новый `canViewAnalytics()` на фронте и уже существующий `canViewSupervisor()` на бэке — оба явно НЕ включают senior). Назначение роли (`PATCH /employees/:id/role`) раньше не имело вообще никаких ограничений — любой manager/admin мог поставить кому угодно любую роль, включая admin; теперь `canAssignRole()` в `middleware-auth.ts` разрешает назначать только роль строго ниже своей по уровню (admin — без ограничений, как и было). Заодно найдены и исправлены два бага в той же области: кнопка смены роли в карточке сотрудника (`06-team-bfq.js`) стучалась в `PATCH /employees/:id`, а не `/employees/:id/role` — хендлер роль не трогает (по собственному комментарию в коде), кнопка молча ничего не делала; дублирующий эндпоинт `POST /employees/:id/role` в `routes-v3.ts` имел свой allowlist ролей без `supervisor`, расходящийся с версией в `routes-v8.ts` — выровнен через тот же `canAssignRole()` |
| **15.10.0** | Первая проверка эпика 17.0 на реальных вторых данных: заведена настоящая тестовая сеть (`test_network`, свои 2 точки, свои 2 сотрудника, свой `chat_id`) — уведомления/отчёты по ней подтверждённо уходят в свой чат, а не в общий. Заодно закрыт пробел, который эта проверка сразу вскрыла: `GET/POST /employees` были не scoped по сети — «Команда» показывала сотрудников всех сетей вперемешку. Теперь по умолчанию видна только своя сеть (`COALESCE(org_id,'default') = свой org_id`); у admin в «Команде» появился переключатель сети (`GET /orgs`, admin-only) — по умолчанию видит свою рабочую сеть, но может явно заглянуть/завести сотрудника в любой другой (`?org_id=`/`body.org_id`, тоже только для admin). `GET /me` заодно стал отдавать `org_id` — фронту он был нужен для дефолта переключателя |
| **15.11.0** | Эпик мультитенанта, фаза B завершена — график/касса/промокоды тоже scoped по сети, тем же паттерном, что и «Команда» в 15.10.0 (общий хелпер `resolveViewOrgId()` в `middleware-auth.ts`, переиспользован во всех четырёх разделах). `GET /schedules`, `/schedules/month`, `GET /cash/table`, `/cash`, `GET /promos` фильтруются по сети точки (или по `org_id` самого промокода); `POST /schedules` дополнительно проверяет, что точка принадлежит сети менеджера (403, если нет) — но не ограничивает, какого сотрудника туда поставить, потому что подмена в чужой сети остаётся легитимной (эпик мультитенанта, фаза A). `rtk_promocodes` — миграция `org_id` была добавлена ещё в 15.8.0, но роуты её не использовали до сих пор; `GET/POST /promos/:id`, `/:id/use` тоже проверяют `org_id`, чтобы код чужой сети нельзя было забрать по угаданному id. Переключатель сети у admin (появился в 15.10.0 для «Команды») теперь работает и на «Расписании», «Кассе», «Промокодах» |
| **15.12.0** | Проверка на реальной второй сети (`test_network`) вскрыла, что фаза B в 15.11.0 закрыла не все дыры. Дополнительно scoped: `GET /stats/daily` («Сеть сегодня»), `GET /dashboard` («Топ за 7 дней», по точке продажи — не по «домашней» сети сотрудника, как и весь эпик мультитенанта), `GET /plans/employees/month` («Планы и факт за месяц»), `GET /plans/stores/daily` («План дня по точкам»). Самое широкое: `resolveSupervisorStores()` для manager/admin отдавал `scope = null` («вся БД без фильтра») — Command Center на главной и весь кабинет супервайзера показывали буквально все сети сразу; теперь для manager/admin scope — список точек своей сети (или явно выбранной admin'ом). Заодно исправлена вёрстка `computeStoreDailyPlans()`: хардкоженная `STORE_SHARES` на 3 точки заменена на чтение `stores.plan_share` — колонка была в схеме и даже отредактирована в БД вручную, но код её не читал (тот же паттерн, что `micro_report_times` в 15.8.0). Найдена и исправлена регрессия, которую сама эта фаза едва не внесла: `GET /schedules`/`/schedules/month`, отфильтрованные по сети точки, переставали показывать сотруднику его СОБСТВЕННУЮ смену, если сегодня он подменяет в чужой сети — добавлено исключение «своя запись видна всегда» |
| **15.13.0** | План точки — из «доли от суммы планов сотрудников» в независимый ручной ввод. Новая таблица `store_month_plans` (зеркалит `employee_month_plans`, только на точку) + `GET/PUT /plans/stores/:id/month`, гейт — точка должна принадлежать своей сети (как и `POST /schedules`). `computeStoreDailyPlans()` переписан: вместо суммирования остатков планов всех сотрудников сети и деления по `plan_share` — просто `(план точки на месяц − факт точки с начала месяца) / оставшиеся дни`, ровно та же формула, что уже была для сотрудника (`getEmployeeDailyPlan`), только на уровне точки. Старый шаблон `store_plans` с `plan_date IS NULL` (ручная цифра-фолбэк на день) убран из приоритета в `04-schedule.js` — план точки его полностью заменяет. Планы сотрудников как отдельная сущность (личная статистика/BFQ) не тронуты. У точек, заведённых до этой версии, план на месяц пуст — «План дня по точкам» покажет 0, пока управляющий не введёт план вручную (тап по точке в «Управление») |
| **15.13.1** | Хотфикс: команда `/chatid` боту — прямо в группе/теме отвечает `chat.id` и `message_thread_id` текущей темы. Нужно было для подключения РТТ Гуреева (их группа с темами — отдельная тема «продажи», отдельная «отчёты»), пригодится для любой следующей сети |
| **15.14.0** | Подключена вторая реальная сеть — **РТТ Гуреева** (4 точки: Хорошевская 27, Кожевническая 4, Новослободская 10, Комсомольская пл. 3 — круглосуточная, «итог дня» на 21:00; 8 сотрудников). Основная сеть переименована в **РТТ Бижонов**. Их группа в Telegram — форум с темами (отдельная тема «продажи», отдельная «отчёты»), которого раньше в приложении не было вообще — на сеть был только один `chat_id`. Добавлены `sales_thread_id`/`reports_thread_id` на `organizations`, `notifyChat*` в `bot/index.ts` научились передавать `message_thread_id`, новые `getOrgNotifyTarget()`/`getStoreNotifyTarget()` в `tenant.ts` резолвят чат+тему по назначению (продажа → тема продаж, отчёты/алерты → тема отчётов). Заодно найден и исправлен баг: `checkStoreLagAlert()` (алерт отставания 16:00) считал дневные планы только для сети `default` — вторая сеть вообще не получала бы этот алерт |
| **15.14.1** | Структурная чистка без изменения поведения (без анонса — не эпик). Три разросшихся файла-свалки разбиты по темам: `06-team-bfq.js` (802 строки, команда+BFQ+планы+поддержка+модалки) → `06-team-bfq.js`/`06b-plans-bfq.js`/`06c-support-tickets.js`; `routes-v13.ts` (717 строк) → `routes-shifts.ts`/`routes-insights.ts`/`routes-live-alerts.ts`/`routes-comms.ts`/`routes-forecast.ts`; `routes-v3.ts` (557 строк) → `routes-me.ts`/`routes-bfq.ts`/`routes-export.ts`, а `/schedules/bulk`+`DELETE /schedules` переехали в `routes-schedules.ts` — мутации графика были раскиданы по двум файлам. Заодно: дедуп проверки «точка принадлежит вашей сети» в `assertStoreInOrg()` (была продублирована в `routes-schedules.ts` и `routes-plans-v5.ts`); закрыт пробел — `/schedules/bulk` не проверял принадлежность точки сети вообще, хотя одиночный `POST /schedules` уже проверял; удалён мёртвый код (`cellTone()` во фронтенде, нигде не вызывался) |
| **15.15.0** | Изоляция по сети — последние 6 непроверенных мест. `getLiveNetworkMap()` (живая карта) была самой грубой дырой: показывала имена сотрудников, продажи и кассу вообще всех сетей сразу, без единого фильтра — теперь `orgId` параметр. Аналогично scoped: `GET /forecast/:storeId`, `GET /heatmap/precise/:storeId` (реальный heatmap, который дёргает фронтенд — не путать с параллельным `GET /heatmap/:storeId` в `routes-forecast.ts`, тот не используется) через `assertStoreInOrg()`; `GET /staffing-hints`, `GET /alerts`, `GET /export/bi/daily` через `resolveViewOrgId()`. `newbieCohorts(orgId)` — параметр существовал в сигнатуре и раньше, но нигде не читался в самом SQL-запросе (тот же паттерн, что `plan_share`/`micro_report_times` ранее). Заодно найден и починен независимый баг: `newbieCohorts()` падал с 500 на `invalid input syntax for type date`, когда дата бралась из `created_at` (JS `Date` из pg-драйвера) — `String(date).slice(0,10)` резал `"Tue Jul 28"` вместо ISO |
| **15.15.1** | Хотфикс: заголовок карточки-анонса версии в чат обрезался по краю на длинных названиях (SVG не переносит текст сам) — буллеты уже переносились строками, а заголовок оставался одной строкой на 26px. `wrapText()` в `report-image.ts` сделан переиспользуемым (параметр максимума символов в строке вместо константы), заголовок теперь тоже переносится, версия и буллеты сдвигаются вниз на высоту второй строки заголовка |
| **15.16.0** | Изоляция по сети — объявления, каналы, заявки на доступ (`routes-comms.ts`). `announcements.org_id`/`channels.org_id` существовали в схеме и раньше, но ни один запрос их не читал — тот же паттерн, что `plan_share`/`micro_report_times`: сотрудник любой сети видел объявления и мог читать/писать в каналы вообще всех сетей. `GET/POST /announcements` теперь фильтруют/пишут `org_id`; `GET /announcements/:id/reads` проверяет принадлежность объявления сети менеджера; новый `assertChannelInOrg()` гейтит `GET/POST /channels/:id/messages`. `GET /access/requests` (`routes-v8.ts`) теперь фильтрует заявки по уже существующему сотруднику (`claimed_employee_id`) по его сети; заявка от ещё не найденного в системе гостя сети не имеет и видна всем управляющим — осознанное ограничение данных, не дыра. Заодно починена кнопка «Тикеты поддержки» — показывалась всем manager/senior и падала на 403, хотя `routes-support.ts` изначально задуман только для admin (эскалация к разработчику, не менеджерский инбокс сети) |
| **15.16.1** | Хотфикс, найден по жалобе «график сотрудника показывает мою сеть» при переключении admin между сетями. Настоящая причина оказалась серьёзнее: `GET /sales` вообще не проверял авторизацию и не фильтровал по сети — отдавал продажи ВСЕХ сетей за день (имена, точки, все метрики) кому угодно с любым или вообще без `X-Telegram-Id`. Добавлены `requireActive` + фильтр по сети точки (с self-inclusion, как в `/schedules` — своя продажа видна при подмене в чужой сети). `POST /sales` и `PUT /sales/:id/zero` тоже не проверяли, что точка принадлежит сети менеджера — manager одной сети мог вписать или обнулить продажу на точке вообще любой другой сети; теперь `assertStoreInOrg()`, кроме записи за самого себя (подмена остаётся легитимной). Заодно закрыты 4 места во фронтенде, где `org_id` не передавался при просмотре чужой сети admin'ом: карточка сотрудника, месячный график, форма добавления продажи, бейджи «продажи сегодня» в списке команды — везде тихо подставлялась своя сеть admin'а вместо той, что он смотрит |
| **16.0.0** | Пикер сети при регистрации гостя (`GET /access/orgs`, публичный) — заявка на доступ теперь несёт `org_id` и уходит только manager/supervisor/senior выбранной сети + admin (страховка на случай новой сети без активного управляющего), а не всем сетям сразу. `GET /access/employees-directory` тоже получил `?org_id=` — список «я из списка» раньше показывал сотрудников вообще всех сетей, гость сети B мог заклеймить сотрудника сети A. Важный смежный фикс: одобрение заявки (`POST /access/requests/:id/approve`) раньше создавало сотрудника в сети ОДОБРЯЮЩЕГО менеджера, а не в сети заявки — с admin, теперь получающим cc по заявкам любой сети, это стало реальным риском молча пересоздать сотрудника не в той сети. Деактивирована тестовая `test_network`, которая иначе попала бы в новый публичный пикер. Визуально: новый экран загрузки приложения (splash, `#appSplash`) вместо пустоты до первого ответа `/access/status`; экраны регистрации/ожидания/отказа доведены до токенов дизайн-системы (`.gate-icon`, `.btn-ghost` вместо инлайн-стилей); первое сообщение бота `/start` в приватном чате — с кнопкой «Открыть T2 Sales» (`web_app`-кнопка работает только в приватных чатах, не в групповых — учтено) |
| **16.0.1** | Хотфикс: admin не мог сохранить план точки чужой сети — 403 «Точка не принадлежит вашей сети», хотя сама точка корректно показывалась в списке (уже отфильтрованном переключателем сети). Бэкенд (`PUT /plans/stores/:id/month`) уже умел принимать `org_id` от admin, просто `saveStoreMonthPlan()` во фронтенде его не отправляла — тот же класс пропуска, что чинился весь этот сеанс в других местах |
| **16.1.0** | Новая сеть — без SQL. Admin заводит сеть прямо в приложении («Команда» → «Управление» → «Сети»): название, бренд, цвет, сектор (печатаешь новое имя — заводится тут же, отдельного экрана для секторов нет), chat_id и thread_id тем (узнаются командой `/chatid` боту). `upsertOrg()` раньше писал только 5 branding-полей — `sector_id/chat_id/sales_thread_id/reports_thread_id/is_active` существовали в схеме, но никогда не сохранялись через код; частичное сохранение (создать сеть раньше, чем узнают chat_id, дописать позже) — через `body[key] !== undefined` на новых полях и `COALESCE(...,organizations.x)` на branding-полях, чтобы пропущенное поле не затиралось молча. Форма новой точки получила часы работы/смены/время итога дня и переключатель «круглосуточно» — раньше этих полей не было в UI совсем, каждая точка тихо получала дефолт 10-21 (реальная круглосуточная точка требовала ручного SQL). Заодно `POST /stores` — тот же класс пропуска `org_id`, что чинился весь сеанс: admin не мог создать точку в чужой сети через переключатель |
| **16.2.0** | Кабинет супервайзера — полный рефактор оформления и функционала. Раньше supervisor делил интерфейс с manager: одна страница поверх обычных 5 вкладок, кнопка входа видна manager/admin/supervisor. Теперь — отдельный визуал: свой фиолетовый акцент (`.sv-*` классы в `styles.css` были захардкожены в основной синий, не через токены — перекрашены точечно), свои 4 вкладки (Обзор/Точки/Люди/Тренд, свой `#bottomNavSupervisor`) вместо обычных пяти. Реальная изоляция, не только визуальная: `GET /supervisor/dashboard` (`routes-supervisor.ts`) теперь только `supervisor | admin` — manager убран; `GET /supervisor/health` (виджет «Сеть за минуту» на главной manager/admin) не тронут, это отдельная фича на том же движке. Заодно закрыт смысловой разлад: обычные вкладки Команда/График/Касса резолвили supervisor в его СОБСТВЕННУЮ сеть (`resolveViewOrgId`), а не в весь сектор — то есть кабинет честно показывал весь сектор, а остальные вкладки — только одну случайную сеть; теперь supervisor вообще не монтирует обычные вкладки, только свой сектор. Точки и топ сотрудников в кабинете подписаны названием сети (`org_name`, join на `organizations` в `buildSupervisorDashboard()`) — раньше в кросс-сетевом списке было не видно, откуда какая запись. Admin заходит через кнопку «Кабинет супервайзера» (теперь `canAdmin()`, не `canViewAnalytics()`) с кнопкой «‹ Назад» |
| **16.2.1** | Хотфикс, найден по живой жалобе сразу после 16.2.0: у admin в кабинете супервайзера показывалась только его собственная сеть (РТТ Бижонов), точки РТТ Гуреева не отображались вовсе. `resolveSupervisorStores()` для `role='admin'` резолвит в одну сеть (`orgId`) — верно для `/supervisor/health` (виджет на ГЛАВНОЙ admin — его своя сеть), но не для самого кабинета: там кабинет обещает «весь сектор», а у admin персонального сектора нет, значит логичный эквивалент — вообще все сети. `GET /supervisor/dashboard` для admin теперь `scope: null` напрямую, минуя `resolveSupervisorStores()` |
| **16.3.0** | Кабинет супервайзера — выполнение и прогноз месячного плана. Вкладка «Точки» получила разворачиваемый список «Ещё метрики» — раньше показывались только SIM/MNP/ПА, теперь все 15. Вкладка «Тренд» получила: выполнение месячного плана по сектору целиком (сумма планов и факта всех точек по каждой метрике) и по каждой точке отдельно, плюс прогноз на конец месяца — та же модель, что уже была в `services/forecast.ts` (простое экспоненциальное сглаживание + сезонная поправка на день недели), но батчем одним запросом на весь сектор вместо N+1 по точке, и расширена с 4 метрик (SIM/MNP/ПА/Комбо) до всех 15. Найдены и починены при верификации перед деплоем два реальных бага модели на денежных метриках (Телефоны, Аксессуары): (1) `GROUP BY sale_date` молча пропускал дни без продаж — сглаженный уровень никогда не видел настоящий ноль и не спускался вниз; (2) холодный старт с фолбэком `baseline=1` был откалиброван под мелкие штучные метрики (SIM 0-10) — на суммах в тысячи рублей единственный ненулевой день после серии нулей делил сам на себя на «1» и улетал за 1000% плана. Оба фикса: заполнение пропущенных дней явными нулями + масштабирование холодного старта под реальное среднее метрики вместо универсальной константы |
| **16.4.0** | Новая быстрая вкладка на главной — «Сеть за месяц»: план/факт/% по всем 15 метрикам сразу, сумма по всей команде сети, строками-барами. Данные уже считались (`getMonthSummaryTable()` → `GET /plans/employees/month`, поле `totals.plan`/`totals.pct`), просто не были нигде показаны — существующая карточка «Итого сеть» на «Планы и факт за месяц» использовала только `totals.fact`, без плана и без цвета по проценту выполнения; заодно и её починили |
| **16.5.0** | «Сеть за месяц» получила разбор по сотрудникам — под общим итогом сети тот же барный визуал по каждому сотруднику (план/факт/% по всем метрикам, смены/остаток), реюз `svBarRowHTML`/`svExtraToggleHTML` из кабинета супервайзера. Отдельно — везде, где раньше выбор точки (продажа, график смен, касса, отчёты, тепловая карта) собирался из намеренно кросс-сетевого `GET /stores`, теперь используется новый `GET /org/stores` — точки только своей сети (с тем же admin-переключателем сети, что и в «Команде»); `GET /stores` остаётся кросс-сетевым для мест, которым это реально нужно (аналитика), просто больше не используется как источник для пикеров |
| **17.0.0** | Эпик «Надёжность перед деньгами»: CI на каждый push (`.github/workflows/ci.yml`) — Postgres-контейнер, проверка типов, smoke-тест фронтенда, 36 тестов на слой авторизации/изоляции сети (`vitest`, `backend/tests/`). Весь сеанс регулярно всплывал один и тот же класс багов — эндпоинт забывал отфильтровать данные по сети (сотрудники в 15.11.0, статистика/планы в 15.12.0, продажи без авторизации вообще в 15.16.1, пикеры точек в 16.5.0) — каждый раз находили вручную; теперь это проверяется автоматически. Тестовая БД — свежий schema-only снапшот прод-схемы (`sql/ci-schema.sql`, без данных и паролей, CI поднимает его в одноразовом контейнере — никакого доступа к проду из CI не требуется). Для `app.inject()` без реального порта вынесена `buildApp()` (`backend/src/app.ts`) из `index.ts` — тот теперь только `buildApp()` + `listen()` + бот/крон. Попутно, пока строили тесты именно на этот класс багов, нашли и закрыли реальную дыру: `PUT /cash` вообще не проверял, что точка принадлежит сети сотрудника (в отличие от `/schedules`/`/sales`, где эта проверка уже была) |
| **17.0.1** | Хотфикс первого прогона CI: Postgres-сервис в workflow был версии 16, а `sql/ci-schema.sql` снят `pg_dump` версии 18 (та же версия, что и на проде) — часть схемы не грузилась (`psql` падал с exit 3). Подняли сервис до `postgres:18`, чтобы версия совпадала с прод-БД |
| **17.1.0** | Вторая волна тестов изоляции — статистика/дэшборд (`/stats/daily`, `/dashboard`), живая карта (`/network/live`), планы (`/plans/employees/month`, `/plans/stores/daily`, `/plans/stores/:id/month`), промокоды (`/promos`), объявления и каналы (`/announcements`, `/channels`), заявки на доступ (`/access/requests`) — ещё 26 тестов на те самые места, где раньше находили реальные дыры (15.12.0, 15.15.0, 15.16.0). Итого 62 теста на слой авторизации/изоляции сети |
| **17.2.0** | Аудит всех роутов (`grep` на отсутствие `org_id`/`resolveViewOrgId`/`assertStoreInOrg`) нашёл 4 реальные дыры, которые предыдущие волны эпика 17.0 не задели: `GET /bfq`, `/bfq/:employeeId` были вообще без авторизации — кто угодно без токена мог узнать BFQ любого сотрудника любой сети по id; `GET /sales/history`, `/sales/audit`, `/export/sales.csv`, `/export/bfq.csv`, `/export/schedules.csv` отдавали данные сразу всех сетей любому manager; `/sales/quick` и `/sync/batch` (офлайн-очередь) — параллельные пути внесения продажи в обход основного `POST /sales` — не проверяли ни своего сотрудника, ни свою точку; `GET /reports/day/:storeId` отдавал превью отчёта любой точки по id. Все четыре закрыты тем же паттерном (`resolveViewOrgId`/`assertStoreInOrg` + новый `assertEmployeeInOrg`) и покрыты 22 регрессионными тестами — итого 84 теста изоляции. Заодно докручен admin-переключатель сети на новых проверках (BFQ-карточка в «Команде», CSV-экспорты, превью отчёта) — тот же класс пропуска `org_id`, что чинился весь сеанс |
| **17.3.0** | Ещё 2 дыры того же класса: what-if симуляция переноса смен (`/schedule/what-if`, `/schedule/what-if/apply`) тянула точки ВСЕХ сетей без фильтра — `/apply` реально пишет в `schedules`, то есть можно было переставить чужого сотрудника на точку любой другой сети; теперь сценарий строится только по своей сети. `POST /alerts/:id/ack` гасил алерт по id без проверки сети — manager другой сети мог тихо снять чужой критический алерт. Плюс регрессионные тесты на уже закрытые в 15.15.0 места (`/forecast`, `/heatmap`, `/cohorts/newbies`, `/staffing-hints`, `/export/bi/daily`) — итого 96 тестов изоляции. Заодно переименован «Эпик 17.0» в истории версий 15.8.0-15.16.0 (старое кодовое имя эпика мультитенанта этого же сеанса) — не путать с реальной версией 17.x, это другой, более поздний эпик |
| **17.4.0** | Последний пункт «Дорожной карты»: рендер отчётов (`resvg`, SVG→PNG) вынесен в `worker_threads` (`src/workers/svg-render.worker.ts` + пул из 2 воркеров, `services/svg-render-pool.ts`) — замерено, один рендер занимает 350-400мс синхронной работы, раньше на это время блокировался вообще весь сервер (cron шлёт микро/итоговые отчёты по каждой точке несколько раз в день). Проверено на реальных данных через `buildApp()` + `app.inject('/health')`, поллинг каждые 15мс во время реального рендера — event loop не блокируется, ответ стабильно <1мс. Плюс включён `checkSuites` на deployment trigger Railway — красный CI теперь блокирует деплой |
| **17.5.0** | Система миграций (`src/db/migrate.ts`) вместо ad hoc SQL руками на проде. Пронумерованные файлы в `sql/migrations/` + трекинг в `schema_migrations` — применяются сами: на проде автоматически при старте сервера (до открытия порта), в CI на каждый push, локально `npm run migrate`. `0001_baseline.sql` — снапшот текущей схемы, на самом проде не исполнялся (таблица заранее засеяна записью об этом файле), только на чистой БД (CI/локально). Заодно удалён `sql/ci-schema.sql` — его содержимое теперь и есть `0001_baseline.sql`, поддерживать два файла с одной и той же схемой смысла не было |
| **17.5.1** | Хотфикс: 17.5.0 крашлупился на реальном деплое (`restartPolicyType: ON_FAILURE`, Railway ретраил старт раз в секунду) — миграции лежали в `sql/migrations/` на корне репозитория, а Root Directory сервиса на Railway = `backend`, всё, что снаружи, в контейнер не попадает вообще. Перенесены в `backend/migrations/`. Заодно найден и починен смежный баг, который вскрылся при отладке: `set_config('search_path','',false)` внутри `0001_baseline.sql` (стандартный pg_dump) не транзакционный — переживает даже `ROLLBACK` — и «протекал» на весь пул соединений: следующий случайный запрос, который доставал ту же переиспользуемую коннекцию из пула, падал с «relation X does not exist» на ровном месте. `RESET search_path` теперь явно вызывается перед возвратом клиента в пул. Старый (17.4.0) деплой всё это время продолжал обслуживать реальный трафик — простоя не было |
| **17.6.0** | Алерт в рабочий чат при падении миграции или старта сервера (`alertAndExit()` в `index.ts`, переиспользует уже существовавший, но нигде не подключённый `notifyAdmin()` из `bot/index.ts`) — раньше единственным сигналом были Railway logs, которые никто не смотрит проактивно, именно так сегодня и нашли баг 17.5.0. Таймаут 5с на отправку, чтобы недоступность Telegram не подвесила сам выход из процесса |
| **17.7.0** | Пользователь принёс security-чеклист от стороннего ИИ — большая часть уже была закрыта этим сеансом или неприменима к масштабу проекта, но сплошной проход по всем `PATCH/PUT/DELETE` подтвердил самое главное подозрение и нашёл реальный захват аккаунта: `POST /me/bind` брал telegram_id из тела запроса, а не из подтверждённой Telegram initData — любой мог отвязать чужой telegram_id (в т.ч. admin) и привязать свой, без единой авторизации. Плюс ещё 8 эндпоинтов без проверки сети (`PATCH/DELETE /employees/:id` и `/stores/:id`, `PATCH /employees/:id/role`, `DELETE /schedules`, `GET/PUT /plans/employees/:id/month`, approve/reject заявок на доступ), `PUT /supervisor/:id/sector` сужен до admin (межсетевые полномочия), удалены 2 неиспользуемых уязвимых дубликата эндпоинтов, `employees.telegram_id` получил `UNIQUE` (закрывает race condition в bind/approve — были не в транзакции). 121 тест изоляции |
| **17.8.0** | Оставшиеся 2 пункта из внешнего чеклиста. CORS (`origin: true` → `origin: false`) — фронтенд всегда бьёт на API своим же origin (`window.location.origin`), легитимного кросс-origin браузерного вызова нет; проверено вживую через Playwright (свой origin работает, чужой блокируется). `EXPLAIN (ANALYZE, BUFFERS)` на проде по самым частым запросам подтвердил: `stores`/`employees` без индекса на `org_id` вообще — каждый org-scoped запрос сеанса Seq Scan; сейчас незаметно (7×7 строк), но первое, что упрётся при росте, особенно в N+1-циклах (`getLiveNetworkMap`, `calculateAllBFQ` — по 4 запроса на точку/сотрудника). Добавлены индексы (`stores.org_id`, `employees.org_id`, `sales`/`schedules(store_id, дата)`); сами N+1-циклы намеренно не трогали — преждевременная оптимизация при текущих объёмах (`supervisor-analytics.ts` уже показывает, как это делать правильно — батчем на весь сектор, 16.3.0) |
| **17.9.0** | Начало аудита корректности бизнес-операций (не security-изоляция, а «может ли система прийти в состояние, невозможное в реальной работе»). Первая находка: три места записи продажи (форма, быстрый текстовый ввод, офлайн-очередь) были тремя разошедшимися кусками SQL — только форма писала пол через `GREATEST(0, ...)`, только форма и очередь писали в `sales_audit`/heatmap, быстрый ввод не уведомлял чат вообще. Сведены в один `applySaleUpsert()` (`services/sales-write.ts`). Ни одна точка входа не защищала от повторной отправки — двойной тап или сетевой ретрай после «потерянного» ответа удваивал сумму (запись аддитивная); теперь форма и быстрый ввод тоже принимают `client_id` (тот паттерн, что раньше был только у офлайн-очереди), кнопка дизейблится на тап, а очередь переиспользует `client_id` формы вместо генерации своего — иначе дедуп ломался ровно в сценарии «запрос дошёл, ответ клиент не увидел». 7 новых тестов, итого 128 |
| **17.10.0** | `/shifts/open`/`/shifts/close` ничем не были ограничены по числу вызовов в день — каждый close начислял полную награду (XP + бейджи + streak_days) заново, можно было бесконечно фармить прогресс одним спамом кнопки без единой реальной продажи. Награда теперь не более раза за календарный день; сама смена по-прежнему закрывается нормально каждый раз. Заодно найден смежный скрытый баг: `toDateISO()` читал pg `date`-колонку через `getUTC*()`, хотя node-postgres парсит её в полночь ПО ЛОКАЛЬНОМУ времени процесса — на проде (контейнер в UTC) не проявлялось, но сдвигало дату на день назад при любом локальном TZ восточнее UTC (в т.ч. Europe/Moscow — таймзона самого проекта). Заменено на локальные геттеры. 9 новых тестов, итого 136 |
| **17.11.0** | Настоящие гонки (не последовательный спам, а параллельные запросы) в открытии/закрытии смены. `/shifts/close`: два одновременных запроса на закрытие одной сессии оба награждали XP — гейт из 17.10.0 не ловил гонку с самим собой. Переход в `closed` теперь атомарный compare-and-swap; проигравший получает уже закрытую сессию без повторной награды. `/shifts/open`: два одновременных запроса могли создать два «открытых» сеанса для одного сотрудника — добавлен partial unique index, проигравший получает сессию победителя. 2 новых теста с реальными параллельными запросами, итого 138 |
| **17.12.0** | `store_plans` (дневной снапшот плана точки — источник данных для BFQ, live-карты, дашборда, отчётов, supervisor-аналитики) материализуется только кроном в 6:00 МСК. Правка плана точки (`PUT /plans/stores/:id/month`) снапшот не трогала — новые цифры были видны сразу только в `GET /plans/stores/daily` (единственный живой расчёт), всё остальное показывало бы вчерашний план вплоть до следующего утра. Теперь снапшот на сегодня/завтра пересчитывается сразу после сохранения плана. 1 новый тест, итого 139 |
| **17.13.0** | Самая серьёзная находка за весь заход: BFQ (Качество/Прибыль сотрудника) считал план из `store_plans WHERE plan_date IS NULL` — строки, создающейся ОДИН РАЗ нулями при создании точки и не обновляющейся больше нигде в коде. Реальный, редактируемый план сотрудника (`employee_month_plans`) в расчёт BFQ не попадал никогда — сколько бы менеджер ни менял план через `PUT /plans/employees/:id/month`, BFQ считал против фантомного нулевого плана, что делало коэффициенты качества/прибыли оторванными от реальных целей практически у всех сотрудников. Теперь BFQ берёт план из того же живого источника, что и остальные /plans-эндпоинты — правка видна сразу. Ничего не нужно исправлять в старых данных: BFQ нигде не сохраняется, считается заново на каждый запрос. 1 новый тест, итого 140 |
| **17.14.0** | Две дыры целостности при увольнении сотрудника. `POST /me/bind` не проверял `is_active` целевой карточки и сам же реактивировал её на любой bind — employee_id маленький и последовательный, легко угадать/запомнить: кто угодно руками мог привязать свой Telegram к карточке уволенного и унаследовать всю его историю продаж/BFQ/XP. Теперь бинд на деактивированную карточку — 409, реактивация только осознанным действием менеджера. `DELETE /employees/:id` (soft-delete) не чистило будущие смены — уволенный продолжал бы висеть в завтрашнем графике и учитываться в покрытии точки; теперь будущие смены удаляются при увольнении, прошлые (реальная история) остаются нетронутыми. 3 новых теста, итого 142 |
| **17.15.0** | Симметрично 17.14.0: `DELETE /stores/:id` (закрытие точки) тоже не чистило будущие смены на ней — сотрудники продолжали бы висеть в графике закрытой точки. Прошлые смены (история) не трогаем, будущие удаляются при закрытии. `PATCH`/`DELETE /stores/:id` подтверждены как чистый soft-delete без каскада — исторические продажи/смены на удалённой точке в безопасности по построению. 1 новый тест, итого 143 |
| **17.16.0** | Micro/итоговые фото-отчёты в чат и напоминания «завтра смена» не были защищены от повторной отправки — deploy-окно Railway (старый контейнер жив, пока новый не пройдёт healthcheck) или ручная кнопка «отправить сейчас», совпавшая по минуте с автоматическим тиком, могли задвоить фото в чате. Новая `cron_send_log` — claim по ключу точка+дата+час перед каждой автоматической отправкой, тот же паттерн, что `offline_sync_log`/`client_id` (17.9.0); ручная кнопка намеренно не участвует в claim — это осознанное действие менеджера. 4 новых теста, итого 147 |
| **17.17.0** | Последний пункт аудита корректности: денежная точность. Проверено (не проигнорировано) — все денежные/дробные колонки на `numeric`, ни одной на `real`/`double precision`; единственные float-колонки во всей схеме — GPS-координаты, где это уместно. Суммирование всегда на стороне SQL — классический `0.1 + 0.2 !== 0.3` не воспроизводится в принципе. Фикса не потребовалось, архитектура уже была безопасна — 2 новых теста фиксируют это как регресс-гвард (типы колонок + end-to-end: 10.1+20.2+5.05 = ровно 35.35). Итого 149 — этим закрывается весь список бизнес-корректности перед 18.0 Core Freeze |
| **18.0.0** | **Core Freeze.** Эпоха 18 открывается фиксацией ядра (не новой фичей): auth/Telegram, multi-tenant, RBAC, employees, stores, shifts, sales, plans, cash, BFQ, offline sync, cron, audit — всё под 149 регресс-тестами, после эпика 17.0 «Надёжность перед деньгами» (17.9.0–17.17.0). После 18.0 ядро меняется только контролируемо, с regression tests — дальше roadmap идёт в продуктовые эпики |
| **18.1.0** | **Command Center.** Первый продуктовый эпик: единый экран manager/supervisor/admin вместо трёх разрозненных мест (виджет на главной, live-карта, кабинет супервайзера) — что происходит / где проблема / что делать. Новый `GET /command-center` не дублирует расчёты, собирает существующие `buildSupervisorDashboard()` и `smart_alerts` (кассовые разрывы/простой часа — работали, но фронт их нигде не показывал) в один ответ. Новое: `findUnderperformingEmployees()` — персональная просадка (0 продаж при работающих коллегах), не только по точке. Действия ведут на существующие экраны, ничего не дублируем; conversion и задачи из проблемы — намеренно вне скоупа (нет данных о трафике, задач ещё нет — это 18.2). 6 новых тестов, итого 155 |
| **18.2.0** | Новый блок «Сводный график команды» на вкладке График (manager/senior/admin) — весь месяц одной таблицей с указанием точки на каждый рабочий день (важно при подменах — видно, кто где именно в этот день). Метрика НВ добавлена в «Блок GI» на вкладке План. Pull-to-refresh больше не срабатывает случайно на обычном скролле к началу страницы — жест теперь отслеживается целиком, а не только по началу/концу касания, плюс видимый индикатор и cooldown. Анонс релиза в чат мог продублироваться при деплое (реально случилось с 18.1.0) — тот же claim-паттерн, что уже чинил дубли cron-отчётов (17.16.0), теперь и здесь. 4 новых теста, итого 159 |
| **18.3.0** | Личный помесячный график сотрудника (под сводной таблицей) шёл просто по порядку 1..30/31 без выравнивания по дням недели — непонятно было, где выходные. Теперь настоящая календарная сетка: понедельник первой колонкой, дни соседних месяцев — серые, полупрозрачные, некликабельные, день 1 в своей настоящей колонке, сверху подпись дней недели |
| **18.4.0** | **Tasks / Action System.** Замыкает цикл данные → alert → action → задача → результат, который Command Center (18.1) начал, но не заканчивал — его кнопки действий теперь умеют создавать задачу с предзаполненным контекстом, а не только открывать существующие экраны. Менеджер создаёт и назначает задачу — сотрудник получает Telegram-сообщение и видит её на «Моём дне», берёт в работу/отмечает выполненной, менеджер получает сообщение обратно, когда задача закрыта. Новая страница «Задачи» — список по сети с фильтрами и тредом комментариев (он же история статусов). Архитектура зеркалит уже отработанный `support_tickets` + `support_messages`. 15 новых тестов, итого 174 |
| **18.5.0** | **Store Intelligence.** Профиль точки впервые в проекте — план/факт/прогноз, тренд, задачи и алерты на одном экране, открывается из live-карты или Command Center. Store Health Score — объяснимая композиция (план/темп дня/штат/касса), без выдуманных Revenue/Conversion/Avg check — данных о трафике и деньгах в системе нет, разбивка компонент готова принять пятое измерение, когда источник трафика появится. Попутно найден и исправлен реальный баг: тренд по точке/сети был ВСЕГДА пустым с момента появления этого расчёта (дата из Postgres приводилась к строке через `String(dateObject)`, получая нечитаемое "Tue Aug 11" вместо ISO-формата) — молча ломало график тренда и в кабинете супервайзера тоже. 6 новых тестов, итого 180 |
| **18.6.0** | **Alerts 2.0.** Полный жизненный цикл алерта вместо open→acked — добавлены in_progress/dismissed, новая страница «Алерты» с фильтрами и деталями, кнопка «Взять в работу» прямо в Command Center. Задача, созданная из алерта, теперь сама закрывает его при выполнении. Попутно найден и исправлен третий за вечер баг того же класса (после 17.16.0 и 18.2.0): `insertAlertOnce()` была неатомарной SELECT+INSERT-проверкой — при деплое оба перекрывшихся контейнера могли создать дубль и оба уведомить admin, вероятный источник жалобы «менеджер получает 15 одинаковых alerts» из роадмапа. Атомарный `INSERT ... ON CONFLICT DO NOTHING` по partial unique индексу. 8 новых тестов, итого 188 |
| **18.7.0** | **Shift 2.0.** Смена — объект с памятью вместо пары timestamp'ов. При открытии сотрудник сразу видит план на сегодня, свои открытые задачи и заметку-передачу от предыдущей смены на этой точке, если она была оставлена. Пока смена открыта, карточка на «Моём дне» показывает живой прогресс план/факт — раньше факт дня считался только один раз, в момент закрытия. При закрытии можно оставить заметку для следующего, кто откроет смену на этой точке. Расчёт план/факт дня вынесен в переиспользуемый `services/shift-pace.ts` и используется одной формулой в open/current/close. 4 новых теста, итого 192 |
| **18.8.0** | **Employee 2.0.** Профиль сотрудника впервые в проекте — BFQ, геймификация, история смен и объяснимый Employee Health Score (план/идеальные смены/явка/стабильность) на одном экране, вместо прежней карточки с одним лишь планом/фактом на сегодня. Прямой аналог Store Health Score (18.5), только для сотрудника — никакого нового расчётного движка, только сборка уже существующих BFQ/геймификации/истории смен в одном месте. Открывается кнопкой «Профиль →» в существующей карточке сотрудника или из Command Center. 5 новых тестов, итого 197 |
| **18.9.0** | **Reports.** Новая страница «Отчёты» собирает разбросанную по интерфейсу отчётность (SVG-картинка точки, CSV-экспорт) в одном месте, плюс то, чего не было вообще — недельная/месячная сводка по сети (план, темп, лучшие/отстающие точки), переиспользующая тот же `buildSupervisorDashboard()`, что Command Center и Store Profile. Автоматически по понедельникам и 1-го числа в 09:00 МСК, плюс ручная кнопка. Рассылка защищена тем же atomic-claim паттерном, что уже трижды закрывал дубли в этой эпохе (17.16.0/18.2.0/18.6.0). 6 новых тестов, итого 202 |
| **18.10.0** | **UX/polish.** Профиль точки и профиль сотрудника были тупиковыми экранами — открывались с конкретным id (карточка/live-карта/Command Center), после чего вернуться было некуда, кроме нижней навигации, которая не помнит источник. Кнопка «‹ Назад» теперь ведёт туда, откуда реально открыли. Кнопки смены статуса задачи/алерта и отправки сетевой сводки блокируются на время запроса — тот же паттерн, что у формы добавления продажи, защита от двойного тапа. Только фронтовые изменения |
| **18.11.0** | Анонс новой версии теперь уходит только в выделенный Telegram-канал вместо общего рабочего чата сети — решение владельца продукта. Продажи/алерты/отчёты не тронуты, поменялся только адресат анонсов: один явный `RELEASE_CHANNEL_ID` вместо перебора `organizations.chat_id` с фолбэком на глобальный `CHAT_ID` |
| **19.1.0** | **Forecast v2 — эпоха 19 (Intelligence).** Попутно найден и исправлен реальный баг: страница «Прогноз» точки использовала более старую, менее защищённую версию модели прогноза, чем месячный прогноз кабинета супервайзера (не заполняла пропущенные дни нулями, не клэмпила выбросы на денежных метриках) — обе версии сведены в одну переиспользуемую модель, баг закрыт сразу везде. Страница «Прогноз» получила визуал формы недели и короткое AI-объяснение прогноза (Groq) — сначала расчёт, потом объяснение поверх него, не наоборот. 7 новых тестов, итого 209 |
| **19.2.0** | **Anomaly Detection.** Новый тип алерта `anomaly_vs_forecast` — единственный триггер smart_alerts, сравнивающий вчерашний день со статистически типичным для этой точки в этот день недели (z-score против forecast-модели 19.1), а не с планом или фиксированным порогом. Ловит обе стороны — и провал, и необычный всплеск (раньше ни один триггер не отмечал хорошие дни). Ноль новой инфраструктуры — переиспользует весь workflow Alerts 2.0 как есть, просто новый alert_type на уже тикающем таймере. 8 новых тестов, итого 217 |
| **19.3.0** | Расчёт комбо: сумма в формуле 1900 → 1950. Новый калькулятор «Школа» (цена − 70% + 30% от цены + 3600 + 3490). Убрана кнопка «Записать дневные планы в БД» — обе ситуации, ради которых её нажимали, давно автоматизированы (ежедневный крон 6:00 МСК + мгновенный пересчёт при правке плана точки), кнопка была мёртвым кодом |
| **19.4.0** | **Главная и Профиль — первый батч UX-правок.** «Мой день» показывает все метрики с ненулевым дневным планом (не жёстко зашитую пятёрку). «Мой день» и «Сеть сегодня» объединены в один слот со свайпом между ними (переиспользуемый жест, пригодится для свайпа между вкладками позже). Над «Мой день» — код и адрес точки (или «Выходной»). В Профиле убраны дублирующие блоки «Факт / план дня» и «Мои продажи сегодня», кольцо «Сегодня» скрыто на выходной, «Прогресс за месяц» в карточном стиле, добавлена «История твоих продаж». Из «Быстрых действий» убраны «Добавить продажу» и «Кто на смене сегодня». Вкладки «Главное»/«Мой» переименованы в «Главная»/«Профиль» |
| **19.5.0** | Правки по отзывам на 19.4.0. Свайп-карточка «Мой день»/«Сеть сегодня» больше не растягивается под высоту длинной панели — заодно нашёлся и убран настоящий баг с лишним `overflow:hidden` на треке, ломавший отрисовку только что появившейся панели. «Прогресс за месяц» в Профиле переведён на формат «Блок GI/Товарка/Ростелеком/Кредиты» с барами факт/план — как на карточке точки в «План», а не числовая сетка. Шапка приложения больше не перекрывается плавающими системными кнопками Telegram на части клиентов — учтён `contentSafeAreaInset` |
| **19.6.0** | **Навигация и жесты.** Карточки точек в «План» больше не разворачивают первую по умолчанию — все свёрнуты. Лёгкий свайп между вкладками нижней навигации (с анимацией перехода, без живого перетаскивания страницы) — с защитой от срабатывания поверх модалок/обучения и внутри горизонтально прокручиваемых блоков. Модалка добавления продажи закрывается свайпом вниз за ручку/заголовок; заодно закрыт побочный баг с pull-to-refresh, который мог сработать в фоне при свайпе по открытой модалке |
| **19.7.0** | **Кастомные названия точек, аватарки, визуал графика и касса.** Руководители/старшие продавцы могут задать точке кастомное название — подменяет обычное имя везде в мини-аппе (не в Telegram-сообщениях). Кастомная аватарка загружается из Профиля и видна в шапке и в Команде — раньше Команда показывала только буквы-инициалы. Сводный график сети перекрашен в тот же цветной язык, что и календарная сетка на той же странице. Вкладка «Касса»: «Внести кассу» наверху, только 2 последних дня видны сразу, сама вкладка переехала в «Быстрые действия» первым пунктом. 8 новых тестов, итого 225 |
| **19.8.0** | **Google Sans, иконки вместо эмодзи, Android-hardening.** Шрифт приложения — Google Sans (легально лицензированный OFL-дистрибутив). Весь эмодзи-набор (119 вхождений, 62 уникальных) заменён на line-иконки Lucide — маскот «Арбузыч» и типографские стрелки в тексте оставлены как есть, цветные точки-статусы переведены на CSS-кружки. Android-hardening без привязки к конкретным багам: viewport-fit=cover, overscroll-behavior против конфликта с pull-to-refresh, 100dvh точнее 100vh |
| **19.9.0** | Подпись к картинке анонса версии в Telegram-канале теперь несёт заголовок и все пункты обновления целиком, а не короткую строку — не нужно отдельно открывать картинку, чтобы прочитать, что изменилось. Длинные релизы аккуратно обрезаются по границе слова под лимит Telegram в 1024 символа |
| **19.10.0** | Новое оформление карточки анонса — цветной градиентный блок-заголовок с крупным номером версии, скруглённая карточка, список изменений снизу, шрифт Google Sans. Все прошлые анонсы перегенерированы и переотправлены в канал в новом виде |
| **19.11.0** | Аудит контроля доступа: усилена авторизация на ряде эндпоинтов (identity — только из подтверждённой Telegram-подписи, запись/чтение — строго в рамках своей сети), аккуратные ответы об ошибке вместо падения сервера на некорректных входных данных. 26 новых регрессионных тестов (`tests/adversarial/`), итого 255 |
| **19.12.0** | Убраны свайп между вкладками нижней навигации и pull-to-refresh (обновление вытягиванием страницы сверху) — по прямому запросу владельца продукта. Обновить страницу по-прежнему можно кнопкой ↻ в шапке |
| **19.13.0** | Код точки и адрес в шапке приложения (рядом с датой). Живой индикатор «Смена открыта/закрыта» и бейдж «N дн. до выходного» на карточке приветствия. «Промокоды РТК» продублированы широкой кнопкой в блоке «Калькуляторы». Убран дублирующий пункт «План дня по точкам» из Быстрых действий, «Сеть за месяц» переименована в «Динамика выполнения по сотрудникам» |
| **19.14.0** | **Rate limiting, security headers, прод-гварды.** `@fastify/rate-limit` на всё API (общий потолок + жёсткие лимиты на публичную аватарку/отчёты/заявку на доступ), `@fastify/helmet` (CSP и другие заголовки, подобрано под встраивание в Telegram и под onclick/style-атрибутную вёрстку фронтенда). Сервер отказывается стартовать в проде без `BOT_TOKEN` или с `ALLOW_INSECURE_AUTH=true`. Срок жизни Telegram-сессии — 1 час вместо суток, при истечении понятное сообщение вместо голого 401. Загрузка аватарки проверяется по magic bytes реального файла, а не по заголовку от клиента; SVG больше не принимается. `@fastify/static` обновлён до версии, закрывающей несколько известных уязвимостей обхода пути |
| **19.15.0** | **Единый обработчик ошибок, аудит в CI, контекстные логи.** Глобальный Fastify `setErrorHandler` мапит известные коды ошибок Postgres (дубликат → 409, некорректный формат → 400 и т.п.) в стабильный JSON вместо голого 500 с сырым текстом драйвера; 16 роутов, отвечавших клиенту тем же сырым текстом вручную, переведены на общий безопасный хелпер. CI падает при известной уязвимости высокой критичности в зависимостях (`npm audit --audit-level=high`). Логи сервера несут `employee_id`/`org_id` на каждой строке запроса |
| **19.16.0** | `stores.id` получил настоящий `PRIMARY KEY` — найдено живой проверкой нового error handler (19.15.0): дубликат id точки тихо создавал вторую строку вместо ошибки. В проде дублей не было, миграция накатилась без изменения данных |
| **19.17.0** | **Tenant-check как декораторы роутов.** 18 write/read-роутов переведены с ручного вызова `assertStoreInOrg`/`assertEmployeeInOrg` внутри тела обработчика на `requireStoreInOrg()`/`requireEmployeeInOrg()` — preHandler-декораторы в опциях роута, которые нельзя случайно забыть в новом коде (именно так были упущены дыры 19.11.0). Поведение не изменилось: 255/255 тестов прошли без расхождений. Роуты, где store/employee id узнаётся только после fetch внутри самого обработчика, или где self-write/manager-for-other разруливается по-разному — оставлены с ручной проверкой намеренно (декоратор технически не может знать эту логику заранее) |
| **19.18.0** | **Типизированная валидация — первый заход.** TypeBox-схемы (`schema.body` на уровне роута, Fastify/ajv валидирует до входа в обработчик) на самых денежных/расписательных write-эндпоинтах: `/sales`, `/sales/:id/zero`, `/cash`, `/schedules`, `/schedules/bulk`, `/shifts/open`, `/shifts/close`, `/sales/parse`, `/sales/quick`, `/sync/batch`. Некорректный запрос отвечает понятной ошибкой (`validation_failed` + список того, что именно не сошлось) сразу, а не падает по пути к базе. Остальные ~25 write-роутов — следующими заходами |
| **19.19.0** | TypeBox-схемы на роутах доступа/ролей и CRUD сотрудников/точек (`/access/request`, approve/reject, назначение роли и сектора, `/employees`, `/stores`, `/me/bind`). Попутно найден и исправлен реальный регресс, который сам процесс подключения схем чуть не внёс: `ajv` (встроен в Fastify, `coerceTypes: true`) по умолчанию тихо превращает `null` в `0` для числовых полей — открытие/закрытие смены без геолокации едва не начало писать координаты `0,0` вместо честного «геолокации нет». Пойман до продакшена живой проверкой, не постфактум |
| **19.20.0** | TypeBox-схемы на задачах (создание/комментарии/статус/переназначение), тикетах поддержки, промокодах РТК, объявлениях и каналах сети — на этот раз все места, где фронтенд намеренно шлёт `null` (сброс дедлайна задачи), проверены заранее по урокам 19.19.0 |
| **19.21.0** | **Переход на TypeBox завершён.** Последний заход — алерты, what-if сценарии, кастомные метрики, месячные планы, ручная отправка отчётов, сеть/бренд (админ), обучение; попутно найдены и закрыты два роута (BFQ: VMR+штраф, анкета), пропущенные более ранним заходом. `request.body as any` в write-роутах закрыт по всему API |

---

## 22. Дорожная карта

Крупные эпохи проекта — не текущий спринт, а последовательность уже
пройденных и будущих этапов.

### Эпоха 17 — «Надёжность перед деньгами» ✅ (17.0.0-17.17.0)
CI на каждый push, тестовый слой авторизации/изоляции сети (149 тестов к
концу эпохи), система миграций, аудит бизнес-корректности (гонки при
открытии/закрытии смены, идемпотентность продажи, денежная точность,
целостность при увольнении). Закрывает почву перед продуктовыми эпохами.

### Эпоха 18 — Command Center suite ✅ (18.0.0-18.11.0)
`18.0` Core Freeze (фиксация ядра под регресс-тестами) → `18.1` Command
Center → `18.2` сводный график команды → `18.3` календарная сетка графика
→ `18.4` Tasks/Action System → `18.5` Store Intelligence (Health Score) →
`18.6` Alerts 2.0 → `18.7` Shift 2.0 (память смены) → `18.8` Employee 2.0
(Health Score) → `18.9` Reports → `18.10` UX-полировка навигации →
`18.11` анонсы версий в отдельный канал.

### Эпоха 19 — Intelligence ✅ частично (19.1.0-19.2.0)
`19.1` Forecast v2 (единая SES-модель + AI-объяснение) → `19.2` Anomaly
Detection (z-score против прогноза). Дальше эпоха не продолжилась своим
изначальным курсом — вместо следующих AI-фич владелец продукта переключился
на большой список UX-правок и security-аудит (ниже), реальная ценность
эпохи Intelligence на этом не закрыта, а поставлена на паузу.

### После 19.2 — UX-батчи и security-аудит ✅ частично (19.3.0-19.21.0)
22-пунктовый список UX-правок от владельца продукта, отгружен батчами:
Главная/Профиль (19.4-19.5), навигация и жесты (19.6, позже часть — свайп
между вкладками и pull-to-refresh — убрана обратно по отзыву, 19.12),
кастомные названия точек/аватарки/график/касса (19.7), Google Sans + иконки
Lucide вместо эмодзи + Android-hardening (19.8), новое оформление карточки
анонса (19.9-19.10). Отдельно — аудит контроля доступа нашёл и закрыл
реальные дыры авторизации (19.11.0, 26 регресс-тестов). Живая
UX-полировка по ходу использования продолжается (19.13.0). Второй раунд
security/архитектурного ревью (20 пунктов) закрыт несколькими заходами: rate
limiting, security headers, прод-гварды на insecure-auth/BOT_TOKEN, короче
срок жизни сессии, magic-bytes на аватарке, зависимости без известных
уязвимостей (19.14.0); единый Fastify error handler с маппингом ошибок
Postgres, аудит зависимостей как gate в CI, контекстные логи (19.15.0,
попутно найден и закрыт баг с отсутствующим `PRIMARY KEY` на `stores.id`,
19.16.0); tenant-check (`assertStoreInOrg`/`assertEmployeeInOrg`) переведён
на preHandler-декораторы на 18 роутах — нельзя случайно забыть в новом коде
(19.17.0); **TypeBox-валидация всех write-роутов** — продажи/касса/график/
смены (19.18.0), доступ/роли/CRUD сотрудников и точек (19.19.0, попутно
пойман и закрыт реальный regression с ajv-коэрсией null→0 на координатах
геолокации), задачи/поддержка/промокоды/объявления (19.20.0), алерты/what-if/
метрики/планы/отчёты/бренд сети (19.21.0, попутно найдены и закрыты два
BFQ-роута, пропущенных ранним заходом) — `request.body as any` в write-роутах
закрыт по всему API, весь эффект **готов** ✅. Оставшиеся пункты того же
ревью — слой доступа к данным, frontend TypeScript+Vite, полный audit trail,
кэш supervisor-scope и т.п. — крупнее по объёму и ждут отдельного
приоритетного захода, не сделаны одним махом умышленно.

### Дальше — эпоха 20, «Unified Platform»
Ещё не начата, точный состав не определён. Известное ограничение от
владельца продукта: **платёжные функции — вне скоупа**, не рассматриваются.
Продолжится по мере поступления конкретных задач — тем же циклом
исследование → план → реализация → верификация → отгрузка, что и весь
предыдущий путь.

---

## 23. Соглашения по разработке

1. Фичи — свой `routes-<имя>.ts` (по теме, не по версии — `routes-vN`
   давно не используется) + добавить в `routeModules` в `app.ts`
2. Даты только МСК (`todayMoscow()`, не `new Date()`/UTC контейнера)
3. Изменение схемы БД — новый `backend/migrations/00NN_описание.sql`, не
   ad hoc SQL на Railway (см. §18)
4. Перед push: `npx tsc --noEmit`, `npm run smoke:frontend`, полный
   `npx vitest run` на одноразовом локальном Postgres — build ловит
   TS-ошибки бэкенда, smoke:frontend ловит ReferenceError от неправильного
   порядка `frontend/js/*.js` (см. 14.3.1), тесты — регресс авторизации/
   изоляции сети/бизнес-корректности/security
5. Не коммитить `.env`
6. Роуты, отдающие чужие/сетевые данные — всегда через `requireAuth`/
   `requireActive`/… + org-scope (§7, §24), никогда голый заголовок в обход
   `authPlugin`
7. Один bot polling (`BOT_POLLING=false` для второй локальной копии)
8. Версионирование — MINOR на каждую сущностную правку (фича, фикс,
   рефактор), changelog-запись в `src/changelog.ts` только для эпиков,
   не хотфиксов (см. §21 — история версий длиннее, чем changelog-анонсы)

---

## 24. Безопасность

- Роли и принадлежность сети проверяются на сервере (`middleware-auth.ts`),
  не только скрываются в UI — `requireAuth`/`requireActive`/`requireManager`/
  `requireSupervisor` + `assertStoreInOrg`/`assertEmployeeInOrg` на каждом
  роуте, читающем или пишущем чужие данные.
- **initData проверяется на сервере.** Mini App шлёт сырой `tg.WebApp.initData`
  в заголовке `X-Telegram-Init-Data`; глобальный `preHandler`-хук `authPlugin`
  (навешан один раз в `app.ts`, выполняется перед каждым роутом) пересчитывает
  HMAC по `BOT_TOKEN` (`src/services/telegram-auth.ts`) и кладёт в
  `request.user` подтверждённую identity — только если подпись сходится.
  Голый `X-Telegram-Id` без initData принимается ТОЛЬКО если `BOT_TOKEN` не
  задан (локальная разработка) либо явно включён `ALLOW_INSECURE_AUTH=true`
  — в `RAILWAY_ENVIRONMENT=production` сервер вообще откажется стартовать
  и с `ALLOW_INSECURE_AUTH=true`, и без `BOT_TOKEN` (`src/index.ts`, 19.14.0),
  так что это не просто конвенция, а жёсткий гварт. `request.user` —
  единственный источник identity во всех роутах; читать заголовок напрямую
  в обход `authPlugin` считается багом (класс дыр, закрытый в 19.11.0).
  Сама initData-сессия живёт 1 час (было 24, снижено в 19.14.0 по
  рекомендации Telegram) — по истечении роут отвечает понятным
  `session_expired`, а не голым 401.
- CORS **закрыт** (`origin: false`, с 17.8.0) — Mini App всегда бьёт на API
  своим же origin, легитимного кросс-origin браузерного вызова нет.
- `@fastify/rate-limit` (19.14.0) — общий потолок на всё API + отдельные
  более жёсткие лимиты на публичную аватарку, генерацию отчётов и заявку на
  доступ. `@fastify/helmet` (19.14.0) — CSP и другие заголовки безопасности;
  CSP разрешает inline-обработчики (`script-src-attr`/`style-src-attr`), так
  как вёрстка держится на `onclick=`/`style=`-атрибутах — переход на
  строгую CSP требует более крупной переделки фронтенда (см. дорожную
  карту, §22).
- 26 регрессионных тестов на именно этот класс дыр (`backend/tests/adversarial/`)
  — не проверка «работает ли», а фиксация конкретных прошлых инцидентов
  (auth bypass, unauthenticated disclosure, cross-tenant IDOR, identity
  spoofing), чтобы не повторились молча.
- Глобальный `setErrorHandler` (`app.ts`, 19.15.0) — известные коды ошибок
  Postgres (дубликат, ссылка на несуществующую запись, некорректный формат)
  превращаются в стабильный `{error, message}` без сырого текста драйвера;
  роуты со своим `catch` используют тот же принцип через
  `serverError()` (`src/utils/http-errors.ts`). CI падает на
  `npm audit --audit-level=high` — известная уязвимость высокой критичности
  в зависимостях блокирует мёрдж, а не остаётся незамеченной до следующего
  ручного аудита.
- `requireStoreInOrg()`/`requireEmployeeInOrg()` (`middleware-auth.ts`,
  19.17.0) — preHandler-декораторы поверх `assertStoreInOrg`/
  `assertEmployeeInOrg`, регистрируются в опциях роута вместо ручного вызова
  внутри тела обработчика. 18 роутов переведены; там, где store/employee id
  узнаётся только после fetch внутри самого обработчика или где self-write/
  manager-for-other разруливаются по-разному (см. 19.11.0), декоратор не
  подходит технически — оставлено с ручной проверкой намеренно, не забыто.
- TypeBox-схемы (`@sinclair/typebox`, 19.18.0) на `schema.body` роута —
  Fastify валидирует запрос своим встроенным ajv-компилятором ДО того, как
  управление доходит до обработчика, и до кода — `err.code ===
  'FST_ERR_VALIDATION'` в глобальном `setErrorHandler` превращает это в
  чистый `{error: 'validation_failed', details: [...]}`. Ajv по умолчанию
  коэрсит типы (строка "5" ↔ число 5, `true` ↔ `1`) — тот же уровень
  гибкости, что уже был у ручных `Number()`/`String()` по всему коду,
  никаких новых отказов на легитимных запросах. Отгружено 4 заходами: 10
  самых денежных/расписательных write-роутов (§21, 19.18.0), доступ/роли и
  CRUD сотрудников/точек (19.19.0), задачи/поддержка/промокоды/объявления
  (19.20.0), алерты/what-if/метрики/планы/отчёты/бренд сети (19.21.0) —
  **весь write-API теперь на TypeBox**, `request.body as any` не осталось.
  Динамические по форме тела (кастомные метрики продаж/планов, разнородные
  `sync/batch`- и `what-if moves`-операции, произвольные поля апдейта сети)
  сознательно оставлены `additionalProperties: true` — схема не должна быть
  строже уже отлаженной ручной логики внутри обработчика.
- **Ловушка ajv-коэрсии `null`** (найдена и закрыта в 19.19.0) — `coerceTypes:
  true` (Fastify-дефолт) превращает `null` в `0` для числовых полей и в `""`
  для строковых МОЛЧА, без ошибки валидации. Для полей, которые фронтенд
  реально шлёт как `null` намеренно (координаты геолокации при отказе в
  доступе — `geoCoords()` в `11-v13.js`; сброс кастомного названия точки —
  `16-store-profile.js`), это меняет смысл данных (терялось «геолокации
  нет», подменяясь на настоящую координату `0,0`). Фикс — `Type.Union([Type.Null(), Type.Number()])`
  С Null ПЕРВЫМ в объединении: ajv перебирает варианты по порядку и коэрсит
  на первом подходящем — если первым стоит `Type.Number()`, `null` домётся
  до него раньше `Type.Null()`. При добавлении новых полей в существующие
  или новые TypeBox-схемы, если фронтенд может прислать `null` намеренно
  (не просто «поле пропущено») — соответствующий тип обязан быть
  `Type.Union([Type.Null(), ...])`, иначе баг тихий и не даёт о себе знать,
  пока кто-то не заметит испорченные данные в проде.

---

## 25. Чеклист запуска с нуля

1. Postgres — схема накатывается сама миграциями при первом старте (§18), руками ничего не создавать
2. Env: `DATABASE_URL`, `BOT_TOKEN`, `ADMIN_TELEGRAM_ID`, chat id/thread id сети
3. Deploy backend, 1 реплика, деплой ждёт зелёный CI (§17)
4. BotFather Menu Button → URL сервиса
5. Admin: `access_status='active'` + свой `telegram_id` (§7)
6. Завести сеть (если не default) прямо в приложении — «Команда» → «Управление» → «Сети», без SQL
7. Точки, сотрудники, график, месячные планы сотрудников и точек — дневной снапшот материализуется сам (§10)
8. Mini App → обучение → тестовая продажа

---

**T2 Sales** — смена, цифры, сеть и AI Copilot в одном приложении.  
*README · актуально на v19.21.0 · август 2026*
