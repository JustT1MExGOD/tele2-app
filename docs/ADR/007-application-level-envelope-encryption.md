# 007 — Application-Level Envelope Encryption (Level 2), не E2EE

**Статус**: принято, реализовано (20.51.0). См. также [ADR/008](./008-e2ee-not-implemented.md)
— почему рядом НЕ появился настоящий E2EE-слой.

## Контекст

Владелец продукта запросил спроектировать криптографический слой защиты
данных, концептуально близкий к hybrid-ratcheting архитектуре (X25519 +
опциональный PQ KEM → DH ratchet → per-message AEAD). Явное условие: не
копировать схему буквально, не изобретать примитивы самостоятельно, и
приоритет — реальная безопасность, а не соответствие красивой диаграмме.

Аудит (repo-wide documentation audit, 20.50.1, до этой версии) уже
установил: `sales`/`plans`/`shifts`/`analytics` требуют backend-plaintext
для Command Center/AI/отчётов — их E2EE сломал бы продукт. Единственный
реальный кандидат на защиту содержимого — текст support-тикетов
(`support_tickets.message`/`admin_reply`, `support_messages.body`):
чувствительные личные обращения сотрудников, для которых at-rest дамп БД
— избыточная поверхность утечки, при этом admin ДОЛЖЕН читать их по
запросу (это и есть сама функция поддержки).

## Решение

Три чётких уровня защиты (README/SECURITY.md различают их явно, чтобы
Level 2 никогда не называли «E2EE»):

- **Level 1** — TLS (Railway/HTTPS), уже существовал, не тронут.
- **Level 2 (эта ADR)** — application-level envelope encryption:
  backend хранит зашифрованные данные, но расшифровывает их по
  требованию через KEK, которым сам владеет.
- **Level 3** — true E2EE, где backend принципиально не может
  расшифровать. Не реализован — см. ADR-008.

### Key hierarchy

```
Master Key / KEK (env, версионирован, ротируется)
       │
       ▼ HKDF, domain label t2/envelope/wrap-key/v1
  Wrap Key
       │
       ▼ AES-256-GCM
  Data Encryption Key (DEK) — CSPRNG, один на объект
       │
       ▼ AES-256-GCM
  ciphertext конкретного поля (support_tickets.message и т.д.)
```

KEK никогда не хранится в PostgreSQL — приходит из `ENCRYPTION_KEKS`
(env, JSON `{version: base64Key}`), версионирован
(`ENCRYPTION_ACTIVE_KEY_VERSION`), допускает rotation: `unwrapDek()`
резолвит любую известную версию, не только активную, поэтому старые
записи остаются читаемыми без re-encryption всего хранилища при смене
активной версии.

### Примитивы — только built-in Node crypto, ничего самописного

- **AEAD**: AES-256-GCM через `node:crypto` (`createCipheriv`/
  `createDecipheriv`), не XChaCha20-Poly1305 — Node не даёт
  extended-nonce ChaCha20 из коробки, а тянуть стороннюю библиотеку ради
  этого при уже достаточном built-in примитиве непропорционально (тот же
  принцип, что уже применён к `auth/password.ts` — `crypto.scrypt`, не
  bcrypt/argon2).
- **KDF**: HKDF-SHA256 через `node:crypto.hkdfSync` (built-in, RFC 5869).
- **CSPRNG**: `node:crypto.randomBytes`.

Нулевых новых npm-зависимостей — весь слой (`backend/src/security/
crypto/**`) построен на встроенном в Node/OpenSSL коде, гарантированно
собирается на Railway/Nixpacks.

### Versioned envelope

```json
{
  "v": 1,
  "alg": "aes-256-gcm",
  "kid": "2026-01",
  "dek": { "nonce": "...", "tag": "...", "ciphertext": "..." },
  "data": { "nonce": "...", "tag": "...", "ciphertext": "..." }
}
```

### AAD — привязка ciphertext к объекту

`canonicalAad()` сериализует `{type, id, ...}` детерминированно
(отсортированные ключи). Для `support_tickets`/`support_messages` — id
резервируется явным `nextval()` ДО `INSERT`, чтобы AAD мог включать
реальный, финальный id строки (а не быть привязан к чему-то более
слабому) — перенос ciphertext из одной строки в другую (даже с
одинаковым `employee_id`) ломает AEAD-tag, GCM отказывает расшифровать.

### Feature flag и downgrade-инвариант

`DATA_ENCRYPTION_ENABLED` управляет только НОВЫМИ записями. Чтение уже
зашифрованной строки расшифровывается всегда, независимо от текущего
состояния флага — выключение флага не делает старые тикеты
нечитаемыми и не «рассекречивает» их: `*_encrypted IS NOT NULL`
проверяется на каждом чтении отдельно от флага. Production-гвард в
`index.ts` (тот же приём, что уже у `BOT_TOKEN`) не даёт серверу
стартовать, если флаг включён, а `ENCRYPTION_KEKS`/
`ENCRYPTION_ACTIVE_KEY_VERSION` сломаны — тихая деградация в plaintext
недопустима.

## Альтернативы

| Вариант | Вердикт | Почему |
|---|:---:|---|
| XChaCha20-Poly1305 (сторонняя библиотека) | ❌ отклонено | Node не даёт extended-nonce ChaCha20 built-in; AES-256-GCM built-in уже даёт эквивалентные security properties для этой задачи без новой зависимости |
| Deterministic/searchable encryption на `phone`/`full_name` для сохранения exact-match lookup | ❌ отклонено в этом заходе | Требует отдельного keyed blind-index (HMAC) — новый класс риска (сам индекс становится search-таргетом), не тривиальное следствие «просто зашифровать колонку»; не запрошено владельцем продукта в этом заходе как первая цель |
| Шифровать `sales`/`plans`/`shifts`/`analytics` | ❌ отклонено | Backend легитимно требует plaintext (Command Center, AI Copilot, отчёты, forecast) — шифрование сломало бы продукт, не защитило бы его |
| Один master key напрямую на AEAD, без DEK-иерархии | ❌ отклонено | Компрометация единственного ключа раскрывала бы всё сразу; DEK-per-object + wrapped-DEK — стандартная envelope-схема (тот же паттерн, что AWS/GCP KMS), rotation не требует re-encrypt всего хранилища |
| Application-level envelope encryption на `support_tickets`/`support_messages` | ✅ принято | Реальный, не гипотетический кандидат — admin легитимно нуждается в plaintext по требованию (Level 2, не Level 3), at-rest дамп БД больше не раскрывает содержимое |

## Последствия

- Новый слой `backend/src/security/crypto/**` (types/errors/random/aead/
  kdf/key-provider/keyring/envelope/log/index) — переиспользуемая
  инфраструктура, НЕ подключена ни к одному другому полю сегодня;
  следующий кандидат подключается так же, как `support.ts`
  (`encryptOrKeep()`/`decryptOrKeep()` на уровне репозитория, прозрачно
  для роутов).
- Найден и исправлен попутный, не связанный с шифрованием баг:
  `markAnsweredByAdmin`/`markReopenedByUser`/`appendAdminReplyFallback`
  писали `updated_at = now()` в колонку, которой у `support_tickets`
  никогда не было (`support_tickets` не имеет `updated_at` — только
  `created_at`/`answered_at`/`resolved_at`/`sla_due_at`) — это давало
  необработанный `500` на КАЖДЫЙ `POST /support/tickets/:id/messages` от
  не-admin пользователя, никогда не пойманный тестами раньше. Убран как
  часть этого же прохода, зафиксирован новым isolation-тестом.
- 44 новых unit-теста (`tests/unit/crypto-envelope.test.ts`) + 6
  isolation-тестов через реальные роуты/Postgres
  (`tests/isolation/support-envelope-encryption.test.ts`), включая
  key rotation, повреждённый ciphertext, IDOR-регресс.

## Связанные документы

- [docs/DATA-SECURITY-ARCHITECTURE.md](../DATA-SECURITY-ARCHITECTURE.md) — таблица данных по классам защиты.
- [SECURITY.md — Cryptographic Data Protection](../SECURITY.md#cryptographic-data-protection).
- [ADR/008](./008-e2ee-not-implemented.md) — почему Level 3 (E2EE) не реализован.
