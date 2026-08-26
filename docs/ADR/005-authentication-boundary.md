# 005 — Authentication Boundary (Identity/Principal изолированы от Telegram)

**Статус**: принято, реализовано (20.9.0). Второй provider подключён в
20.35 (см. «Обновление» в конце документа) — предположение о будущем
второй provider'е из раздела «Альтернативы» ниже больше не гипотетическое.

## Контекст

Владелец продукта заложил в дорожную карту 20.8–20.20 пункт «Identity
Abstraction» — подготовить Core к тому, что Telegram может перестать быть
единственным способом входа (Web/Mobile/SSO в будущем). Изначальная
формулировка была шире, чем то, что реально стоило делать сейчас.

## Решение

Владелец продукта сам сузил объём до кодовой границы, без изменения
схемы БД:

- `src/auth/identity.ts` — provider-agnostic `Identity` (`{provider,
  providerId}`).
- `src/auth/providers/telegram.ts` + `telegram-verify.ts` — вся
  Telegram-специфика (initData/HMAC/заголовки), единственное место,
  которое про неё знает.
- `src/auth/principal.ts` — `Identity → Principal/AuthUser`,
  диспетчеризация по `provider` (сегодня только `'telegram'`, но реальный
  `switch`, не одна ветка с предположением).
- `src/auth/guards.ts` (бывший `middleware-auth.ts`) — тонкая Fastify-
  обвязка поверх этой границы, ре-экспортирует прежние имена (`Role`,
  `AuthUser`, `ROLE_LEVEL`, `canAssignRole`, `loadUser`) без изменений —
  ни один из ~30 роут-файлов, использующих их, не пришлось трогать.

```mermaid
flowchart LR
    HDR["X-Telegram-Init-Data"] --> PROV["auth/providers/telegram.ts<br/>+ telegram-verify.ts<br/>(единственное место, знающее про Telegram)"]
    PROV --> ID["Identity<br/>{provider, providerId}"]
    ID --> PRINC["auth/principal.ts<br/>loadUser(): Identity → Principal"]
    PRINC --> USER["AuthUser<br/>(request.user)"]
    USER --> GUARDS["auth/guards.ts<br/>requireAuth/requireManager/…"]
```

## Альтернативы

| Вариант | Вердикт | Почему |
|---|:---:|---|
| Полная модель `Identity → User → Employee` с таблицей `identities` (исходная формулировка) | ⏸ отложено | Без реального второго provider (Web/Mobile/SSO) миграция схемы под гипотетическую мультипровайдерность — преждевременная сложность. Будет сделана, когда появится конкретный второй provider |
| Оставить `AuthUser`/`Principal` как есть, просто переименовать файл | ❌ отклонено | Не создаёт реальный архитектурный шов, только перекладывает то же самое в другое место |
| Кодовая граница `Identity → Principal` без изменений схемы | ✅ принято | Закрывает реальную задачу (изоляция Telegram-специфики) без преждевременной инфраструктуры |

## Последствия

- Найден и исправлен баг ещё до пуша: первая версия положила `identity`
  прямо в тип `Principal` — оно тут же протекло в тело ответа `GET
  /access/status` (роут отдаёт `request.user` как есть). Исправлено —
  `Identity` остался параметром только у `loadUser()`, никогда частью
  возвращаемого `Principal`.
- Тесты (`tests/unit/auth-boundary.test.ts`) фиксируют саму границу:
  авторизационные примитивы физически не принимают `Identity` в
  сигнатуре; `loadUser()` с гипотетическим будущим provider отдаёт
  безопасный guest, не пытаясь трактовать его как Telegram.

## Обновление (20.35) — второй provider стал конкретным

Причина: Telegram в стране бизнеса доступен только через VPN (риск
доступности для любого сотрудника, не только сценарий "неудобно с
ноутбука"), плюс реальные сотрудники без Telegram вообще.

`Identity.provider` расширен до `'telegram' | 'phone'`
(`src/auth/identity.ts`), `src/auth/providers/phone.ts` — второй адаптер,
зеркало `providers/telegram.ts`, но источник identity — cookie-сессия
(`data/repositories/sessions.ts`), не подписанный initData.
`principal.ts::loadUser()` получил реальный `if` по `identity.provider`
(предсказанный в тексте ADR выше — «диспетчеризация по provider»).
`guards.ts` не изменился ни в одной сигнатуре гварда — только точка
резолва identity в `resolveUser()` — граница сработала ровно так, как
задумывалась.

Полная модель `Identity → User → Employee` с таблицей `identities`
(строка "Альтернативы" выше) снова осознанно НЕ выбрана — `phone`+
`password_hash` легли на `employees` рядом с `telegram_id`, симметрично, а
не в отдельную таблицу: одного дополнительного provider'а недостаточно,
чтобы порог "мультипровайдерность больше не гипотетическая" был пройден
для полной схемы, только для кодовой границы.

## Связанные документы

- [SECURITY.md — аутентификация](../SECURITY.md#2-аутентификация)
