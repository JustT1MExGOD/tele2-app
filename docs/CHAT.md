# Внутренний чат сотрудников

> Добавлено в 20.57.0 (release candidate, ещё не задеплоено — см.
> [CHANGELOG.md](../CHANGELOG.md)). Живой справочник — обновляется вместе
> с кодом, как и остальные документы `docs/`.

## Назначение

Один общий текстовый чат **внутри границы одной organization/network**,
доступный только authenticated active employee этой сети.

Это **не**:

- публичный мессенджер;
- общий чат всех организаций платформы;
- guest/gость-доступный чат;
- federated/межсерверный протокол;
- канал с внешними приглашениями по ссылке.

Если организация деактивирована/сотрудник неактивен/сотрудник вне
организации — доступ прекращается тем же существующим auth-механизмом
(`requireActive()`, `auth/guards.ts`), отдельного пароля/аккаунта для
чата нет.

## Tenant boundary

`request.user.org_id` (значение из authenticated principal,
`auth/principal.ts`) — **единственный** источник scope, для чтения и для
записи. Тот же принцип, что уже используют `announcements.org_id`/
`channels.org_id` — переиспользован, не изобретён заново.

Клиент **никогда** не задаёт авторитетно:

- `sender` (id/имя/роль) — только из `request.user.employee_id`;
- `organization`/`org_id` — только из `request.user.org_id`, даже если
  тело запроса содержит `org_id`/`organizationId`, оно игнорируется;
- `createdAt`/timestamps — только `now()`/сервер.

В отличие от `resolveViewOrgId()` (аналитика/планы), у чата **нет**
admin-override на просмотр чужой сети — своя сеть, без исключений, ни
для какой роли.

## Endpoints

Без `/api`-префикса — весь остальной backend тоже без него.

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/chat/messages` | История, keyset-пагинация: `cursor` (старше id) ИЛИ `after` (новее id, для catch-up/polling), `limit` (default 50, max 100) |
| `POST` | `/chat/messages` | Отправка сообщения, CSRF-защищено, идемпотентно через `clientMessageId`. Тело — до 5000 символов (`api/routes/chat/messages.ts::PostMessageBody`), пустое/whitespace-only без вложений отклоняется |
| `POST` | `/chat/attachments` | Загрузка вложения (multipart), prepared, TTL |
| `GET` | `/chat/attachments/:id` | Скачивание, authenticated, org-scoped |
| `GET` | `/chat/ws` | Realtime push (WebSocket) |

## Realtime: DIRECT → WebSocket, иначе → polling

`GET /chat/ws` — `@fastify/websocket`, auth в `preHandler` до апгрейда
(`requireActive`), периодическая ре-валидация принципала на каждый
heartbeat (30с) — деактивированный/переведённый в другую сеть сотрудник
теряет соединение в пределах одного интервала, не остаётся авторизованным
бессрочно. Лимит 8 одновременных соединений на сотрудника.

**Если WS недоступен** — фронтенд (`RealtimeTransport`,
`backend/frontend/src/pages/chat/realtime-transport.ts`) откатывается на
HTTP-polling (`GET /chat/messages?after=<последний известный id>`,
интервал 4с, bounded backoff до 30с при ошибках, пауза при
`document.hidden`) и периодически пробует вернуться на WS. REST остаётся
источником истины в обоих случаях.

**Важно про RELAY**: текущий application-scoped relay (`relay/`)
реализует **только** `POST /forward` (request/response) — upgrade-
обработчика для WebSocket нет и не добавлялся. Через RELAY чат работает
исключительно через REST polling, WS в этом режиме структурно не
проходит (не баг, ожидаемое поведение по дизайну релея). **Relay не
превращён в generic proxy ради WS** — это осознанное решение, не временный
пробел: fixed-upstream HTTP-relay остаётся его единственной ролью.

## Идемпотентность

Клиент генерирует `clientMessageId` (UUID) до первой попытки отправки.
`UNIQUE(sender_employee_id, client_message_id)` + `INSERT ... ON CONFLICT
DO NOTHING RETURNING` — конкурентный дубль или honest retry получают
канонический уже созданный ряд, не вторую строку. Retry после неизвестного
network outcome безопасен тем же `clientMessageId`.

## Attachments

Значения ниже взяты из кода (`backend/src/core/chat/attachment-validation.ts`),
не из этого документа отдельно — если код изменится, документ может
отстать, проверяйте код при сомнении.

- **Лимит размера**: 20 МБ на файл (`MAX_ATTACHMENT_BYTES`).
- **Лимит на сообщение**: 5 вложений (`MAX_ATTACHMENTS_PER_MESSAGE`).
- **Разрешённые типы**: JPEG, PNG, WEBP, PDF, TXT, DOC, DOCX, XLS, XLSX —
  allowlist по трём независимым сигналам (extension + заявленный MIME +
  magic bytes; для legacy `.doc`/`.xls` дополнительно проверяются имена
  внутренних CFB-потоков, отличающие Office-документ от `.msi` в том же
  контейнере — задокументированное ограничение, не полный парсер формата).
- **Prepared TTL**: 1 час (`PREPARED_ATTACHMENT_TTL_MS`) — вложение
  загружается ДО отправки сообщения, живёт непривязанным это время, видно
  только загрузившему (не всей сети) до момента реальной привязки к
  сообщению.
- **Orphan cleanup**: часовой cron (`backend/src/cron/chat-attachment-cleanup.ts`)
  удаляет просроченные непривязанные вложения — и метаданные
  (`chat_attachments`), и bytea-блоб (`chat_attachment_blobs`) физически.
  Org-agnostic по дизайну (фоновая задача обрабатывает все сети сразу, это
  не auth-граница), но никогда не трогает уже привязанное к сообщению
  вложение (`WHERE message_id IS NULL` — проверено тестом, который
  специально выставляет просроченный `expires_at` уже привязанному
  вложению и подтверждает, что cleanup его не удаляет).

**Хранение — сейчас Postgres bytea, через `StorageAdapter`.** Тот же
прецедент, что аватарки сотрудников (`employees.avatar_data`) — Railway не
даёт постоянной файловой системы, S3/объектное хранилище **не
подключено**. `StorageAdapter` (`backend/src/core/chat/storage.ts`) —
интерфейс `put/get/delete`, единственная реализация сегодня —
`PostgresBlobStorageAdapter`. Это не заглушка "пока нет S3" — рабочий,
проверенный тестами способ хранения; но при заметном объёме вложений в
проде Postgres будет расти заметнее, чем от одних только аватарок — если
это станет проблемой, адаптер даёт точку замены на настоящий
S3-compatible storage без изменения схемы `chat_attachments`/роутов.
**S3 не реализован сейчас** — это возможное направление, не факт.

## Privacy — прямо, без эвфемизмов

**E2EE нет.** Сервер сегодня видит:

- **plaintext** тело сообщения;
- **plaintext** содержимое вложений (файл целиком проходит через
  magic-byte валидацию на сервере);
- отправителя (`sender_employee_id`);
- организацию (`org_id`);
- время создания.

Ничего из этого не скрыто от сервера архитектурно. Единственное
исключение из логирования — сам контент: ни тело сообщения, ни байты
файла никогда не пишутся в application-логи (только `messageId`/
`senderUserId`/`organizationId`/количество и размер вложений/тип
события/категория ошибки).

Будущее направление к E2EE описано в [ADR/010](./ADR/010-chat-e2ee-future-direction.md)
(Proposed/Planned, ничего не реализовано) — не путать с текущим
состоянием выше.

## Rate limits

Per-route, `@fastify/rate-limit` (тот же механизм, что у остального API)
— операционно перенастраиваемые значения, не стабильный публичный
контракт; актуальные числа смотрите в самом коде, не полагайтесь на этот
список надолго:

- `POST /chat/messages` — `api/routes/chat/messages.ts`
- `POST /chat/attachments` — `api/routes/chat/attachments.ts`
- `GET /chat/messages` / `GET /chat/attachments/:id` — те же файлы

Плюс WS connection cap (8/сотрудника) — см. "Realtime" выше, это отдельный
механизм, не `@fastify/rate-limit`.

## Тестирование

- Backend: `backend/tests/isolation/chat-*.test.ts` (scope/messages/attachments/realtime).
- Frontend: `backend/frontend/tests/chat-*.test.ts` (рендер/composer/RealtimeTransport).
- Relay: `relay/tests/relay-chat-acceptance.test.ts` — доказывает, что REST (включая multipart-загрузку и бинарное скачивание) проходит через `POST /forward` byte-for-byte, без изменений в самом relay.

## Связанные документы

- [SECURITY.md — Internal Chat](./SECURITY.md#12-internal-chat-20570) — security-инварианты.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — где чат живёт в общей структуре.
- [ADR/010](./ADR/010-chat-e2ee-future-direction.md) — будущее направление шифрования (не реализовано).
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — типовые проблемы чата.
