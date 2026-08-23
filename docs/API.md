# HTTP API

> Извлечено из README §14 при репо-реструктуризации (20.11.0), оформлено в
> справочный вид (таблица доступа, формат ошибок) при обновлении docs вслед
> за `SECURITY.md` (20.13.0). Полное поведение проверок — там же.

## Базовые сведения

| | |
|---|---|
| **База** | `https://<app>.up.railway.app` |
| **Auth-заголовок (прод)** | `X-Telegram-Init-Data` — подписанный `tg.WebApp.initData`, проверяется HMAC'ом на сервере ([SECURITY.md](./SECURITY.md#2-аутентификация)) |
| **Auth-заголовок (dev)** | `X-Telegram-Id` — только если `BOT_TOKEN` не задан или `ALLOW_INSECURE_AUTH=true`; в проде сервер с этим не стартует |
| **Content-Type** | `application/json` везде, кроме `POST /me/avatar` (multipart) и `/export/*.csv` (`text/csv`) |
| **Формат ошибки** | `{ "error": "<код>", "message": "<человекочитаемо>" }` — единый `setErrorHandler`, см. ниже |

## Уровни доступа

Каждая группа роутов ниже помечена минимальным уровнем, который проходит
`preHandler`-гварды (`auth/guards.ts`). Внутри группы отдельные эндпоинты
могут требовать больше — например, `GET /orgs` открыт `auth`, а
`PUT /admin/org/:id` в том же файле — только `admin`; в таблице это
помечено «смешанный».

| Значок | Уровень | Гвард | Кто проходит |
|:---:|---|---|---|
| 🌐 | публичный | нет (только rate-limit) | кто угодно — сегодня только `GET /avatars/:employeeId` |
| 🔓 | auth | `requireAuth` | есть подтверждённая identity, необязательно одобренный доступ |
| ✅ | active | `requireActive` | одобренный (`access_status='active'`) сотрудник любой роли |
| 👔 | manager+ | `requireManager` | `manager` / `admin` / `senior` |
| 🛡 | supervisor+ | `requireManagerOrSupervisor` / `requireSupervisor` | `supervisor` и выше |
| 🔑 | admin | ручная проверка `role === 'admin'` | только `admin` |
| 🔀 | смешанный | — | разные подроуты файла на разных уровнях, см. код |

## Эндпоинты

| Группа | Доступ | Примеры | Модуль (`backend/src/api/routes/`) |
|--------|:---:|---------|--------------------------------------|
| System | 🌐 | `GET /health` | `app.ts` |
| Me / access | ✅ | `/me`, `/me/day`, `/me/bind`, `/me/access`, `/me/insight`, `/me/self-stats` | `me/index.ts` |
| Avatar | 🔀 | `POST /me/avatar` (🔓), `GET /avatars/:employeeId` (🌐, rate-limit 30/мин) | `me/avatar.ts` |
| Access requests | 🔀 | `/access/status` (🔓), `/access/request` (🔓), `/access/orgs`/`/access/requests` (👔🛡), `PUT /supervisor/:id/sector` (🔑) | `org/access.ts` |
| Sales / shifts | 🔀 | `/sales` (✅, за другого — 👔 узко, см. `canWriteSalesForOthers`), `/sales/:id/zero` (👔), `/shifts/open\|close\|current` (🔓), `/sync/batch` (🔓) | `sales.ts`, `shifts.ts` |
| Plans / schedule | 🔀 | `GET /plans/*` (✅), запись — 👔; `/schedules` (✅ своя, 👔 за другого) | `plans.ts`, `schedules.ts` |
| BFQ / cash | 🔀 | `GET /bfq/:employeeId` (✅), `/bfq` (👔); `/cash/table`+`PUT /cash` (👔) | `bfq.ts`, `cash.ts` |
| Stores / org | 🔀 | `GET /stores` (✅), `POST /employees`/`/stores`, `PATCH /employees/:id/role` (👔, `canAssignRole` ограничивает роль сверху) | `org/stores.ts`, `org/employees.ts` |
| Branding | 🔀 | `/branding`, `/orgs` (🔓), `PUT /admin/org/:id` (🔑) | `org/branding.ts` |
| Command Center / Tasks / Alerts | 🔀 | `/command-center` (🔓), `/tasks`/`/tasks/:id` (🔓, часть операций 🛡), `/alerts`+`/alerts/:id/*` (👔) | `analytics/command-center.ts`, `ops/tasks.ts`, `ops/alerts.ts` |
| Profiles | 🔀 | `/stores/:id/profile`, `/employees/:id/profile` (🔓, отдельные поля 🔑) | `profiles/store.ts`, `profiles/employee.ts` |
| Live map / what-if | 🔀 | `/network/live` (🔓), `/schedule/what-if`+`/apply` (👔) | `analytics/live.ts`, `analytics/what-if.ts` |
| Forecast / analytics | 🔀 | `/forecast/:storeId` (🔓/👔 по под-роуту), `/heatmap/*` (🔓), `/staffing-hints`, `/cohorts/newbies`, `/export/bi/daily` (👔) | `analytics/forecast.ts`, `analytics/heatmap.ts` |
| Reports | 🔀 | `GET /reports/day/:storeId` (✅), `POST /reports/send-*` (👔) | `ops/reports.ts` |
| Promo / support / comms | 🔀 | `/promos` (✅), `/support` (✅, часть 🔑), `/announcements`+`/channels/:id/messages` (🔓, запись 👔) | `promos.ts`, `ops/support.ts`, `ops/comms.ts` |
| Supervisor | 🔀 | `/supervisor/dashboard`+`/health` (🔓, фильтр по сектору), `/supervisor/stores` (👔) | `analytics/supervisor.ts`, `org/access.ts` |
| Export | 👔 | CSV: `/export/sales.csv`, `/export/bfq.csv`, `/export/schedules.csv` | `ops/export.ts` |
| Audit | 🔑 | `GET /audit` | `audit.ts` |
| Metrics | 👔 | `/metrics` (каталог кастомных метрик) | `metrics.ts` |

Каждый роут, отдающий чужие/сетевые данные, дополнительно гейтится
org-scope проверкой (`assertStoreInOrg`/`assertEmployeeInOrg`) поверх
ролевого гварда — своя сеть по умолчанию, `admin` может явно запросить
другую (`org_id` в теле/query). Подробности — [SECURITY.md](./SECURITY.md#3-авторизация-rbac).

## Формат ошибок

| HTTP | `error` | Когда |
|:---:|---|---|
| 400 | `validation_failed` | TypeBox-схема `schema.body` не прошла (ajv) — `details: [...]` с конкретными полями |
| 401 | `unauthorized` / `session_expired` | Нет identity / initData-сессия старше 1 часа |
| 401 | `not_registered` | Identity есть, но нет одобренной заявки на доступ |
| 403 | `pending` / `rejected` / `blocked` | Заявка на рассмотрении / отклонена / доступ закрыт |
| 403 | `forbidden` | Роль или org-scope не проходят проверку конкретного роута |
| 429 | — (заголовки `x-ratelimit-*`) | Превышен `@fastify/rate-limit`, см. [SECURITY.md — периметр](./SECURITY.md#1-периметр) |
| 5xx | `internal_error` (и похожие) | Глобальный `setErrorHandler` (`app.ts`) — известные коды ошибок Postgres превращены в стабильный `{error, message}`, без сырого текста драйвера |

## Связанные документы

- [SECURITY.md](./SECURITY.md) — почему у каждого уровня доступа именно
  такая граница, и как она проверяется технически.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — где физически лежит каждый модуль
  из таблицы выше.
