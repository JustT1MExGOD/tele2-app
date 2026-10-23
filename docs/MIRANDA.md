# T2 Miranda — корпоративный мессенджер

[Документация](README.md) · [Обзор проекта](../README.md)

> Добавлен поэтапно с 20.64.0 (устройства и очередь одобрения) → 20.69.0
> (группы контактов, вложенные) → 20.70.x (аккаунты точки/кассы, гранты,
> дилер-скоуп, авто-approve) → 20.78.x–20.79.x (управление в Admin Center:
> переименование любого аккаунта, группы, аудит). Живой справочник —
> обновляется вместе с кодом.

**Содержание**

- [Назначение](#назначение)
- [Две модели аккаунта](#две-модели-аккаунта)
- [Активация устройства](#активация-устройства)
- [Скоуп: дилер, а не одна сеть](#скоуп-дилер-а-не-одна-сеть)
- [Маршруты API](#маршруты-api)
- [Группы контактов](#группы-контактов)
- [Переименование аккаунта](#переименование-аккаунта)
- [Присутствие (статус «в сети»)](#присутствие-статус-в-сети)
- [Мессенджер](#мессенджер)
- [Admin Center → «Устройства Miranda»](#admin-center--устройства-miranda)
- [Ключи аудита](#ключи-аудита)
- [Ограничения](#ограничения)
- [Связанные документы](#связанные-документы)

## Назначение

Встроенный корпоративный мессенджер **внутри границы дилерской группы
сетей**. Не отдельный сервис и не публичный протокол — модуль того же
backend (`/miranda/*`), который использует ту же БД, ту же RBAC-модель и
те же механизмы авторизации, что и T2 Sales.

Это **не**:

- федеративный мессенджер;
- чат с внешними контактами;
- замена внутреннему чату сотрудников `/chat` (тот — один общий поток сети,
  Miranda — адресные беседы и группы контактов);
- обязательный инструмент сотрудника — он включается только там, где сеть
  его использует.

У одного физического пользователя может быть две сессии одновременно:
сессия T2 Sales (сотрудник) и point-session Miranda (вход аккаунта точки
по телефону + паролю, отдельный cookie `t2_point_session`).

<a id="account-models"></a>

## Две модели аккаунта

`corporate_accounts` (миграции `0039`–`0045`) — единый субъект мессенджера.
Каждый аккаунт — либо **личный**, либо **аккаунт точки/кассы**:

| Поле | Личный | Точка/касса |
|---|---|---|
| `employee_id` | `employees.id` владельца | `NULL` |
| `store_id` | `NULL` (личный) или точка, если аккаунт завели на точку | код точки |
| `phone`, `account_name` | — | телефон входа и название («Касса Космонавтов 20А») |
| `device_exclusive` | `false` | `true` по смыслу (см. ниже) |
| `display_label` | кастомное имя или `NULL` | кастомное имя или `NULL` |
| `is_active` | `true`/`false` (мягкая деактивация) | `true`/`false` |
| `presence_override` | `online`/`offline`/`NULL` (= авто) | то же |

`device_exclusive = true` — семантика «ровно одно одновременно активное
устройство» для точки/кассы: вторая одновременная привязка не одобряется,
пока прежняя не отозвана. Для личного аккаунта несколько устройств
разрешены (`false`).

Отображаемое имя — `display_label` (`NULL` → стандартное: имя сотрудника
или `account_name` точки). Два пути правки:

- **свой аккаунт** — `PATCH /miranda/accounts/me`, принципал, без админских
  прав;
- **любой аккаунт** — `PATCH /miranda/accounts/:id`, `requireAdmin`, `displayLabel = null`
  возвращает стандартное имя, действие аудируется
  `MIRANDA_ACCOUNT_RENAMED` (см. ниже).

<a id="device-activation"></a>

## Активация устройства

`miranda_devices` / привязки (`bindings`) хранят одно устройство ↔ один
аккаунт в одном из состояний: `pending` → `active` | `revoked`.

Поток:

1. `POST /miranda/devices/register` — устройство регистрирует привязку
   (`platform`, `store_id?`, `label?`) → `deviceId`, `deviceSecret`, `status`.
2. `POST /miranda/devices/activate` — по `deviceSecret` (без сессии
   приложения: отдельный секрет устройства) возвращает
   `status: active | pending | unknown_device` и, при активной привязке,
   `corporateAccountId` + `displayLabel`.
3. **Первое устройство личного аккаунта** (без других активных привязок,
   `device_exclusive = false`) — авто-approve: `registerDevice` сразу
   ставит `active` и записывает аудит `MIRANDA_DEVICE_AUTO_APPROVED`.
   Повторный вход на уже зарегистрированном старом устройстве
   (`pending` до 20.78.0) тоже авто-активируется при следующем
   `/activate`.
4. **Остальные** (точки/кассы `device_exclusive`, вторые+ устройства)
   — остаются `pending`, пока админ не нажмёт approve через step-up
   (`POST /miranda/devices/:id/approve` + `X-Step-Up-Token`) или revoke.

<a id="dealer-scope"></a>

## Скоуп: дилер, а не одна сеть

Чтение групп контактов и аккаунтов идёт **по дилеру**, а не по одной
сети — `resolveDealerOrgIds(orgId)` возвращает `org_id` всех сетей
дилера. Иначе группа, созданная админом одной сети, была бы невидимой
сотруднику соседней сети того же дилера.

- `GET /miranda/admin/groups` — чтение для Admin Center **без активного
  Miranda-сеанса** на этом устройстве (`requireAdmin`; обычная телефонная /
  Telegram-админ-сессия подходит). Принимает `?org_id=` как org-switcher.
- `GET /miranda/groups` — обычное чтение для принципала мессенджера
  (`resolveMirandaPrincipal`), скоупится на `dealerOrgIds` принципала.
- Мутации (создание / переименование / удаление / состав) — `requireAdmin`,
  глобально в любой сети любого дилера; `orgId` в теле создания
  проверяется только на существование сети, а не на принадлежность дилеру
  админа — та же гарантия, что у остальных admin-only Miranda-роутов.

Точечные аккаунты (без `request.user`) не проходят `requireAdmin` в
принципе — управлять ими нельзя.

<a id="endpoints"></a>

## Маршруты API

Без `/api`-префикса — как и весь остальной backend. Полный список — в
[API.md](./API.md) → «T2 Miranda»; здесь — по доменам.

**Устройства** (`api/routes/miranda/devices.ts`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| `POST` | `/miranda/devices/register` | 🔓 сотрудник или вход точки | Регистрация привязки, выдаёт `deviceSecret` |
| `POST` | `/miranda/devices/activate` | 🔓 по `deviceSecret` | Активация; авто-approve первого личного устройства и старого `pending` при повторном входе |
| `GET` | `/miranda/devices` | 🔑 | Очередь `pending` по дилеру |
| `POST` | `/miranda/devices/:id/approve` | 🔑 + step-up | Одобрение привязки (`X-Step-Up-Token`) |
| `POST` | `/miranda/devices/:id/revoke` | 🔑 | Отзыв привязки |

**Корпоративные аккаунты** (`api/routes/miranda/accounts.ts`,
`accounts-login.ts`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| `GET` | `/miranda/accounts` | 🔑 | По дилеру, `?include_inactive=1` |
| `POST` | `/miranda/accounts` | 🔑 | Личный (`employeeId`) или точка (`phone`/`password`/`accountName`, `storeId?`, `displayLabel?`) |
| `PATCH` | `/miranda/accounts/:id` | 🔑 | Переименование любого аккаунта, `displayLabel=null` сбрасывает имя — аудит |
| `PATCH` | `/miranda/accounts/:id/device-exclusive` | 🔑 | Флаг «одно устройство» |
| `POST` | `/miranda/accounts/:id/deactivate`·`/reactivate` | 🔑 | Мягкая деактивация, не удаление |
| `GET`/`PATCH` | `/miranda/accounts/me` | принципал | Свой `display_label` |
| `GET` | `/miranda/accounts/available` | 🔑 | Доступные вам для переключения |
| `POST` | `/miranda/session/switch` | 🔑 + point-session | Переключить активный аккаунт сессии |
| `POST` | `/miranda/accounts/login`·`/logout` | 🌐 по телефону + паролю | Отдельная point-session (`t2_point_session`) |
| `POST` | `/miranda/admin-grants` | 🔑 | Выдать грант на переключение |

**Группы контактов** (`api/routes/miranda/contact-groups.ts`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| `GET` | `/miranda/admin/groups` | 🔑 | Список без активного Miranda-сеанса, `?org_id=` |
| `GET` | `/miranda/groups` | принципал | По `dealerOrgIds` |
| `POST` | `/miranda/groups` | 🔑 | `name` (1–100), `parentGroupId?`, `orgId?` |
| `PATCH` | `/miranda/groups/:id` | 🔑 | Переименование (`name`) |
| `DELETE` | `/miranda/groups/:id` | 🔑 | Удаление (контакты остаются вне групп) |
| `POST` | `/miranda/groups/:id/members` | 🔑 | `corporateAccountId` — добавить аккаунт |
| `DELETE` | `/miranda/groups/:id/members/:corporateAccountId` | 🔑 | Убрать аккаунт |

**Контакты, присутствие, мессенджер** (`accounts.ts` — контакты/presence,
`messenger.ts`, `attachments.ts`, `ws.ts`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| `GET` | `/miranda/contacts?q=` | принципал | Поиск |
| `GET` | `/miranda/contacts/all` | принципал | Полное дерево сети (не поиск) |
| `PATCH` | `/miranda/presence` | принципал | `status: online\|offline\|auto` |
| `GET` | `/miranda/conversations` | принципал | Список бесед |
| `POST` | `/miranda/conversations/direct` | принципал | `targetCorporateAccountId` |
| `POST` | `/miranda/conversations/group` | принципал | `title`, `memberCorporateAccountIds[]` |
| `GET` | `/miranda/conversations/:id/members` | принципал | Состав |
| `GET` | `/miranda/conversations/:id/messages` | принципал | `cursor`/`after`/`limit` — история и catch-up |
| `POST` | `/miranda/conversations/:id/messages` | принципал | `clientMessageId` + `body`/`attachmentIds`, идемпотентно |
| `POST` | `/miranda/conversations/:id/read` | принципал | `messageId` — пометить прочитанным |
| `POST`/`GET` | `/miranda/attachments[/:id]` | принципал | Загрузка (multipart) и скачивание вложений |
| `GET` | `/miranda/ws` | принципал | WebSocket push новых сообщений `{type:"message", message}` |

<a id="contact-groups"></a>

## Группы контактов

`miranda_contact_groups` + `miranda_contact_group_members` — общие для
дилера на чтение, настраиваются админом. Не путать с групповыми чатами
внутри мессенджера (`conversations` типа `group`) — это два разных
механизма: группы контактов организуют **дерево контактов**, а не беседу.

Поля: `name` (до 100), `org_id`, `parent_group_id` (`NULL` → корневая,
иначе вложенная), `sort_order`; состав — `member_corporate_account_ids`
(по корпоративным аккаунтам, **не** по `employee_id` — потому что
аккаунт точки имеет `employee_id = NULL`).

Миграции: `0043` (группы и presence), `0044` (общие для сети и вложенные),
`0045` (backfill: предсоздание личных аккаунтов действующих админов,
синхронизация `org_id` из `employees`, `device_exclusive = false`,
идемпотентна — существующий личный аккаунт восстанавливается как активный,
дубликатов не создаёт благодаря `NOT EXISTS`, т.к. `UNIQUE(employee_id,
store_id)` не защищает множественные `NULL` в `store_id`).

<a id="rename-account"></a>

## Переименование аккаунта

`PATCH /miranda/accounts/:id` → `service.renameCorporateAccount()`:
транзакция читает `before`, пишет `display_label`, записывает
`MIRANDA_ACCOUNT_RENAMED` в `audit_log` (`org_id` берётся из **целевого**
аккаунта — админ может переименовывать аккаунт чужой сети, и аудит должен
попасть в его журнал, а не в журнал сети администратора).

`displayLabel = null` возвращает показ по умолчанию. Схема —
`RenameAccountBody`: `string | null`, `minLength 1`, `maxLength 200`.

<a id="presence"></a>

## Присутствие (статус «в сети»)

`presence_override` на аккаунте: `online`/`offline`/`NULL` (= авто —
вычисляется по активности). Управляется принципалом через
`PATCH /miranda/presence`. Отображается в контактах и у отправителя
сообщений.

<a id="messenger"></a>

## Мессенджер

`conversations` (`direct`/`group`), `messages` (`clientMessageId` —
идемпотентность), `members`, `attachments` (multipart загрузка →
`attachmentIds` в сообщении), WebSocket `/miranda/ws` — push-only
`{type:"message", message: MirandaMessage}`.

`unread_count` в списке бесед считается от `last_read_message_id`.
`GET /messages` — постранично по `cursor` (старше) или `after` (новее).

<a id="admin-center-miranda"></a>

## Admin Center → «Устройства Miranda»

Отдельная вкладка `Admin Center` (`admincenter/AcMiranda.kt` на обоих
нативных клиентах, `admin-center/miranda-devices.ts` в вебе). Секции:

1. **Очередь подтверждения** — `pending`-привязки, approve через step-up,
   revoke без него.
2. **Корпоративные аккаунты** — создание (личный — поиск сотрудника;
   точка — телефон + пароль + название), `device_exclusive`-чекбокс,
   деактивация/восстановление, переключатель «Показывать
   деактивированные». На каждом аккаунте — «В группу» (выбор для
   группировки) и «Имя» (rename-диалог; пустое → стандартное имя).
3. **Группы контактов** — создание по имени, переименование и удаление
   через диалоги, `+ аккаунт` (добавить выбранный), чип участника `×`
   (убрать). Состав задаётся по корпоративному `corporateAccountId`.
4. **Переключение аккаунтов** — поиск админа + выбор аккаунта →
   `/miranda/admin-grants`; ниже — уже выданные вам гранты.

Ординарный пользователь видит мессенджер (контакты, беседы, своё имя и
статус); административная панель доступна только `requireAdmin`.

<a id="audit-keys"></a>

## Ключи аудита

| `action` | Когда |
|---|---|
| `MIRANDA_ACCOUNT_RENAMED` | Админ переименовал корпоративный аккаунт (`PATCH /miranda/accounts/:id`) — `before`/`after` по `display_label`, `org_id` целевого аккаунта |
| `MIRANDA_DEVICE_AUTO_APPROVED` | Авто-approve первого устройства личного аккаунта или старого `pending` при повторном входе |

<a id="limitations"></a>

## Ограничения

- **Не публичный протокол** — нет внешних контактов, приглашений по
  ссылке, федерации.
- **Не сквозное шифрование** — как у `/chat`, вложения и тела в БД
  (отдельная история E2EE — [ADR/010](./ADR/010-chat-e2ee-future-direction.md)).
- **`device_exclusive` enforced на approve** — гарантия на стороне
  сервиса (`approveBinding`), не только в UI.
- **Точечный аккаунт** не может быть админом — `requireAdmin` требует
  `request.user`, которого у point-session нет.
- **Realtime** — только push новых сообщений по WS; история — `GET
  /messages` с `cursor`/`after`, как и в `/chat`.

<a id="related"></a>

## Связанные документы

- [API.md](./API.md) — полный список `/miranda/*` маршрутов и уровни
  доступа.
- [FEATURES.md](./FEATURES.md) — где Miranda сидит в навигации и Admin
  Center.
- [CHAT.md](./CHAT.md) — отдельный внутренний чат сотрудников (`/chat`),
  не путать с адресным мессенджером.
- [SECURITY.md](./SECURITY.md) — auth-периметр и RBAC-границы.
- [native/docs/FEATURES.md](../native/docs/FEATURES.md) —
  `admincenter/AcMiranda.kt` на клиентах для Windows и Android.
- [native/docs/ANDROID.md](../native/docs/ANDROID.md) — мобильный порт
  `ported/AcMiranda.kt`.
- [SHEET-SCHEDULE-IMPORT.md](./SHEET-SCHEDULE-IMPORT.md) — соседняя
  вкладка импорта графика в том же Admin Center.
