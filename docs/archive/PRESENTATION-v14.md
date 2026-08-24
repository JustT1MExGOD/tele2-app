> Архив — версия 14.1, сентябрь 2025. Роуты/доли точек/PowerShell-скрипт
> ниже больше не соответствуют текущему API; `X-Telegram-Id` без initData
> не пройдёт auth на проде с 19.14.0. Актуальный сценарий —
> [docs/DEMO.md](../DEMO.md).

# T2 Sales — чеклист перед презентацией (v14.1)

## Критичные фиксы в этом пакете
1. Убран **дубль** `GET /supervisor/dashboard` (v8 + supervisor) — сервер больше не падает на старте.
2. Топ-7 на главной читает `top`/`top7` из `/dashboard` (раньше искал `leaders` → всегда пусто).
3. `/dashboard` и `/stats/daily` не роняют home при 500/сети.
4. FAB продажи всегда виден.
5. Версия **14.1**, доли точек **55 / 25 / 20**.

## Демо-сценарий (8–10 мин)

| # | Что показать | Как |
|---|--------------|-----|
| 1 | Health API | `GET /health` → ok + today МСК |
| 2 | Сотрудник | Mini App → Мой → план дня/месяца |
| 3 | Продажа | FAB → мульти-метрики → уведомление в чат |
| 4 | Комбо | Инструменты → расчёт комбо |
| 5 | График | месяц, цвета точек |
| 6 | Планы | месяц + materialize дневных (manager) |
| 7 | Касса | Δ = факт − (1С + 2000) |
| 8 | Live / Supervisor | просадки, health, тренд 14д |
| 9 | Обучение | кратко 2–3 шага |
| 10 | Бот | микро/итог PNG (или текст fallback) |

## Перед демо
```powershell
$base = "https://tele2-app-production.up.railway.app"
$h = @{ "X-Telegram-Id" = "ТВОЙ_ID" }
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/me" -Headers $h
Invoke-RestMethod "$base/dashboard"
Invoke-RestMethod "$base/supervisor/dashboard?days=14" -Headers $h
```

- Railway **1 replica**, без локального бота (нет 409).
- В БД: access_status=active, график на сегодня, месячные планы, materialize.
- Telegram: открыть Mini App **из бота**, не из браузера в первый раз.

## Если что-то красное
| Симптом | 30-сек фикс |
|---------|-------------|
| Application failed | логи: duplicate route / tsc |
| Топ пустой | уже починено: top/top7 |
| Supervisor 403 | role manager/admin/supervisor |
| Supervisor пустые точки | `supervisor_stores` или роль manager |
| 409 bot | BOT_POLLING=false или один инстанс |
| Планы 0 | PUT month plan + POST materialize |

## Фраза для комиссии
> Это не бот с таблицей — это операционная система смены: единый источник истины в Postgres, роли, live-аналитика и отчёты без копипасты.
