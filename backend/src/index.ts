import './env.js'; // должен быть первым — см. комментарий в env.ts
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { startBot, notifyAdmin } from './bot/index.js';
import { startReportCron } from './cron/reports.js';
import { startDigestCron } from './cron/digest.js';
import { todayMoscow } from './utils/date.js';
import { runSmartAlertsTick } from './services/alerts.js';
import { announceReleaseIfNeeded } from './services/release-announce.js';

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
  announceReleaseIfNeeded().catch((e) => console.error('release announce:', e?.message || e));

  // умные алерты каждые 30 мин (внутри — только 11–21 МСК)
  setInterval(() => {
    runSmartAlertsTick().catch((e) => console.error('alerts tick:', e?.message || e));
  }, 30 * 60 * 1000);
} catch (err) {
  app.log.error(err);
  await alertAndExit('❌ Сервер не смог запуститься (listen)', err);
}
