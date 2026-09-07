# HTTP API

[Документация](README.md) · [Обзор проекта](../README.md)

Справочник основных групп HTTP API, способов авторизации и формата ошибок. Таблица помогает найти модуль; точный контракт отдельного маршрута задаётся его схемой и обработчиком в исходниках.

**Содержание**

- [Базовые сведения](#базовые-сведения)
- [Уровни доступа](#уровни-доступа)
- [Эндпоинты](#эндпоинты)
- [Пример запроса](#пример-запроса)
- [Формат ошибок](#формат-ошибок)
- [Связанные документы](#связанные-документы)

## Базовые сведения

| Параметр | Описание |
|---|---|
| **База** | `https://<app>.up.railway.app` |
| **Auth-заголовок (прод, Telegram)** | `X-Telegram-Init-Data` — подписанный `tg.WebApp.initData`, проверяется HMAC'ом на сервере ([SECURITY.md](./SECURITY.md#2-аутентификация)) |
| **Auth (браузер/PWA)** | Cookie `t2_session` (httpOnly) вместо заголовка; на каждый non-GET запрос с этой cookie дополнительно нужен `X-CSRF-Token`, равный значению cookie `t2_csrf` ([SECURITY.md — CSRF](./SECURITY.md#1-периметр)) |
| **Auth-заголовок (dev)** | `X-Telegram-Id` — только если `BOT_TOKEN` не задан или `ALLOW_INSECURE_AUTH=true`; в проде сервер с этим не стартует |
| **Content-Type** | обычно `application/json`; загрузки аватара и вложений используют multipart, выгрузки — свой тип, например `text/csv` |
| **Формат ошибки** | `{ "error": "<код>", "message": "<человекочитаемо>" }` — единый `setErrorHandler`, см. ниже |

## Уровни доступа

Каждая группа роутов ниже помечена минимальным уровнем, который проходит
`preHandler`-гварды (`auth/guards.ts`). Внутри группы отдельные эндпоинты
могут требовать больше — например, `GET /orgs` открыт `auth`, а
`PUT /admin/org/:id` в том же файле — только `admin`; в таблице это
помечено «смешанный».

| Значок | Уровень | Гвард | Кто проходит |
|:---:|---|---|---|
| 🌐 | публичный | нет (только rate-limit) | без подтверждённой сессии; служебные маршруты, отдельные действия авторизации и чтение аватара имеют собственные ограничения |
| 🔓 | auth | `requireAuth` | есть подтверждённая identity, необязательно одобренный доступ |
| ✅ | active | `requireActive` | одобренный (`access_status='active'`) сотрудник любой роли |
| 👔 | manager+ | `requireManager` | `manager` / `admin` / `senior` |
| 🛡 | supervisor+ | `requireManagerOrSupervisor` / `requireSupervisor` | `supervisor` и выше |
| 🔑 | admin | ручная проверка `role === 'admin'` | только `admin` |
| 🔀 | смешанный | — | разные подроуты файла на разных уровнях, см. код |

## Эндпоинты

| Группа | Доступ | Примеры | Модуль (`backend/src/api/routes/`) |
|--------|:---:|---------|--------------------------------------|
| Системные маршруты | 🌐 | `GET /health`, `/healthz`, `/readyz`, `/integrations/health`, `/metrics` (Prometheus) | `app.ts` |
| Вход через браузер или телефон | 🔀 | `POST /auth/register`/`/login`/`/reset/:token` (🌐, публичные, свои rate-limit, CSRF-исключены), `POST /auth/logout` (🔓), `POST /auth/admin/reset-password/:employeeId` (👔), `GET/DELETE /auth/sessions`, `POST /auth/sessions/revoke-others` (🔓, ownership-scoped) | `auth/session.ts`, `auth/sessions-admin.ts` |
| Профиль и доступ | ✅ | `/me`, `/me/day`, `/me/bind`, `/me/link-phone` (🔓, привязка телефона к своей же карточке, свой rate-limit), `/me/access`, `/me/insight`, `/me/self-stats` | `me/index.ts` |
| Аватар | 🔀 | `POST /me/avatar` (🔓), `GET /avatars/:employeeId` (🌐, rate-limit 30/мин) | `me/avatar.ts` |
| Заявки на доступ | 🔀 | `/access/status` (🔓), `/access/request` (🔓), `/access/orgs`/`/access/requests` (👔🛡), `PUT /supervisor/:id/sector` (🔑) | `org/access.ts` |
| Продажи и смены | 🔀 | `/sales` (✅ своя, `canWriteSalesForOthers()` узко для чужой — 👔 manager/admin, **не** senior), `/sales/quick` (🔓, та же `canWriteSalesForOthers()` для чужой), `/sales/:id/zero` (👔), `/shifts/open\|close\|current`/`/sales/parse` (🔓), `/sync/batch` (🔓, та же `canWriteSalesForOthers()` на каждой операции батча) | `sales.ts`, `shifts.ts` |
| Планы и графики | 🔀 | `GET /plans/*` (✅), запись — 👔; `/schedules` (✅ своя, 👔 за другого) | `plans.ts`, `schedules.ts` |
| BFQ и касса | 🔀 | `GET /bfq/:employeeId` (✅), `/bfq` (👔); `/cash/table`+`PUT /cash` (👔) | `bfq.ts`, `cash.ts` |
| Точки и организация | 🔀 | `GET /stores` (✅), `POST /employees`/`/stores`, `PATCH /employees/:id/role` (👔, `canAssignRole` ограничивает роль сверху) | `org/stores.ts`, `org/employees.ts` |
| Оформление организации | 🔀 | `/branding`, `/orgs` (🔓), `PUT /admin/org/:id` (🔑) | `org/branding.ts` |
| Сводный экран, задачи и уведомления | 🔀 | `/command-center` (🔓), `/tasks`/`/tasks/:id` (🔓, часть операций 🛡), `/alerts`+`/alerts/:id/*` (👔) | `analytics/command-center.ts`, `ops/tasks.ts`, `ops/alerts.ts` |
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

## Пример запроса

```http
POST /sales HTTP/1.1
Host: <app>.up.railway.app
X-Telegram-Init-Data: query_id=...&user=...&auth_date=...&hash=...
Content-Type: application/json

{"employee_id": 42, "store_id": "gureeva", "sim": 2, "mnp": 1, "client_id": "a1b2c3..."}
```

Локально/dev вместо `X-Telegram-Init-Data` — голый `X-Telegram-Id: 42`
(только при `ALLOW_INSECURE_AUTH=true`, см. выше). `client_id` —
необязательный ключ идемпотентности (UUID со стороны клиента) — без него
эндпоинт работает как раньше, просто без защиты от задвоенного ретрая, см.
[SECURITY.md — целостность данных](./SECURITY.md#6-целостность-данных-и-конкурентность).

Успешный ответ (`200`):

```json
{
  "id": 1234,
  "employee_id": 42,
  "store_id": "gureeva",
  "sale_date": "2026-08-24",
  "full_name": "Сидоров Игорь",
  "store_name": "РТТ Гуреева",
  "sim": 2,
  "mnp": 1
}
```

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
