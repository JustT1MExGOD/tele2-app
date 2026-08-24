# Архитектура

> Извлечено из README §4/§5 при репо-реструктуризации (20.11.0). Живой
> справочник структуры — обновляется вместе с кодом; README §5 держит
> только короткую ссылку сюда.

## Быстрые факты

| | |
|---|---|
| **Backend** | Fastify + TypeScript, Node 22, layered (`api/` → `core/` → `data/`) |
| **БД** | PostgreSQL (Railway), схема только через `backend/migrations/` |
| **Frontend** | Классические `<script>`-файлы (`frontend/js/*.js`) + растущая typed-часть на Vite/iife (`frontend/src/`) |
| **Бот** | Grammy, long-polling, 1 реплика (см. [ADR/002](./ADR/002-supervisor-scope-cache-in-memory.md)) |
| **AI** | Groq (`llama-3.3-70b-versatile`), холодный путь — не в hot path запросов |
| **Хостинг** | Railway, `backend/` — Root Directory, миграции накатываются сами при старте |
| **Auth** | Telegram `initData`, HMAC на сервере — подробно в [SECURITY.md](./SECURITY.md) |

## Диаграмма

```mermaid
flowchart TB
    subgraph TG["Telegram"]
        MA["Mini App<br/>(frontend/*)"]
        CH["Bot chats"]
    end

    subgraph BE["Fastify backend (backend/src)"]
        AUTH["auth/<br/>guards.ts (authPlugin, preHandler) · identity/principal · providers/telegram"]
        API["api/routes/<br/>29+ route-модулей, сгруппированы по домену:<br/>me/ · org/ · analytics/ · ops/ · profiles/ · flat (sales/schedules/plans/…)"]
        CORE["core/&lt;domain&gt;/<br/>бизнес-логика: plans · bfq · sales/nlp · shifts/pace ·<br/>employees/gamification · analytics/* · alerts · reports"]
        DATA["data/repositories/ + data/db/<br/>Full Data Access Layer, 19.22.0→20.8.0 —<br/>единственный путь к Postgres для всего backend"]
        CRON["cron/<br/>reports.ts · digest.ts · alerts.ts · job-logger.ts"]
        INTEG["integrations/<br/>telegram/ (Grammy bot) · ai/ (Groq client)"]
        PLAT["platform/notifications/<br/>changelog · release-announce"]
    end

    PG[("PostgreSQL<br/>(Railway)")]
    GROQ["Groq API<br/>llama-3.3-70b-versatile"]

    MA -- "X-Telegram-Init-Data<br/>(подписанный, прод)" --> AUTH
    AUTH --> API --> CORE
    API --> DATA --> PG
    CRON --> CORE
    CORE --> DATA
    CORE -- "shift summary /<br/>dip hypothesis" --> INTEG
    INTEG -- Groq --> GROQ
    INTEG <--> CH
    API --> INTEG
    CRON --> INTEG
```

Клиент **не** ходит в БД напрямую — только через API. «Сегодня» всегда
через `todayMoscow()` (`Europe/Moscow`), не UTC контейнера. AI Copilot
(`integrations/ai/client.ts`) не в горячем пути запросов — вызывается
только при закрытии смены, в cron итоговых отчётов и при открытии
страницы «Прогноз» (кэшируется на день), no-op без `GROQ_API_KEY`. Рендер
SVG→PNG-картинок (отчёты, карточка анонса версии) — в отдельном пуле
`worker_threads` (`core/reports/svg-pool.ts` + `workers/svg-render.worker.ts`),
не блокирует основной event loop.

## Структура репозитория

```text
tele2-app/
├── README.md
├── CHANGELOG.md               (полная построчная история версий — README держит только последние)
├── CONTRIBUTING.md
├── docs/                      (этот файл + API.md/DEVELOPMENT.md/SECURITY.md/FEATURES.md/ADR/archive/…)
├── sql/                       (исторические ручные SQL-снимки, не источник схемы — см. sql/README.md)
└── backend/                  ← Root Directory на Railway
    ├── package.json
    ├── tsconfig.json
    ├── railway.json
    ├── migrations/               (пронумерованные .sql, применяются сами при старте — см. docs/DEVELOPMENT.md)
    ├── assets/fonts/             (DejaVu Sans — рендер SVG-отчётов; Google Sans TTF — та же resvg-карточка анонса)
    ├── tests/
    │   ├── setup.ts              (жёсткая проверка: DATABASE_URL только localhost/127.0.0.1)
    │   ├── helpers/               (app.ts → buildApp()+inject(), fixtures.ts → TestFixtures)
    │   ├── unit/                  (чистые функции: forecast-модель, job-logger, caption-builder…)
    │   ├── isolation/             (auth/multi-tenant регресс — org-scoping, race conditions, идемпотентность)
    │   └── adversarial/           (security-регресс: auth bypass, unauth disclosure, cross-tenant IDOR, identity spoofing)
    ├── src/
    │   ├── index.ts                     (bootstrap: миграции → buildApp() → listen → бот/крон — единственное место с side effects)
    │   ├── app.ts                       (Fastify instance: cors/helmet/rate-limit/static, регистрирует api/routes/index.ts)
    │   ├── env.ts                       (dotenv, импортируется первым — гарантирует порядок)
    │   ├── migrate-cli.ts               (CLI-обёртка над data/db/migrate.ts)
    │   │
    │   ├── auth/                        (20.9.0, Authentication Boundary — единственное место, знающее про Telegram)
    │   │   ├── identity.ts                (provider-agnostic Identity — {provider, providerId})
    │   │   ├── principal.ts               (Identity → Principal/AuthUser, диспетчеризация по provider)
    │   │   ├── guards.ts                  (authPlugin, requireAuth/requireActive/requireManager/…, org-scope декораторы — бывший middleware-auth.ts)
    │   │   └── providers/
    │   │       ├── telegram.ts              (resolveTelegramIdentity — заголовки/initData → Identity)
    │   │       └── telegram-verify.ts        (HMAC-проверка initData)
    │   │
    │   ├── api/routes/                  (HTTP-слой — тонкие обработчики, вся логика делегирована в core/)
    │   │   ├── index.ts                   (регистрация всех модулей — единая точка, дергается из app.ts)
    │   │   ├── sales.ts · schedules.ts · plans.ts · cash.ts · bfq.ts ·
    │   │   │   promos.ts · metrics.ts · audit.ts · shifts.ts       (плоские домены без вложенной группировки)
    │   │   ├── me/           (index.ts — identity/bind/day; avatar.ts)
    │   │   ├── org/           (employees.ts · stores.ts · access.ts — заявки/секторы · branding.ts — сети/пикер точек)
    │   │   ├── analytics/     (stats · forecast · insights · live · what-if · heatmap · command-center · supervisor)
    │   │   ├── ops/            (tasks · support · comms · reports · export · alerts)
    │   │   └── profiles/       (store.ts · employee.ts — Store/Employee Intelligence, Health Score)
    │   │
    │   ├── core/<domain>/                (бизнес-логика — из бывшего services/, теперь сгруппирована по домену)
    │   │   ├── sales/nlp.ts · shifts/pace.ts · plans/service.ts · bfq/service.ts
    │   │   ├── alerts/service.ts · employees/gamification.ts
    │   │   ├── analytics/     (forecast · anomaly · insights · heatmap · live-map · supervisor · network-digest · what-if)
    │   │   ├── reports/       (image.ts — SVG/PNG-рендер; svg-pool.ts — worker-пул)
    │   │   └── shared/        (tenant.ts — брендинг/сети; scope-cache.ts — Supervisor Scope Cache; metrics-catalog.ts)
    │   │
    │   ├── data/                         (Full Data Access Layer, 19.22.0→20.8.0 — единственное место с прямым SQL)
    │   │   ├── repositories/               (31 файл, по одному на таблицу/домен; orgId обязательным первым параметром
    │   │   │                                у tenant-функций; CI check:no-direct-sql запрещает откат на 56 файлах)
    │   │   └── db/                          (index.ts — пул + query() + withTransaction(); migrate.ts — раннер миграций)
    │   │
    │   ├── platform/notifications/       (changelog.ts — версии для автоанонса; release-announce.ts — CAS-защищённая отправка)
    │   ├── integrations/
    │   │   ├── telegram/                  (bot.ts — Grammy-инстанс, notifyChat/notifyAdmin; messages.ts — шаблоны сообщений)
    │   │   └── ai/client.ts               (Groq — AI Copilot)
    │   ├── cron/                         (alerts.ts · digest.ts · reports.ts · job-logger.ts — структурные pino-логи задач)
    │   ├── workers/svg-render.worker.ts  (resvg SVG→PNG в отдельном потоке)
    │   ├── shared/                       (api-types.ts — контракт бэк↔фронт; errors.ts — serverError(), бывший utils/http-errors.ts)
    │   └── utils/date.ts                 (todayMoscow() и другие МСК-хелперы)
    │
    └── frontend/
        ├── index.html    (разметка + подключение styles.css и js/*.js по порядку)
        ├── styles.css
        ├── fonts/        (Google Sans WOFF2 — фронтовый шрифт, отдельно от assets/fonts/ TTF для resvg)
        ├── src/          (typed-мир — Vite, каждый файл собирается в свой iife-бандл, см. ADR/006)
        │   ├── api-client.ts         (typed API-клиент — единственная точка сетевых вызовов для typed-мира)
        │   ├── app/router.ts          (registerPage/renderPage — typed-реестр страниц, НЕ URL/hash-based)
        │   ├── app/state.ts           (getSession() — читает легаси-глобал me, не дублирует источник правды)
        │   ├── pages/reports/          (первая полностью мигрированная страница, файл-в-файл вместо frontend/js/19-reports.js)
        │   ├── features/send-network-digest/  (первый addEventListener вместо onclick=)
        │   └── shared/legacy-globals.d.ts     (ambient-типы для глобалов легаси-мира — me, canManage(), toast() и т.д.)
        ├── js/           (легаси classic-script файлы, ещё не переехавшие — 19 из 20 экранов)
        └── offline-queue.js
```

**Frontend — два мира одновременно** (переезд начат в 20.12.0, не
закончен): `frontend/js/*.js` — классические non-module `<script>`, делят
одну глобальную область (порядок подключения важен, `smoke-frontend.mjs`
это проверяет); `frontend/src/` — настоящие ES-модули, типизированные,
собираются Vite'ом. Мост между мирами — `legacy-globals.d.ts` (typed-код
читает легаси-глобалы напрямую, не копирует их) и паттерн
`window.loadXPage = () => renderPage(name)` (легаси `switchPage()`
вызывает typed-страницу, ничего в диспетчере не меняя). **Критерий «файл
мигрирован»**: у него есть модуль в `frontend/src/pages/` или `features/`,
он собирается в свой `dist/pages/*.bundle.js`, и соответствующий файл в
`frontend/js/` удалён (не просто продублирован) — сегодня это только
`19-reports.js` → `pages/reports/`.

**Правило зависимости слоёв**: `api → core → data`, только в одну
сторону. `api/routes/*` может импортировать `core/` и `data/`; `core/*`
может импортировать `data/`, но не `api/` (и на деле не импортирует —
проверено); `data/repositories/*` в норме не должен импортировать из
`core/`/`api/` — репозиторий не должен знать, кто его вызывает. Правило
сегодня нарушено в 2 местах (не гипотетически, а по факту грепа):
`data/repositories/sales.ts` и `supervisor-analytics.ts` тянут функцию/тип
из `core/analytics/*` — известный, не скрытый долг, не фиксился отдельным
заходом ради самого правила, чинить заодно с содержательной правкой этих
файлов, не отдельным рефакторинговым PR.

**Правило регистрации роутов**: каждый модуль в `api/routes/` отвечает за
свой домен; добавление нового — новый файл + строка в
`api/routes/index.ts`'s `routeModules`, ничего в `app.ts` трогать не надо
(`app.ts` вызывает единственную функцию `registerAllRoutes()`).

**Правило доступа к БД**: только через `data/repositories/*` — ни один
файл вне `data/` не должен импортировать `query`/`pool` из
`data/db/index.js` напрямую (кроме `withTransaction()`, это оркестрация,
не сам SQL). `npm run check:no-direct-sql` — CI-ratchet, растёт по мере
переноса следующих файлов, не позволяет откат.

## Связанные документы

- [SECURITY.md](./SECURITY.md) — слои защиты поверх этой структуры (RBAC,
  Data Access Layer, аудит).
- [API.md](./API.md) — таблица эндпоинтов по модулям `api/routes/`.
- [DEVELOPMENT.md](./DEVELOPMENT.md) — как запустить и проверить локально.
- [ADR/](./ADR/) — почему структура именно такая, не другая.
