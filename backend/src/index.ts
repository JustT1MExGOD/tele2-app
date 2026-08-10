import './env.js'; // должен быть первым — см. комментарий в env.ts
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { startBot } from './bot/index.js';
import { startReportCron } from './cron/reports.js';
import { todayMoscow } from './utils/date.js';
import { runSmartAlertsTick } from './services/alerts.js';
import { announceReleaseIfNeeded } from './services/release-announce.js';

// Непримененные миграции — перед подъёмом приложения, не после: если схема
// не готова, сервер не должен успеть принять ни одного запроса.
try {
  const { applied } = await runMigrations();
  if (applied.length) console.log('📦 Применены миграции:', applied.join(', '));
} catch (e: any) {
  console.error('❌ Миграции упали, сервер не стартует:', e?.message || e);
  process.exit(1);
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
  announceReleaseIfNeeded().catch((e) => console.error('release announce:', e?.message || e));

  // умные алерты каждые 30 мин (внутри — только 11–21 МСК)
  setInterval(() => {
    runSmartAlertsTick().catch((e) => console.error('alerts tick:', e?.message || e));
  }, 30 * 60 * 1000);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
