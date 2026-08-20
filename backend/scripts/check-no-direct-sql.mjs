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
  'src/routes-stores.ts'
];

const FORBIDDEN = [
  /from\s+['"].*\/db\/index\.js['"]/,
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
