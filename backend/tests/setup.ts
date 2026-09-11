/**
 * Единая точка входа vitest — выполняется до импорта любого тестового файла,
 * а значит и до того, как что-либо (buildApp() → db/index.ts) прочитает
 * DATABASE_URL и откроет пул соединений.
 *
 * Изоляционные тесты пишут (INSERT/UPDATE/DELETE) фикстуры прямо через
 * реальные роуты — прогнать их по ошибке на прод-БД означает намусорить в
 * проде на каждом прогоне. Это не то же самое, что ручная разовая проверка
 * через .env.test (см. историю сеанса) — там разработчик сам следит за
 * тем, что делает; здесь тесты гоняются автоматически, доверять дисциплине
 * недостаточно. Поэтому — жёсткий guard, а не просто соглашение.
 */
import dotenv from 'dotenv';
import { beforeAll } from 'vitest';

// Необязательный личный файл разработчика для локального запуска — если
// его нет, dotenv тихо ничего не делает. НЕ коммитится (см. .gitignore).
dotenv.config({ path: '.env.test.local' });

const dbUrl = process.env.DATABASE_URL || '';
const isLocal = /(^|@)(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl);

if (!isLocal && process.env.ALLOW_REMOTE_TEST_DB !== 'true') {
  throw new Error(
    'DATABASE_URL для тестов должен указывать на localhost/127.0.0.1 ' +
    '(одноразовый Postgres для тестов), а не на прод — тесты пишут и ' +
    'удаляют данные. Локально: создай backend/.env.test.local с ' +
    'DATABASE_URL на свой локальный Postgres. В CI переменная уже ' +
    'выставлена на service-контейнер (.github/workflows/ci.yml).'
  );
}

// Нужен, чтобы authPlugin принимал X-Telegram-Id вместо реальной подписи
// Telegram initData — тесты авторизуются заголовком, как и безопасный
// локальный сервер весь этот сеанс.
process.env.ALLOW_INSECURE_AUTH = 'true';

// Auth Assurance Hardening (20.52.1, §8) — TOTP secrets now fail closed
// without encryption configured (data/repositories/mfa.ts), so the test
// suite needs a real (test-only, never a production value) key by
// default for MFA enrollment to work at all. `if (!process.env...)` so
// tests that explicitly manage these vars themselves (crypto-envelope.test.ts,
// support-envelope-encryption.test.ts — they save/restore process.env
// per-test) aren't affected; this only fills in a default when nothing
// else has opinions yet.
if (!process.env.DATA_ENCRYPTION_ENABLED) process.env.DATA_ENCRYPTION_ENABLED = 'true';
if (!process.env.ENCRYPTION_KEKS) {
  process.env.ENCRYPTION_KEKS = JSON.stringify({ 'test-1': Buffer.alloc(32, 7).toString('base64') });
}
if (!process.env.ENCRYPTION_ACTIVE_KEY_VERSION) process.env.ENCRYPTION_ACTIVE_KEY_VERSION = 'test-1';

// 17-layer security hardening pass — `security/rate-limit.ts`'s
// Postgres-backed distributed limiter (security_rate_limit_counters) is
// keyed by real dimensions (IP, account/phone-hash) that many test FILES
// independently exercise against the SAME `/auth/login`-shaped routes
// from the SAME test-runner IP (127.0.0.1). Unlike the in-memory
// @fastify/rate-limit (which resets with each file's own fresh app
// instance — see buildApp()'s module-level cache), this table is real
// Postgres state shared across every file in the run: one file's
// legitimate volume (or another file, like login-rate-limit.test.ts,
// DELIBERATELY tripping the limiter to test it) can silently exhaust the
// budget for a completely unrelated file's single, ordinary login call
// later in the same run/window — a real, reproducible flake this exact
// class of accumulation caused in CI (not a stale-local-DB artifact).
// vitest's default `isolate: true` re-runs every `setupFiles` entry
// fresh per test file (confirmed by this project's existing behavior:
// helpers/app.ts's own app-instance cache already resets per file the
// same way) — so clearing this table here, once per file, keeps each
// file's rate-limit budget independent of what any other file already
// did, without touching the actual limits themselves (still exactly as
// strict against a real attacker within any one file's own test run).
beforeAll(async () => {
  // Best-effort, whole-thing wrapped — some unit test files (e.g.
  // tests/unit/chat-realtime-bridge.test.ts) `vi.mock('pg', ...)` with a
  // partial mock (no `types`/`Pool`) that makes db/index.ts's own
  // top-level `pg.types.setTypeParser(...)` throw on import; those files
  // never touch the real DB at all, so skipping this cleanup for them is
  // correct, not just tolerated.
  try {
    const { query } = await import('../src/data/db/index.js');
    await query(`DELETE FROM security_rate_limit_counters`);
  } catch (_) {}
});
