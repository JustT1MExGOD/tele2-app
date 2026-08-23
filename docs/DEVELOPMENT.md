# Разработка

> Извлечено из README §16/§23 при репо-реструктуризации (20.11.0).

## Локальный запуск

```bash
cd backend
npm ci
npm run build
npm start
curl -s localhost:3000/health
```

## Тесты (изоляция сети, эпик 17.0)

Тесты пишут и удаляют данные через реальные роуты — только на **локальный**
одноразовый Postgres, никогда на прод (жёсткая проверка в `tests/setup.ts`:
`DATABASE_URL` обязан указывать на `localhost`/`127.0.0.1`).

```bash
# создать backend/.env.test.local (в репозиторий не попадает) с
# DATABASE_URL на свой локальный Postgres, например:
# DATABASE_URL=postgresql://postgres@127.0.0.1:5432/t2_test

cd backend
npm run migrate   # один раз — накатить схему (backend/migrations/)
npm test
```

В CI (`.github/workflows/ci.yml`) то же самое происходит автоматически на
каждый push — Postgres поднимается в одноразовом контейнере, схема
накатывается тем же `npm run migrate`, что и на проде.

## Переменные окружения

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

## Соглашения

1. Фичи — свой файл в `src/api/routes/<группа>/<имя>.ts` (по домену — см.
   `ARCHITECTURE.md`) + добавить в `routeModules` в `src/api/routes/index.ts`
2. Даты только МСК (`todayMoscow()`, не `new Date()`/UTC контейнера)
3. Изменение схемы БД — новый `backend/migrations/00NN_описание.sql`, не
   ad hoc SQL на Railway
4. Перед push: `npx tsc --noEmit`, `npm run build:frontend` (если менялся
   `frontend/src/`), `npm run smoke:frontend`, `npm run test:frontend`
   (если есть frontend-тесты), полный `npx vitest run` на одноразовом
   локальном Postgres — build ловит TS-ошибки бэкенда, smoke:frontend
   ловит ReferenceError от неправильного порядка `frontend/js/*.js`,
   тесты — регресс авторизации/изоляции сети/бизнес-корректности/security
5. Не коммитить `.env`
6. Роуты, отдающие чужие/сетевые данные — всегда через `requireAuth`/
   `requireActive`/… + org-scope (см. `SECURITY.md`), никогда голый
   заголовок в обход `authPlugin`
7. Один bot polling (`BOT_POLLING=false` для второй локальной копии)
8. Версионирование — MINOR на каждую сущностную правку (фича, фикс,
   рефактор), changelog-запись в `src/changelog.ts` (`platform/notifications/`)
   только для эпиков, не хотфиксов (см. README §21 — история версий
   длиннее, чем changelog-анонсы)
9. Сущности на Data Access Layer (`SECURITY.md`, `src/data/repositories/`)
   — доступ к ним из роутов только через репозиторий, не собственным
   `query()`; CI (`npm run check:no-direct-sql`) на этом ловит откат
10. Frontend-файл, переехавший на TypeScript (`frontend/src/`) —
    настоящий ES-модуль (`import`/`export`), собирается Vite'ом в
    IIFE-бандл (`npm run build:frontend`), контракт с бэкендом — через
    `backend/src/shared/api-types.ts`, не заново описанные типы. Файлы,
    ещё не переехавшие, остаются в `frontend/js/` классическими скриптами
    без изменений
