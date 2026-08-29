# 008 — E2EE / device identity / ratchet / post-quantum: PLANNED, не реализовано

**Статус**: рассмотрено и осознанно НЕ реализовано (20.51.0). Не «отменено
навсегда» — если появится реальный продуктовый triggering event (см.
ниже), это первый документ, который нужно пересмотреть.

## Контекст

Тот же запрос, что привёл к [ADR/007](./007-application-level-envelope-encryption.md),
описывал полную hybrid-ratcheting архитектуру: device cryptographic
identity, X3DH/PQXDH-class handshake, Double Ratchet, XChaCha20-Poly1305,
опциональный ML-KEM post-quantum слой — Signal-класса E2EE-мессенджинг
поверх продукта.

Запрос сам содержал явный STOP condition (§47 исходного брифа): если для
полноценного слоя требуется самописная криптография или он не имеет
реальной цели — остановиться на безопасном имплементированном уровне и
объяснить блокер, а не выполнять формальный чек-лист в ущерб
безопасности или продуктовому смыслу.

## Решение

**Blocker — не технический, продуктовый: в T2 Sales сегодня нет ни одной
фичи, которая была бы 1:1 приватной перепиской между двумя людьми.**
Аудит (repo-wide documentation audit, 20.50.1) прошёл по каждому
freeform-text месту в схеме:

| Кандидат | Кто читает plaintext сегодня | Вывод |
|---|---|---|
| `channels`/`channel_messages` | Любой сотрудник в сети/точке — нет таблицы участников вообще | Broadcast, не DM |
| `task_comments` | Assignee + creator + любой manager/supervisor/admin сети | Team-видимость — это и есть фича |
| `support_tickets`/`support_messages` | Владелец + ЛЮБОЙ admin системы (не org-scoped) | Admin-видимость — это и есть фича поддержки (стало Level 2, ADR-007) |
| `shift_sessions.handover_note` | Кто угодно, кто следующим откроет смену на точке | Анонимный store-scoped broadcast, не 2-party |
| `announcements` | Вся сеть | Broadcast |

Ни в схеме, ни в роутах, ни во фронтенде нет концепции `recipient_id`/
`participant`/`conversation` — 1:1 переписка между конкретными
сотрудниками физически не существует как feature.

Строить device identity → handshake → ratchet → PQ hybrid ради
несуществующего private channel означало бы:

1. Спроектировать и заранее захардкодить продуктовую фичу (кому и зачем
   писать друг другу приватно), которую владелец продукта не запрашивал
   отдельно от этого крипто-брифа — не инженерное решение, а
   product-scope invention.
2. Поставить постоянную инфраструктуру (device revocation, prekeys,
   ratchet state persistence, safety numbers) на поддержку без единого
   экрана, который бы её использовал.
3. Нарушить сам STOP condition исходного запроса — строить архитектуру
   ради соответствия диаграмме, не ради реальной защиты.

Решение подтверждено с владельцем продукта явным выбором («не строить
сейчас») перед реализацией.

## Статус по каждому компоненту (§50 отчётный формат)

| Компонент | Статус | Комментарий |
|---|---|---|
| X25519 / X3DH-class handshake | NOT IMPLEMENTED | Нет private channel, который бы его использовал |
| ML-KEM / post-quantum hybrid | NOT IMPLEMENTED | Ни один зрелый Node/browser-стек не был даже оценён — блокер продуктовый, не библиотечный |
| Device cryptographic identity | NOT IMPLEMENTED | `employee_id`/`telegram_id`/session token остаются НЕ криптографической identity — правильно, но отдельного device-key концепта нет |
| Double Ratchet / per-message forward secrecy | NOT IMPLEMENTED | Требует handshake выше |
| Device revocation API | NOT IMPLEMENTED | Не нужен без device identity |
| Application-level envelope encryption (Level 2) | ✅ IMPLEMENTED | См. ADR-007 — другой, реально нужный слой |

## Альтернативы

| Вариант | Вердикт | Почему |
|---|:---:|---|
| Реализовать полный E2EE-стек «на будущее», без текущего потребителя | ❌ отклонено | Постоянная сложность/поверхность атаки без пользы сегодня; §47 исходного брифа прямо просит остановиться в этом случае |
| Реализовать только device identity + местозаполнение (без handshake/ratchet), «задел» | ❌ отклонено | Ключи без протокола, который их использует — мёртвый код с реальным операционным весом (revocation, хранение публичных ключей), не подготовка, а риск |
| Явно задокументировать PLANNED со честным объяснением блокера, вернуться к вопросу, если появится реальная фича приватных сообщений | ✅ принято | Соответствует и STOP condition брифа, и практике проекта (`docs/ADR/002` — та же логика «нет реального триггера, не строим Redis заранее») |

## Что стало бы триггером пересмотра

- Владелец продукта явно запрашивает 1:1 private messaging как отдельную
  продуктовую фичу (не как часть крипто-брифа) — с экраном, UX,
  сценарием использования.
- До этого момента раздел остаётся PLANNED — не «отменено», а «нет
  задачи, которую он решает».

## Связанные документы

- [ADR/007](./007-application-level-envelope-encryption.md) — что реально реализовано (Level 2).
- [SECURITY.md — Cryptographic Data Protection](../SECURITY.md#cryptographic-data-protection).
- [docs/DATA-SECURITY-ARCHITECTURE.md](../DATA-SECURITY-ARCHITECTURE.md).
