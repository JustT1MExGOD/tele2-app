import './env.js'; // должен быть первым — см. комментарий в env.ts
import { buildApp } from './app.js';
import { runMigrations } from './data/db/migrate.js';
import { pool } from './data/db/index.js';
import { bot, startBot, notifyAdmin } from './integrations/telegram/bot.js';
import { startReportCron } from './cron/reports.js';
import { startDigestCron } from './cron/digest.js';
import { startAlertCron } from './cron/alerts.js';
import { startMessageCleanupCron } from './cron/message-cleanup.js';
import { todayMoscow } from './utils/date.js';
import { runSmartAlertsTick } from './core/alerts/service.js';
import { announceReleaseIfNeeded } from './platform/notifications/release-announce.js';
import { runJob } from './cron/job-logger.js';
import { assertEncryptionConfigValid, assertProductionEncryptionRequired, CryptoConfigError } from './security/crypto/index.js';
import { validateProductionConfig, ConfigValidationError } from './config/validate.js';

/**
 * Раньше падение миграции/старта было видно только в Railway logs, которые
 * никто не смотрит проактивно — сервер тихо крашлупился (restartPolicy),
 * а узнавали только случайно (17.5.0/17.5.1). notifyAdmin уже существовал
 * (bot/index.ts) — просто не был здесь подключён. gate — bot собран на
 * верхнем уровне bot/index.ts, доступен независимо от startBot()/поллинга,
 * так что алерт уходит даже если сервер падает ДО обычного старта бота.
 * Таймаут — на случай недоступности Telegram API, чтобы не подвесить сам
 * процесс перед process.exit(1) (весь смысл — упасть быстро и заметно).
 */
async function alertAndExit(prefix: string, err: unknown): Promise<never> {
  const message = (err as any)?.message || String(err);
  console.error(`${prefix}:`, message);
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.race([
    notifyAdmin(`🔴 T2 Sales: ${prefix.replace(/^❌\s*/, '')}\n${message}`).catch(() => {}),
    timeout
  ]);
  process.exit(1);
}

// Прод-гварды — до всего остального: раньше отсутствие BOT_TOKEN в проде
// тихо переводило auth в insecure-режим (голый X-Telegram-Id без проверки
// подписи), а ALLOW_INSECURE_AUTH=true в проде вообще не имел никакого
// стоппера. RAILWAY_ENVIRONMENT ставится самим Railway (значение — имя
// окружения, 'production' для прод-сервиса) — тем самым сюда не попадает
// `npm run dev` на машине разработчика, где обеих переменных обычно нет.
if (process.env.RAILWAY_ENVIRONMENT === 'production') {
  if (process.env.ALLOW_INSECURE_AUTH === 'true') {
    await alertAndExit(
      '❌ ALLOW_INSECURE_AUTH=true в production, сервер не стартует',
      new Error('ALLOW_INSECURE_AUTH must not be true in production')
    );
  }
  if (!process.env.BOT_TOKEN) {
    await alertAndExit(
      '❌ Нет BOT_TOKEN в production, сервер не стартует',
      new Error('BOT_TOKEN is required in production')
    );
  }
  // Auth Assurance Hardening (20.52.1, §9) — TOTP secrets are real
  // authentication material now (data/repositories/mfa.ts refuses to
  // store them any other way, see the fail-closed guard there), so
  // production silently running with DATA_ENCRYPTION_ENABLED off is no
  // longer an acceptable degraded mode — it must not start at all.
  try {
    assertProductionEncryptionRequired();
  } catch (e) {
    if (e instanceof CryptoConfigError) {
      await alertAndExit('❌ Шифрование обязательно в production, сервер не стартует', e);
    }
    throw e;
  }
  // §P1-A (20.54.0) — MINI_APP_URL silently disables the CSRF Origin
  // check and WebAuthn RP config when unset (see config/validate.ts);
  // same fail-closed treatment as the guards above, not a degraded mode.
  try {
    validateProductionConfig();
  } catch (e) {
    if (e instanceof ConfigValidationError) {
      await alertAndExit('❌ Некорректная конфигурация production, сервер не стартует', e);
    }
    throw e;
  }
}

// Application-Level Envelope Encryption (Phase B, 20.51.0) — если
// DATA_ENCRYPTION_ENABLED=true, а ENCRYPTION_KEKS/ENCRYPTION_ACTIVE_KEY_
// VERSION сломаны или отсутствуют, сервер не должен стартовать и молча
// писать/читать plaintext вместо шифрования (тот же принцип, что уже
// применён к BOT_TOKEN выше — не «поехать небезопасно»). Проверяется во
// ВСЕХ окружениях, не только production: `assertEncryptionConfigValid()`
// сама no-op'ает, если флаг выключен.
try {
  assertEncryptionConfigValid();
} catch (e) {
  if (e instanceof CryptoConfigError) {
    await alertAndExit('❌ Некорректная конфигурация шифрования, сервер не стартует', e);
  }
  throw e;
}

// Непримененные миграции — перед подъёмом приложения, не после: если схема
// не готова, сервер не должен успеть принять ни одного запроса.
try {
  const { applied } = await runMigrations();
  if (applied.length) console.log('📦 Применены миграции:', applied.join(', '));
} catch (e: any) {
  await alertAndExit('❌ Миграции упали, сервер не стартует', e);
}

// registerAllRoutes() (внутри buildApp()) теперь бросает, если хотя бы
// один доменный route-модуль не смог зарегистрироваться (20.52.1 —
// раньше молча продолжал с частью роутов отсутствующей, см. комментарий
// в api/routes/index.ts) — тот же alertAndExit, что у миграций/шифрования.
let app;
try {
  app = await buildApp();
} catch (e: any) {
  await alertAndExit('❌ Сборка приложения упала, сервер не стартует', e);
}

// ===== START =====
const port = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Сервер на 0.0.0.0:${port}`);
  console.log(`📅 Сегодня (МСК): ${todayMoscow()}`);

  startBot().catch((e) => console.error('Bot failed:', e.message || e));
  const reportCronHandle = startReportCron();
  const digestCronTask = startDigestCron();
  // 20.10.0 — раньше был написан (services/alerts.ts docstring это явно
  // предполагало — "подключи в startReportCron или отдельный cron"), но
  // нигде не вызывался: «Контроль 14:00» (сотрудники без продаж на смене)
  // и «Отставание точек 16:00» никогда не срабатывали в проде.
  const alertCronTask = startAlertCron();
  const messageCleanupTask = startMessageCleanupCron();
  announceReleaseIfNeeded().catch((e) => console.error('release announce:', e?.message || e));

  // умные алерты каждые 30 мин (внутри — только 11–21 МСК)
  const smartAlertsHandle = setInterval(() => {
    runJob('alerts.smart_tick', () => runSmartAlertsTick());
  }, 30 * 60 * 1000);

  /**
   * 20.17.0 (Recovery — graceful shutdown). Раньше SIGTERM (Railway шлёт
   * его старому контейнеру на каждом деплое, когда новый уже прошёл
   * healthcheck — README §17) убивал процесс дефолтным поведением Node:
   * мгновенно, без единого шанса доотдать уже начатые HTTP-ответы. На
   * практике это тихо било по каждому деплою — не 409 (тот уже закрыт
   * Replicas=1 + деплой-гейтом на CI + atomic-claim в cron_send_log), а
   * оборванные на середине запросы к клиенту, тому самому единственному
   * старому контейнеру, что как раз доживал последние миллисекунды.
   *
   * Порядок важен: сначала перестаём принимать НОВУЮ работу (HTTP,
   * крон-тики, бот-поллинг), потом закрываем пул — не наоборот, иначе
   * ещё летящий запрос лишится соединения с БД посреди обработки.
   * Фоновые джобы, уже начатые ДО сигнала (не HTTP-запросы, а внутренний
   * cron tick) — не дожидаемся отдельно; это тот же риск обрыва, что был
   * и раньше, graceful shutdown его не увеличивает и не решает.
   *
   * Жёсткий таймаут — Railway даёт какой-то grace period между SIGTERM и
   * SIGKILL, но не документирует точное значение публично; 8с — заведомо
   * консервативный запас, лучше выйти самим чуть раньше, чем получить
   * SIGKILL посреди уже начатого graceful-останова.
   */
  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} получен — начинаю graceful shutdown`);

    const hardTimeout = setTimeout(() => {
      console.error('graceful shutdown не уложился в таймаут — process.exit(1)');
      process.exit(1);
    }, 8_000);
    hardTimeout.unref();

    clearInterval(reportCronHandle);
    digestCronTask.stop();
    alertCronTask.stop();
    messageCleanupTask.stop();
    clearInterval(smartAlertsHandle);

    try {
      await app.close(); // добивает начатые HTTP-ответы, новые не принимает
    } catch (e: any) {
      console.error('app.close() failed:', e?.message || e);
    }

    // isRunning() — только если polling реально шёл (BOT_POLLING=false или
    // bot ещё не успел стартовать — bot.stop() иначе лишний раз сходил бы
    // в Telegram API подтвердить последний offset, которого не было).
    if (bot?.isRunning()) {
      try {
        await bot.stop();
      } catch (e: any) {
        console.error('bot.stop() failed:', e?.message || e);
      }
    }

    try {
      await pool.end();
    } catch (e: any) {
      console.error('pool.end() failed:', e?.message || e);
    }

    console.log('graceful shutdown завершён');
    clearTimeout(hardTimeout);
    process.exit(0);
  }
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
} catch (err) {
  app.log.error(err);
  await alertAndExit('❌ Сервер не смог запуститься (listen)', err);
}
