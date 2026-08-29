# 009 — MFA (WebAuthn + TOTP + recovery codes) и channel-agnostic step-up

**Статус**: принято, реализовано (20.52.0); дополнено 20.52.1 (см.
"20.52.1 revision" ниже — mandatory-политика ужесточена).

## Контекст

Принципиальный security-аудит (repo-wide, 20.52.0) потребовал сильный MFA
для privileged-ролей (admin/supervisor) и step-up auth для опасных
действий (выдача роли admin, сброс чужого пароля/MFA). Явные ограничения
брифа: не писать WebAuthn/TOTP-криптографию самостоятельно, не считать
Telegram-аутентификацию саму по себе эквивалентом privileged MFA, не
ломать существующую Telegram/phone-аутентификацию.

Ключевая сложность: у Telegram-запросов НЕТ server-side сессии
(`initData` перепроверяется заново каждый раз, см. ADR-005) — значит
привычная схема "step-up = MFA было пройдено недавно В ЭТОЙ СЕССИИ"
(проверка `session.mfa_verified_at > now() - N minutes`) физически не
применима к Telegram-администраторам, у которых просто нет объекта
сессии, куда можно было бы записать эту свежесть.

## Решение

### Библиотеки — только vetted, ничего самописного

- **WebAuthn**: `@simplewebauthn/server` + `@simplewebauthn/browser`
  (SimpleWebAuthn — широко используемая, поддерживаемая реализация).
- **TOTP**: `otplib` v13 — top-level `generateSecret()`/`verify()` по
  умолчанию используют `NobleCryptoPlugin` (`@noble/hashes`) и
  `ScureBase32Plugin` (`@scure/base`) — оба одного автора (paulmillr),
  широко аудированы, без ручного выбора примитивов.
- **Recovery codes**: `crypto.randomBytes` (CSPRNG) + `sha256`-хеш
  (opaque bearer secret, не recoverable material — см. §44 брифа,
  правильная модель — hash, не encryption).

Ноль самописной криптографии, ноль новых крипто-протоколов.

### Login-time второй фактор — свойство АККАУНТА, не роли

`POST /auth/login` (phone+password) проверяет не роль, а факт: есть ли у
аккаунта подтверждённый TOTP/WebAuthn. Если да — пароль выдаёт не
сессию, а `mfa_token` (опаяque, 5 минут, single-use,
`mfa_pending_logins`); `POST /auth/mfa/login` довершает вход после
проверки второго фактора. Роль здесь ни при чём напрямую — mandatory-для-
admin/supervisor политика обеспечивается ДРУГИМ механизмом (ниже), не
блокировкой логина без факта.

### Step-up — channel-agnostic opaque ticket, не session-freshness

Вместо "сессия недавно прошла MFA" — короткоживущий (10 минут) непрозрачный
bearer-тикет (`mfa_step_up_tickets`), полученный через `POST
/auth/mfa/step-up` (проверка TOTP/WebAuthn/recovery-code ПРЯМО СЕЙЧАС) и
переданный опасному запросу заголовком `X-Step-Up-Token`. Работает
одинаково для Telegram- и browser-аутентифицированных пользователей —
ticket не привязан ни к какой сессии, только к `employee_id`.

### Как на самом деле обеспечивается "MFA обязателен для admin"

Не блокировкой ВСЕГО API до enrollment'а (это потребовало бы отдельного
гейта на каждый роут или middleware-перехватчик всего трафика — риск
случайно заблокировать что-то легитимное или, наоборот, забыть роут).
Вместо этого: `POST /auth/mfa/step-up` физически отказывается выдать
тикет, если у аккаунта нет ни одного подтверждённого фактора
(`mfa_not_configured`, 400). Поскольку все опасные действия (выдача роли
admin, сброс чужого пароля, сброс чужого MFA) требуют этот тикет —
получается тот же результат ("без MFA админ не может делать опасные
вещи"), но реализовано через один узкий, тестируемый барьер, а не
распределённую по всему API политику.

`GET /auth/mfa/status`'s `enrollment_required` — честный флаг для
фронтенда ("покажи баннер"), не серверное принуждение само по себе.

### Last-factor removal guard (MFA-3)

Отключение TOTP или отзыв WebAuthn-credential для admin/supervisor
блокируется (`last_mfa_factor`, 400), если после этого у аккаунта не
останется ни одного подтверждённого фактора — сначала нужно добавить
другой. Для обычных ролей (MFA не обязателен политикой) — разрешено
свободно.

### Session hardening заодно

- Idle-таймаут (14 дней) — сессия, к которой не притрагивались, больше не
  резолвится, даже если абсолютный TTL не истёк.
- Более короткий абсолютный TTL для admin/supervisor (7 дней вместо 30).

## Альтернативы

| Вариант | Вердикт | Почему |
|---|:---:|---|
| Session-based step-up freshness (`session.mfa_verified_at`) | ❌ отклонено | Не работает для Telegram — там нет сессии, куда класть эту свежесть |
| Блокировка всего API до MFA enrollment (middleware-перехватчик) | ❌ отклонено | Широкий blast radius одной ошибки в списке исключений; де-факто эквивалентный результат достигается уже без него |
| SMS как основной MFA | ❌ отклонено | Прямо запрещено брифом (§3) — SIM-swap риск, не primary-grade фактор |
| Считать Telegram-логин сам по себе privileged MFA | ❌ отклонено | Прямо запрещено брифом (AUTH-2 инвариант) |
| WebAuthn-only (без TOTP) | ❌ отклонено | Бриф явно требует TOTP как совместимый fallback — не у каждого privileged-пользователя есть passkey-совместимое устройство сразу |
| Channel-agnostic step-up ticket + step-up-gated dangerous actions как реальный enforcement MFA-политики | ✅ принято | Работает одинаково для Telegram/browser, узкий и тестируемый, не требует трогать 60+ роутов |

## Последствия

- Новые таблицы: `employee_totp`, `employee_webauthn_credentials`,
  `employee_recovery_codes`, `mfa_pending_logins`,
  `mfa_webauthn_challenges`, `mfa_step_up_tickets`
  (`migrations/0022_mfa.sql`); `employee_sessions.mfa_verified_at`.
- TOTP-секреты защищены той же envelope encryption, что support-тикеты
  (ADR-007) — переиспользование инфраструктуры, не новый слой.
- 35+ новых тестов (unit-style + isolation через реальные роуты/Postgres):
  login-branch, replay-защита TOTP, race-safe recovery codes,
  cross-employee/cross-ticket rejection, last-factor guard, admin MFA
  reset.
- **Известный пробел** (см. финальный отчёт): полноценная WebAuthn-
  церемония (реальный authenticator response) не покрыта end-to-end
  тестами — `@simplewebauthn/server`'s verify-функции требуют реальный
  или виртуальный authenticator, которого в этом заходе нет; покрыты
  только граничные проверки (malformed input, чужой credential id, ветка
  "не настроено").
- **Frontend UI для enrollment/login-MFA не реализован в этом заходе** —
  backend полностью функционален и покрыт тестами через прямые HTTP-
  вызовы, но нет экрана "введите код"/"настройте MFA" в
  `frontend/src/**`. Ни один существующий сотрудник не имеет
  MFA сегодня (миграция не бэкфиллит фактор никому), поэтому обратная
  совместимость логина не нарушена — просто новая возможность пока не
  выведена в интерфейс.

## 20.52.1 revision — Auth Assurance Hardening

Владелец продукта прямо потребовал ужесточить формулировку из
"Альтернативы" выше: "Блокировка всего API до MFA enrollment... ❌
отклонено — широкий blast radius" была верна на 20.52.0, но
недостаточна — step-up-gating опасных действий оставляет ОБЫЧНЫЕ
privileged-функции (Command Center, Команда, кабинет супервайзера)
доступными на голом AAL1, если у admin/supervisor ещё не настроен
фактор. Это противоречит явной цели "MFA обязателен для privileged", а
не только "для самых опасных из privileged действий".

**Новое решение** (не меняет ничего из принятого выше про WebAuthn/TOTP/
step-up-механику саму по себе): единая точка — `auth/assurance.ts` +
`auth/guards.ts::requireActive()`. `authPlugin` считает
`checkPrivilegedAssurance()` один раз на запрос (уже async, доп. запрос
не в отдельном месте); `requireActive()` (вызывается почти каждым
защищённым роутом) блокирует запрос с `403 mfa_enrollment_required`,
если роль privileged, а подтверждённого фактора нет — КРОМЕ явно
помеченных enrollment/status/logout-роутов (`{allowMfaEnrollment: true}`),
иначе enrollment стал бы физически недостижим для того самого аккаунта,
которому он нужен. Это работает одинаково для Telegram (принцип
пересчитывается заново на каждый запрос — блокировка так же свежая, как
сама аутентификация) и browser-сессий, без отдельной ветки на канал.

Второй, отдельный от "есть ли фактор вообще", уровень — конкретная
browser/phone-сессия САМА проходила ли MFA (`mfa_verified_at`), не
просто "у аккаунта есть фактор" — закрывает RESET-1/ROLE-1 (§4/§14/§15
брифа): сброс пароля для аккаунта с MFA больше не выдаёт сессию сразу
(`buildMfaChallengeResponse()`, тот же путь, что login), а повышение
роли до admin/supervisor отзывает существующие сессии сотрудника
(`sessionsRepo.deleteAllForEmployee`), чтобы уже открытая AAL1-сессия не
унаследовала privileged-доступ без MFA на следующий же запрос.

Остальные пункты этого прохода: idle-таймаут для privileged сокращён с
14 дней до 18 часов (админ, забывший закрыть вкладку на ночь, не должен
оставаться залогиненным до утра — 7-дневный абсолютный TTL делал
14-дневный idle бессмысленным); WebAuthn `userVerification` — `required`
для privileged-ролей (было `discouraged` при регистрации, но проверка
уже по умолчанию требовала UV — несогласованность, теперь явно и
одинаково с обеих сторон); step-up-тикет привязывается к конкретной
browser/phone-сессии, если она есть (`mfa_step_up_tickets.session_token_hash`,
0023) — украденный тикет не работает из другой сессии того же
сотрудника; TOTP-секрет больше не имеет plaintext-фолбэка при
выключенном шифровании (`upsertPendingTotp` бросает
`EncryptionDisabledError`); production обязан стартовать с
`DATA_ENCRYPTION_ENABLED=true` (было — только "если включено, то
корректно"); base64-парсинг KEK/AEAD-полей стал строгим
(`strictBase64Decode`, отклоняет non-canonical представление, которое
`Buffer.from()` тихо принимал).

## Связанные документы

- [SECURITY.md — MFA](../SECURITY.md#11-multi-factor-authentication-mfa)
- [THREAT-MODEL.md](../THREAT-MODEL.md)
- [ADR/005](./005-authentication-boundary.md) — почему у Telegram нет server-side сессии
- [ADR/007](./007-application-level-envelope-encryption.md) — переиспользованная crypto-инфраструктура для TOTP-секретов
