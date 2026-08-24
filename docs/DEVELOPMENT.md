# Разработка

> Извлечено из README §16/§23 при репо-реструктуризации (20.11.0),
> оформлено в справочный вид (пайплайн, таблицы) при обновлении docs вслед
> за `SECURITY.md` (20.13.0).

## Быстрый старт

Требуется **Node 22.x** (`backend/package.json` → `engines.node`) и доступ
к PostgreSQL (`DATABASE_URL`).

```bash
cd backend
npm ci
npm run build
npm start
curl -s localhost:3000/health
```

## Цикл разработки

Миграции применяются сами при старте сервера — ни на проде, ни локально
не нужно катить их отдельной командой после `npm start`/деплоя.

```mermaid
flowchart LR
    CODE["Правка кода"] --> TSC["npx tsc --noEmit"]
    TSC --> FE{"Менялся<br/>frontend/src/?"}
    FE -- да --> BUILD["npm run build:frontend"]
    FE -- нет --> SMOKE
    BUILD --> SMOKE["npm run smoke:frontend"]
    SMOKE --> TESTFE["npm run test:frontend"]
    TESTFE --> VITEST["npx vitest run<br/>(локальный одноразовый Postgres)"]
    VITEST --> COMMIT["git commit"]
    COMMIT --> PUSH["git push origin main"]
    PUSH --> CI["Railway: build → migrate → start"]
    CI --> ONLINE["● Online"]
```

`tsc` ловит TS-ошибки бэкенда, `smoke:frontend` — `ReferenceError` от
неправильного порядка `frontend/js/*.js`, тесты — регресс авторизации/
изоляции сети/бизнес-корректности/security. Тот же путь `build → migrate →
start` выполняет CI (`.github/workflows/ci.yml`) на каждый push — Postgres
поднимается в одноразовом контейнере, схема накатывается тем же
`npm run migrate`, что и на проде.

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
npm run migrate   # один раз — накатить схему (backend/migrations/)
npm test
```

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

| Variable | Нужно | Описание |
|----------|:---:|----------|
| `DATABASE_URL` | да | Postgres |
| `BOT_TOKEN` | да (прод) | BotFather — без него сервер не стартует в `RAILWAY_ENVIRONMENT=production` |
| `PORT` | Railway | listen port |
| `ADMIN_TELEGRAM_ID` | желательно | admin |
| `REPORT_CHAT_ID` | желательно | глобальный фолбэк-чат отчётов (по умолчанию — чат сети из `organizations.chat_id`) |
| `RELEASE_CHANNEL_ID` | нет | отдельный Telegram-канал для автоанонса версий (с 18.11.0) — без него анонс тихо пропускается |
| `BOT_POLLING` | нет | `false` отключает `getUpdates` (для второй локальной копии) |
| `ALLOW_INSECURE_AUTH` | нет | `true` включает dev-фоллбэк на голый `X-Telegram-Id` без проверки initData — **сервер откажется стартовать с этим в проде**, см. [SECURITY.md](./SECURITY.md#2-аутентификация) |
| `GROQ_API_KEY` | нет | ключ Groq (console.groq.com, free tier, без карты) — включает AI Copilot; без ключа обе функции no-op'ают |
| `GROQ_MODEL` | нет | override модели, дефолт `llama-3.3-70b-versatile` |

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
- [ ] Сущности — через Data Access Layer (`src/data/repositories/*`), не
      собственным `query()`; CI (`npm run check:no-direct-sql`) ловит откат
- [ ] Один bot polling (`BOT_POLLING=false` для второй локальной копии)
- [ ] Не коммитить `.env`
- [ ] Frontend-файл, переехавший на TypeScript (`frontend/src/`) — настоящий
      ES-модуль (`import`/`export`), собирается Vite'ом в IIFE-бандл
      (`npm run build:frontend`), контракт с бэкендом — через
      `backend/src/shared/api-types.ts`, не заново описанные типы. Файлы, ещё
      не переехавшие, остаются в `frontend/js/` классическими скриптами без
      изменений
- [ ] Версионирование — MINOR на каждую сущностную правку (фича, фикс,
      рефактор), changelog-запись в `src/platform/notifications/changelog.ts`
      только для эпиков, не хотфиксов ([CHANGELOG.md](../CHANGELOG.md) —
      история версий длиннее, чем changelog-анонсы)

## Связанные документы

- [ARCHITECTURE.md](./ARCHITECTURE.md) — структура репозитория и диаграмма
  потока запроса.
- [SECURITY.md](./SECURITY.md) — слои защиты, RBAC, тестовое покрытие.
- [API.md](./API.md) — таблица эндпоинтов и уровней доступа.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — симптом → причина.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — конвенции коммитов.
