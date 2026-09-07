# Разработка

[Документация](README.md) · [Обзор проекта](../README.md)

Инструкция для локальной разработки, проверок и изменения схемы. Команды ниже рассчитаны на отдельную локальную БД; рабочие подключения для тестов не используются.

**Содержание**

- [Быстрый старт](#быстрый-старт)
- [Цикл разработки](#цикл-разработки)
- [Тесты](#тесты)
- [Переменные окружения](#переменные-окружения)
- [Соглашения](#соглашения)
- [Связанные документы](#связанные-документы)

## Быстрый старт

Требуется **Node 22.x** (`backend/package.json` → `engines.node`) и доступ
к PostgreSQL (`DATABASE_URL`).

```bash
cd backend
npm ci
# Создайте backend/.env с DATABASE_URL локальной БД до запуска.
npm run build
npm start
curl -s localhost:3000/health
```

## Цикл разработки

Миграции применяются сами при старте сервера — ни на проде, ни локально
не нужно катить их отдельной командой после `npm start`/деплоя.

```mermaid
flowchart TB
    CODE["Правка кода"] --> TSC["npx tsc --noEmit"]
    TSC --> FE{"Менялся — frontend/src/?"}
    FE -- да --> BUILD["npm run build:frontend"]
    FE -- нет --> SMOKE
    BUILD --> SMOKE["npm run smoke:frontend"]
    SMOKE --> TESTFE["npm run test:frontend"]
    TESTFE --> VITEST["npx vitest run — (локальный одноразовый Postgres)"]
    VITEST --> COMMIT["git commit"]
    COMMIT --> PUSH["git push origin main"]
    PUSH --> CI["Railway: build → migrate → start"]
    CI --> ONLINE["● Online"]
```

`tsc` ловит TS-ошибки бэкенда, `smoke:frontend` — `ReferenceError` от
неправильного порядка подключения `dist/*.bundle.js` в `index.html`
(классические `<script>`-теги делят одну глобальную область, как и раньше
с `frontend/js/*.js` до 20.30.0 — сама проверка та же, изменился только
объект проверки), тесты — регресс авторизации/
изоляции сети/бизнес-корректности/security. CI (`.github/workflows/ci.yml`) применяет миграции к одноразовому PostgreSQL, выполняет статические проверки, собирает интерфейс и запускает тесты. Развёртывание Railway и запуск рабочего сервера — отдельный процесс.

## Тесты

Тесты пишут и удаляют данные через реальные роуты — только на
**локальный** одноразовый Postgres, никогда на прод (жёсткая проверка в
`tests/setup.ts`: `DATABASE_URL` обязан указывать на
`localhost`/`127.0.0.1`).

```bash
# 1. одноразовый Postgres — любым способом, репозиторий не диктует, каким
#    именно; например одной командой через Docker (без docker-compose.yml,
#    его в репозитории нет):
docker run -d --name t2-test-pg -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:18

# 2. создать backend/.env.test.local (в репозиторий не попадает):
# DATABASE_URL=postgresql://postgres:test@127.0.0.1:5432/postgres

cd backend
export DATABASE_URL='postgresql://postgres:test@127.0.0.1:5432/postgres'
export BOT_TOKEN=''
export GROQ_API_KEY=''
export BOT_POLLING=false
npm run migrate   # один раз — накатить схему (backend/migrations/)
npm test
```

Миграционный CLI читает обычный `.env`, а тесты — `.env.test.local`. Поэтому в примере `DATABASE_URL` явно задан в окружении и одинаков для обеих команд. В PowerShell используйте `$env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5432/postgres"`. Дождитесь готовности PostgreSQL перед миграцией. `BOT_POLLING=false` отключает получение обновлений Telegram, но само по себе не запрещает все исходящие сообщения; используйте отдельные тестовые настройки без рабочего токена.

Прогнать один конкретный файл (быстрее, чем весь набор, при точечной
отладке):

```bash
npx vitest run tests/isolation/quick-sale-sync.test.ts
npx vitest run tests/adversarial/cross-tenant-write.test.ts
```

Что-то не сходится (тест падает без понятной причины, `session_expired`
в тестах, `409` при параллельном прогоне) — [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

| Слой | Где | Что проверяет |
|------|-----|-----------------|
| `tests/unit/` | Чистые функции | RBAC-примитивы, forecast-модель, job-logger — без БД |
| `tests/isolation/` | Реальные роуты (`app.inject()`) | Org-scoping, race conditions, идемпотентность — против настоящего Postgres |
| `tests/adversarial/` | Реальные роуты | Закреплённая память о прошлых инцидентах — auth bypass, unauthenticated disclosure, cross-tenant IDOR, identity spoofing (подробнее — [SECURITY.md](./SECURITY.md#тестовое-покрытие)) |
| `frontend/tests/` | jsdom | Typed API-клиент + мигрированные страницы (`npm run test:frontend`) |

## Переменные окружения

| Переменная | Нужно | Описание |
|----------|:---:|----------|
| `DATABASE_URL` | да | Postgres |
| `BOT_TOKEN` | да (прод) | BotFather — без него сервер не стартует в `RAILWAY_ENVIRONMENT=production` |
| `PORT` | Railway | Порт HTTP-сервера |
| `ADMIN_TELEGRAM_ID` | желательно | admin |
| `MINI_APP_URL` | да в production | HTTPS-адрес приложения. Проверяется при запуске и участвует в проверке ожидаемого origin для CSRF |
| `REPORT_CHAT_ID` | желательно | глобальный фолбэк-чат отчётов (по умолчанию — чат сети из `organizations.chat_id`) |
| `RELEASE_CHANNEL_ID` | нет | отдельный Telegram-канал для автоанонса версий (с 18.11.0) — без него анонс тихо пропускается |
| `BOT_POLLING` | нет | `false` отключает `getUpdates` (для второй локальной копии) |
| `ALLOW_INSECURE_AUTH` | нет | `true` включает dev-фоллбэк на голый `X-Telegram-Id` без проверки initData — **сервер откажется стартовать с этим в проде**, см. [SECURITY.md](./SECURITY.md#2-аутентификация) |
| `GROQ_API_KEY` | нет | ключ сервиса Groq — включает AI Copilot; без ключа ИИ-функции не выполняют запросы к сервису |
| `GROQ_MODEL` | нет | override модели, дефолт `llama-3.3-70b-versatile` |
| `DATA_ENCRYPTION_ENABLED` | нет | `true` включает Конвертное шифрование на уровне приложения (20.51.0) для support-тикетов — новые записи шифруются; без флага (по умолчанию) поведение как раньше, открытый текст. Чтение уже зашифрованных строк не зависит от флага, см. [SECURITY.md — Cryptographic Data Protection](./SECURITY.md#10-cryptographic-data-protection) |
| `ENCRYPTION_KEKS` | нужно, если `DATA_ENCRYPTION_ENABLED=true` | JSON `{"<version>":"<base64 32 байта>", ...}` — все известные версии master key (KEK), включая уже неактивные (для чтения старых записей после rotation). Никогда не коммитить реальные значения |
| `ENCRYPTION_ACTIVE_KEY_VERSION` | нужно, если `DATA_ENCRYPTION_ENABLED=true` | Версия из `ENCRYPTION_KEKS`, которой шифруются НОВЫЕ записи. Сервер откажется стартовать, если версия не найдена в `ENCRYPTION_KEKS` (см. `assertEncryptionConfigValid()`, `src/index.ts`) |

## Соглашения

- [ ] Фичи — свой файл в `src/api/routes/<группа>/<имя>.ts` (по домену — см.
      [ARCHITECTURE.md](./ARCHITECTURE.md)) + добавить в `routeModules` в
      `src/api/routes/index.ts`
- [ ] Даты только МСК (`todayMoscow()`, не `new Date()`/UTC контейнера)
- [ ] Изменение схемы БД — новый `backend/migrations/00NN_описание.sql`, не
      ad hoc SQL на Railway
- [ ] Роуты, отдающие чужие/сетевые данные — всегда через `requireAuth`/
      `requireActive`/… + org-scope ([SECURITY.md](./SECURITY.md)), никогда
      голый заголовок в обход `authPlugin`
- [ ] Сущности — через Слой доступа к данным (`src/data/repositories/*`), не
      собственным `query()`; CI (`npm run check:no-direct-sql`) ловит откат
- [ ] Один bot polling (`BOT_POLLING=false` для второй локальной копии)
- [ ] Не коммитить `.env`
- [ ] Новый/правленый frontend-файл — настоящий ES-модуль (`frontend/src/`,
      `import`/`export`), собирается Vite'ом в IIFE-бандл
      (`npm run build:frontend`), контракт с бэкендом — через
      `backend/src/shared/api-types.ts`, не заново описанные типы.
      `frontend/js/` как директория не существует с 20.30.0 — миграция
      закрыта полностью, писать в неё уже нечего
- [ ] Версионирование — `MINOR` для эпика/функции, `PATCH` для исправления/рефакторинга, changelog-запись в `src/platform/notifications/changelog.ts`
      только для эпиков, не хотфиксов ([CHANGELOG.md](../CHANGELOG.md) —
      история версий длиннее, чем changelog-анонсы)

## Связанные документы

- [ARCHITECTURE.md](./ARCHITECTURE.md) — структура репозитория и диаграмма
  потока запроса.
- [SECURITY.md](./SECURITY.md) — слои защиты, RBAC, тестовое покрытие.
- [API.md](./API.md) — таблица эндпоинтов и уровней доступа.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — симптом → причина.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — конвенции коммитов.
