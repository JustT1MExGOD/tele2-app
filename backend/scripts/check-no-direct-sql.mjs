#!/usr/bin/env node
/**
 * Data Access Layer, 19.22.0 — запрет прямого SQL из routes/services для
 * перенесённых на repositories сущностей. Не ESLint (в проекте его вообще
 * нет — заводить целиком ради одного правила непропорционально), просто
 * маленький grep по allowlist'у файлов, которые уже обязаны ходить только
 * через src/data/repositories/*.
 *
 * Ratchet: список растёт по мере переноса следующих сущностей. Откат уже
 * перенесённого файла на сырой SQL — красный CI, а не молчаливая деградация.
 * Full DAL закрыт в 20.8.0 — весь backend ходит в Postgres только через
 * src/data/repositories/*, список ниже покрывает буквально весь backend
 * вне самого data/ слоя.
 *
 * 20.11.0 — пути обновлены под layered-структуру src/ (репо-реструктуризация:
 * api/routes/, core/<domain>/, data/, platform/, integrations/, auth/) —
 * набор файлов не изменился по содержанию, только по расположению; часть
 * файлов из старого routes-v8.ts/routes-v14.ts/routes-live-alerts.ts
 * разошлась по нескольким новым файлам при разбиении на домены.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CLEAN_FILES = [
  'src/api/routes/analytics/command-center.ts',
  'src/api/routes/auth/session.ts',
  'src/api/routes/auth/mfa.ts',
  'src/auth/mfa/totp.ts',
  'src/auth/mfa/webauthn.ts',
  'src/auth/mfa/recovery-codes.ts',
  'src/auth/mfa/index.ts',
  'src/auth/step-up.ts',
  'src/api/routes/auth/sessions-admin.ts',
  'src/api/routes/analytics/forecast.ts',
  'src/api/routes/analytics/heatmap.ts',
  'src/api/routes/analytics/insights.ts',
  'src/api/routes/analytics/live.ts',
  'src/api/routes/analytics/stats.ts',
  'src/api/routes/analytics/supervisor.ts',
  'src/api/routes/analytics/what-if.ts',
  'src/api/routes/audit.ts',
  'src/api/routes/bfq.ts',
  'src/api/routes/cash.ts',
  'src/api/routes/me/avatar.ts',
  'src/api/routes/me/index.ts',
  'src/api/routes/metrics.ts',
  'src/api/routes/ops/alerts.ts',
  'src/api/routes/ops/comms.ts',
  'src/api/routes/ops/export.ts',
  'src/api/routes/ops/reports.ts',
  'src/api/routes/ops/support.ts',
  'src/api/routes/ops/tasks.ts',
  'src/api/routes/org/access.ts',
  'src/api/routes/org/branding.ts',
  'src/api/routes/org/employees.ts',
  'src/api/routes/org/stores.ts',
  'src/api/routes/plans.ts',
  'src/api/routes/profiles/employee.ts',
  'src/api/routes/profiles/store.ts',
  'src/api/routes/promos.ts',
  'src/api/routes/sales.ts',
  'src/api/routes/schedules.ts',
  'src/api/routes/shifts.ts',
  'src/auth/guards.ts',
  'src/auth/csrf.ts',
  'src/auth/password.ts',
  'src/auth/providers/phone.ts',
  'src/auth/providers/telegram-verify.ts',
  'src/core/alerts/service.ts',
  'src/core/analytics/anomaly.ts',
  'src/core/analytics/forecast.ts',
  'src/core/analytics/heatmap.ts',
  'src/core/analytics/insights.ts',
  'src/core/analytics/live-map.ts',
  'src/core/analytics/network-digest.ts',
  'src/core/analytics/supervisor.ts',
  'src/core/analytics/what-if.ts',
  'src/core/bfq/service.ts',
  'src/core/employees/gamification.ts',
  'src/core/plans/service.ts',
  'src/core/reports/image.ts',
  'src/core/reports/svg-pool.ts',
  'src/core/sales/nlp.ts',
  'src/core/shared/metrics-catalog.ts',
  'src/core/shared/scope-cache.ts',
  'src/core/shared/tenant.ts',
  'src/core/shifts/pace.ts',
  'src/cron/alerts.ts',
  'src/cron/reports.ts',
  'src/integrations/ai/client.ts',
  'src/platform/notifications/release-announce.ts'
];

// withTransaction() — оркестрация (BEGIN/COMMIT/ROLLBACK), не сам SQL: сами
// запросы внутри неё идут через инжектированную query-функцию в вызовы
// data/repositories/* (20.8.0, Full DAL) — поэтому импорт withTransaction из
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
      console.error(`❌ ${rel} — прямой доступ к БД запрещён, используй src/data/repositories/ (совпадение: ${pattern})`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nDATA ACCESS LAYER: найден прямой SQL в файле(ах), помеченных как "чистые".');
  process.exit(1);
}

console.log(`OK — ${CLEAN_FILES.length} файл(ов) без прямого SQL (${CLEAN_FILES.join(', ')})`);
