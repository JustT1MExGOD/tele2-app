# Типовые сбои

> Вынесено из README §20 при сжатии корня (20.16.0). Операционные процедуры
> (ротация токена, восстановление доступа, откат миграции) —
> [RUNBOOK.md](./RUNBOOK.md); архитектура защиты — [SECURITY.md](./SECURITY.md).

| Симптом | Причина / действие |
|---------|----------|
| `409 getUpdates` в логах бота | Два `polling` на одном `BOT_TOKEN` — не два инстанса бота одновременно. `railway logs` на дубли реплик; **Replicas = 1** (см. [DEVELOPMENT.md](./DEVELOPMENT.md)); локально — `BOT_POLLING=false` для второй копии |
| Отказ в доступе / `bound:false` в ответе `/me` | `access_status` не `active`, или сотрудник не привязан к `telegram_id`. Проверить статус заявки (`GET /access/requests`) или approve её; для восстановления своего доступа локально — см. [RUNBOOK.md — восстановление доступа](./RUNBOOK.md#восстановление-доступа-admin) |
| `401 session_expired` на реальном Telegram-клиенте | initData не проходит HMAC-проверку — устаревший/битый `initData`, разъехавшиеся часы клиента, не тот `BOT_TOKEN` на сервере. Не путать с `ALLOW_INSECURE_AUTH` — в проде он обязан быть выключен, сервер с ним не стартует (см. [SECURITY.md — аутентификация](./SECURITY.md#2-аутентификация)) |
| Планы-нули на «План дня» | Нет месячного плана точки (`store_month_plans`) — дневной снапшот (`store_plans`) материализуется из него автоматически, руками вносить не нужно (см. [FEATURES.md — планирование](./FEATURES.md#планирование)) |
| Касса «не та» | Формула `Δ = факт − (1С + 2000)`, не ошибка — см. [FEATURES.md — касса](./FEATURES.md#касса) |
| 404 на существующем роуте | Модуль не зарегистрирован в `routeModules` (`src/api/routes/index.ts`, **не** `app.ts` — регистрация вынесена туда в 20.11.0) — проверить, что новый файл добавлен в массив |
| Command Center пустой у сотрудника с ролью `senior` | Ожидаемо, не баг — `senior` намеренно не видит Command Center/кабинет супервайзера (см. [SECURITY.md — RBAC](./SECURITY.md#3-авторизация-rbac)) |
| Сервер не стартует после деплоя, `restartPolicyType: ON_FAILURE` ретраит бесконечно | Упавшая миграция — смотри `railway logs` на `❌ Миграции упали`. Чини **новым коммитом** (новая миграция, а не правка старой), не полагайся на автоматические ретраи — см. [RUNBOOK.md — откат миграции](./RUNBOOK.md#миграции-только-вперёд-без-отката) |
| `npm run smoke:frontend` падает | `frontend/js/` как директория не существует с 20.30.0 (полная миграция на `frontend/src/` → typed iife-бандлы, см. [ARCHITECTURE.md](./ARCHITECTURE.md)) — проверяется порядок подключения `dist/*.bundle.js` в `index.html`: те же классические `<script>`-теги делят одну глобальную область, бандл, использующий что-то до его объявления, падает `ReferenceError`. Смотри, какой конкретно бандл упал в выводе теста, и что он использует из ещё не загруженного |
| Раздел "Чат" не открывается / пустой экран | Смотри DevTools Console на JS-ошибку в `chat.bundle.js`; проверь, что `/dist/pages/chat.bundle.js` подключён в `index.html` и реально собран (`npm run build:frontend`) — см. [CHAT.md](./CHAT.md) |
| `401`/`403` на `/chat/*` | `401` — не прошёл `requireActive()` (не авторизован/сессия истекла); `403` — сотрудник неактивен/не той сети, чем ресурс (org-scope, см. [CHAT.md — tenant boundary](./CHAT.md#tenant-boundary)). Не путать одно с другим при диагностике |
| Сообщение отправляется, но realtime не приходит второму клиенту | Проверь DevTools Network → `wss://.../chat/ws`: если апгрейд не 101 (или соединения нет вообще) — фронтенд обязан быть на polling-фолбэке (`GET /chat/messages?after=` на интервале ~4с); если и polling не видно — реальный баг, не ожидаемое поведение. См. [CHAT.md — realtime](./CHAT.md#realtime-direct--websocket-иначе--polling) |
| Чат работает через Electron DIRECT, но "зависает"/не realtime через RELAY | Ожидаемо — текущий relay не поддерживает WS upgrade вообще, только `POST /forward`. Чат обязан продолжать работать через polling; если сообщения вообще не доходят (не только НЕ realtime) — это баг, см. [DESKTOP-TESTING.md — internal chat](./DESKTOP-TESTING.md#internal-chat-20570--a-separate-new-acceptance-item-not-a-re-run-of-71) |
| Вложение отклонено при загрузке (`dangerous_type`/`unsupported_type`/`extension_mime_mismatch`) | Ожидаемое поведение allowlist-валидации (магические байты + расширение + заявленный MIME должны совпасть) — не баг. Разрешённые типы см. в [CHAT.md — attachments](./CHAT.md#attachments) |
| Вложение "исчезло" до того, как сообщение отправлено | Prepared-вложение живёт 1 час без привязки к сообщению (TTL), затем orphan cleanup удаляет его — переоформить загрузку заново. См. [CHAT.md — attachments](./CHAT.md#attachments) |

## Быстрая живая проверка

```powershell
$base = "https://<app>.up.railway.app"
$h = @{ "X-Telegram-Id" = "ID" }  # только для локальной разработки / ALLOW_INSECURE_AUTH=true
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/access/status" -Headers $h
Invoke-RestMethod "$base/me" -Headers $h
```
