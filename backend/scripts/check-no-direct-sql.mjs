#!/usr/bin/env node
/**
 * Data Access Layer, 19.22.0 — запрет прямого SQL из routes для перенесённых
 * на repositories сущностей. Не ESLint (в проекте его вообще нет — заводить
 * целиком ради одного правила непропорционально), просто маленький grep
 * по allowlist'у файлов, которые уже обязаны ходить только через
 * src/repositories/*.
 *
 * Ratchet: список растёт по мере переноса следующих сущностей (Employees,
 * Sales, Schedules — см. README §22). Откат уже перенесённого файла на
 * сырой SQL — красный CI, а не молчаливая деградация.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CLEAN_FILES = [
  'src/routes-stores.ts',

  // 20.8.0 (Full DAL), батч 1 — foundation: employees/organizations/
  // supervisor-sectors/access-requests/audit + middleware-auth.ts.
  'src/routes-employees.ts',
  'src/routes-avatar.ts',
  'src/routes-audit.ts',
  'src/routes-v8.ts',
  'src/middleware-auth.ts',
  'src/services/tenant.ts',

  // 20.8.0, батч 2 — sales (наивысший риск, sales-write.ts/audit.ts удалены,
  // логика перенесена дословно в repositories/sales.ts + sync-log.ts).
  'src/routes-sales.ts',

  // 20.8.0, батч 3 — остальные hardened/транзакционные пути: график
  // (upsert + preHandler-пара авторизации), касса, задачи, смены (гонки на
  // partial unique index + CAS-закрытие).
  'src/routes-schedules.ts',
  'src/routes-cash.ts',
  'src/routes-tasks.ts',
  'src/routes-shifts.ts',

  // 20.8.0, батч 4 (алерты) — генерация/список/ack/status/what-if apply.
  'src/services/alerts.ts',
  'src/services/anomaly.ts',
  'src/routes-live-alerts.ts',
  'src/routes-command-center.ts',
  'src/services/plans.ts',
  'src/services/supervisor-analytics.ts',
  'src/services/live-map.ts',
  'src/services/insights.ts',
  'src/routes-me.ts',
  'src/services/forecast.ts',
  'src/services/report-image.ts',
  'src/routes-stats.ts',
  'src/routes-export.ts',
  'src/routes-employee-profile.ts',
  'src/routes-store-profile.ts',
  'src/routes-comms.ts',
  'src/routes-forecast.ts',
  'src/routes-insights.ts',
  'src/routes-support.ts',
  'src/routes-bfq.ts',
  'src/routes-metrics.ts',
  'src/routes-promos.ts',
  'src/routes-core.ts',
  'src/services/what-if.ts',
  'src/services/shift-pace.ts',
  'src/services/network-digest.ts',
  'src/services/bfq.ts',
  'src/services/gamification.ts',
  'src/services/metrics-catalog.ts',
  'src/services/heatmap.ts',
  'src/services/release-announce.ts',
  'src/services/ai.ts',
  'src/cron/reports.ts',
  'src/cron/alerts.ts',

  // Full DAL (20.8.0) закрыт этим батчем — весь backend теперь ходит в
  // Postgres только через src/repositories/*, ratchet больше нечего расширять.

  // Уже были без прямого SQL до 20.8.0 — фиксируем сразу, чтобы не остались
  // без защиты ratchet'а.
  'src/routes-v14.ts',
  'src/routes-supervisor.ts',
  'src/routes-reports.ts',
  'src/routes-plans-v5.ts',
  'src/services/telegram-auth.ts',
  'src/services/svg-render-pool.ts',
  'src/services/scope-cache.ts',
  'src/services/sales-nlp.ts'
];

// withTransaction() — оркестрация (BEGIN/COMMIT/ROLLBACK), не сам SQL: сами
// запросы внутри неё идут через инжектированную query-функцию в вызовы
// repositories/* (20.8.0, Full DAL) — поэтому импорт withTransaction из
// db/index.js "чистому" файлу разрешён, а query/pool — нет.
const FORBIDDEN = [
  /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s+['"].*\/db\/index\.js['"]/,
  /import\s*\{[^}]*\bpool\b[^}]*\}\s*from\s+['"].*\/db\/index\.js['"]/,
  /\bpool\.(query|connect)\b/
];

let failed = false;

for (const rel of CLEAN_FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.error(`❌ ${rel} — в allowlist, но файла не существует`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(full, 'utf8');
  for (const pattern of FORBIDDEN) {
    if (pattern.test(content)) {
      console.error(`❌ ${rel} — прямой доступ к БД запрещён, используй src/repositories/ (совпадение: ${pattern})`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nDATA ACCESS LAYER: найден прямой SQL в файле(ах), помеченных как "чистые".');
  process.exit(1);
}

console.log(`OK — ${CLEAN_FILES.length} файл(ов) без прямого SQL (${CLEAN_FILES.join(', ')})`);
