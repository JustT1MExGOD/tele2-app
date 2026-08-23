# 002 — In-memory кэш supervisor scope вместо Redis

**Статус**: принято, реализовано (19.25.0).

## Контекст

`resolveSupervisorStores()` — реальный hot path кабинета супервайзера и
Command Center — на каждую загрузку страницы гонял JOIN
`supervisor_sectors → organizations → stores`. Нужен был кэш, чтобы не
пересчитывать этот JOIN на каждый запрос.

## Решение

In-memory `Map` в процессе (`src/core/shared/scope-cache.ts`), TTL 5 минут,
точечная инвалидация (`invalidate(supervisorId)`) на `PUT
/supervisor/:id/sector` и `PATCH /employees/:id/role`, полная
(`invalidateAll()`) на `PUT /admin/org/:id`.

## Альтернативы

- **Redis** — рассмотрен и отклонён не из экономии, а по топологии: прод
  — 1 реплика Railway. `grammy`-бот на long-polling физически не живёт на
  двух инстансах одного `BOT_TOKEN` без `409 Conflict` от Telegram API,
  поэтому горизонтальное масштабирование прод-сервиса сейчас архитектурно
  исключено другим компонентом системы, не только этим кэшем. При одной
  реплике in-memory `Map` даёт ровно ту же корректность, что Redis, без
  нового managed-сервиса и без нового сетевого failure mode (Redis
  недоступен → что происходит с кэшем?).

## Последствия

- Redis понадобится, только если/когда прод перейдёт на несколько реплик
  — а это само по себе потребует сначала перевести бота с long-polling на
  webhook, отдельный, более крупный переход. До этого момента вводить
  Redis ради одного кэша — новая инфраструктура без пропорциональной
  выгоды.
- `GET /admin/cache-stats` (admin-only) — `{hits, misses, size, hitRate}`,
  ops/debug-метрика для проверки эффективности кэша на практике, не
  отдельный UI-экран.
