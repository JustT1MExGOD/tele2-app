# Data Security Architecture

> Для каждого значимого класса данных проекта — нужен ли backend
> plaintext, как именно данные защищены, кто владеет ключом, что
> происходит при потере ключа/доступа, сколько данные живут. Дополняет
> [SECURITY.md — Cryptographic Data Protection](./SECURITY.md#cryptographic-data-protection)
> (как устроено технически) и [THREAT-MODEL.md](./THREAT-MODEL.md) (от
> чего защищаемся). Архитектурное решение и альтернативы —
> [ADR/007](./ADR/007-application-level-envelope-encryption.md),
> [ADR/008](./ADR/008-e2ee-not-implemented.md).

## Принцип

Backend легитимно требует plaintext везде, где он сам обрабатывает
данные — аналитика, AI Copilot, отчёты, Command Center. Шифрование таких
данных не «более безопасно», оно ломает продукт без выигрыша: сервер
всё равно расшифровывает их на каждый запрос, а ключ всё равно должен
быть у него. Application-level encryption имеет смысл только там, где
реальная угроза — не сам backend в рабочем режиме, а *дамп/утечка БД в
состоянии покоя* (backup, replica, скомпрометированный оператор с
read-доступом к диску, а не к работающему приложению).

## Таблица данных

| Data class | Server needs plaintext? | Encryption | Key owner | Recovery model | Retention |
|---|:---:|---|---|---|---|
| `sales`/`plans`/`shifts`/`store_cash` | Да (аналитика, Command Center, отчёты) | Нет — plaintext в Postgres, защищено TLS (Level 1) + org-scope/RBAC | — | Обычный backup Railway | Бессрочно (бизнес-история) |
| `employees.full_name`/`role`/`org_id` | Да (везде, где отображается/фильтруется) | Нет | — | Обычный backup | Пока активен + после увольнения (история продаж ссылается на `employee_id`) |
| `employees.telegram_id` | Да (auth-резолв, бот-уведомления) | Нет — но lookup всегда точный (`UNIQUE`), сам по себе не низкоэнтропийный секрет | — | Обычный backup | Пока привязан |
| `employees.phone` | Да (login lookup, точное совпадение) | Нет — deterministic exact-match lookup (`identities.provider_key`); randomized encryption сломала бы `WHERE phone = $1` без отдельного blind-index (см. [ADR/007 — альтернативы](./ADR/007-application-level-envelope-encryption.md#альтернативы)), не реализовано в этом заходе | — | Обычный backup | Пока привязан |
| `employees.password_hash` | Нет — сервер никогда не расшифровывает пароль, только сравнивает | `crypto.scrypt` (необратимый KDF, не encryption) — см. [SECURITY.md — аутентификация](./SECURITY.md#2-аутентификация) | — | Сброс пароля выпускает новый хеш, старый просто отбрасывается | До следующего сброса/деактивации |
| `employee_sessions.token_hash`, `employee_password_resets.token_hash` | Нет — сервер хранит только `sha256(token)`, сырой токен только у клиента | Хеш (`sha256`), не encryption — опрокинуть некуда, сравнение только "совпал/не совпал" | — | Reuse после истечения/отзыва невозможен по конструкции (строка удалена/`expires_at` прошёл) | 30 дней (сессия) / 1 час (reset token) |
| `audit_log.before`/`after` | Да (admin-обзор истории действий) | Нет | — | Обычный backup | Бессрочно (подотчётность — см. §7 SECURITY.md) |
| `ai_audit.prompt`/`response` | Да (AI Copilot сам генерирует и логирует) | Нет | — | Обычный backup | Бессрочно (диагностика AI-поведения) |
| `support_tickets.message`/`admin_reply`, `support_messages.body` | Да, ПО ЗАПРОСУ (owner/admin читают на лету — это функция поддержки) | **Level 2 — application-level envelope encryption** (AES-256-GCM, DEK per-object, wrapped KEK) — см. [ADR/007](./ADR/007-application-level-envelope-encryption.md) | Backend (KEK в `ENCRYPTION_KEKS`, вне PostgreSQL) | KEK потерян → эти записи невосстановимы (честно, не скрытый мастер-ключ «для удобства» — см. §31 инвариант) | Как обычные тикеты (не удаляются автоматически) |
| `channels`/`channel_messages`, `task_comments`, `announcements`, `shift_sessions.handover_note` | Да (team/org-wide broadcast — видимость команде это и есть фича) | Нет — не приватные данные по дизайну, см. [ADR/008](./ADR/008-e2ee-not-implemented.md) | — | Обычный backup | Бессрочно |
| `BOT_TOKEN`/`DATABASE_URL`/`GROQ_API_KEY` | Не данные, секреты рантайма | Вне кода/БД — Railway env | Владелец продукта (Railway dashboard) | Ротация — [RUNBOOK.md](./RUNBOOK.md) | Пока не скомпрометирован |
| Приватная переписка сотрудник↔сотрудник (E2EE, Level 3) | **Не существует как фича** | Не реализовано | — | — | — |

## Почему не E2EE «на всякий случай»

Application encryption и E2EE — разные инструменты для разных угроз.
E2EE защищает от *самого backend* (honest-but-curious operator,
скомпрометированный сервер). У T2 Sales нет данных, для которых это
осмысленная модель угроз — Command Center, отчёты, AI Copilot и
поддержка все легитимно требуют, чтобы backend видел содержимое.
Внедрение E2EE-инфраструктуры (device identity, ratchet, key exchange)
без реального private-channel — это добавление постоянной сложности и
поверхности атаки без защиты чего-либо. Подробное обоснование —
[ADR/008](./ADR/008-e2ee-not-implemented.md).

## Связанные документы

- [SECURITY.md — Cryptographic Data Protection](./SECURITY.md#cryptographic-data-protection)
- [THREAT-MODEL.md](./THREAT-MODEL.md)
- [ADR/007](./ADR/007-application-level-envelope-encryption.md), [ADR/008](./ADR/008-e2ee-not-implemented.md)
