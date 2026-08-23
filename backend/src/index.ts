import './env.js'; // должен быть первым — см. комментарий в env.ts
import { buildApp } from './app.js';
import { runMigrations } from './data/db/migrate.js';
import { startBot, notifyAdmin } from './integrations/telegram/bot.js';
import { startReportCron } from './cron/reports.js';
import { startDigestCron } from './cron/digest.js';
import { startAlertCron } from './cron/alerts.js';
import { todayMoscow } from './utils/date.js';
import { runSmartAlertsTick } from './core/alerts/service.js';
import { announceReleaseIfNeeded } from './platform/notifications/release-announce.js';
import { runJob } from './cron/job-logger.js';

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
}

// Непримененные миграции — перед подъёмом приложения, не после: если схема
// не готова, сервер не должен успеть принять ни одного запроса.
try {
  const { applied } = await runMigrations();
  if (applied.length) console.log('📦 Применены миграции:', applied.join(', '));
} catch (e: any) {
  await alertAndExit('❌ Миграции упали, сервер не стартует', e);
}

const app = await buildApp();

// ===== START =====
const port = Number(process.env.PORT) || 3000;

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Сервер на 0.0.0.0:${port}`);
  console.log(`📅 Сегодня (МСК): ${todayMoscow()}`);

  startBot().catch((e) => console.error('Bot failed:', e.message || e));
  startReportCron();
  startDigestCron();
  // 20.10.0 — раньше был написан (services/alerts.ts docstring это явно
  // предполагало — "подключи в startReportCron или отдельный cron"), но
  // нигде не вызывался: «Контроль 14:00» (сотрудники без продаж на смене)
  // и «Отставание точек 16:00» никогда не срабатывали в проде.
  startAlertCron();
  announceReleaseIfNeeded().catch((e) => console.error('release announce:', e?.message || e));

  // умные алерты каждые 30 мин (внутри — только 11–21 МСК)
  setInterval(() => {
    runJob('alerts.smart_tick', () => runSmartAlertsTick());
  }, 30 * 60 * 1000);
} catch (err) {
  app.log.error(err);
  await alertAndExit('❌ Сервер не смог запуститься (listen)', err);
}
