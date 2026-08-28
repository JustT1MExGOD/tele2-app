#!/usr/bin/env node
/**
 * Web Security & Trust Layer, часть 2 (20.49.0) — регресс-барьер против
 * самых опасных JS-паттернов на фронтенде. Модель — check-no-direct-sql.mjs
 * (маленький grep по FORBIDDEN-регекспам, без ESLint/AST), но без allowlist
 * "уже мигрированных" файлов — нет естественного подмножества, как был
 * DAL-ratchet, поэтому обходим ВСЮ src/-директорию фронтенда целиком.
 *
 * Сознательно НЕ включает эвристику "innerHTML без esc() поблизости" —
 * слишком расплывчато для чистого regex без AST (высокий false-positive
 * rate); реальные найденные XSS-дыры (store name/custom-metric label/
 * promo note без esc(), jsEsc()/JSON.stringify() в onclick без HTML-
 * экранирования) закрыты адресно в 20.49.0, не через паттерн-мэтчинг.
 * Все 4 паттерна ниже дают 0 совпадений на момент написания — check
 * фиксирует уже достигнутую чистоту как барьер на будущее.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'frontend', 'src');

const FORBIDDEN = [
  { name: 'document.write', pattern: /document\.write\(/ },
  { name: 'eval', pattern: /(?<![\w.])eval\(/ },
  { name: 'new Function', pattern: /new Function\(/ },
  { name: 'setTimeout/setInterval со строкой', pattern: /set(?:Timeout|Interval)\(\s*['"`]/ }
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.tsx?$/.test(entry.name)) continue;
    const base = entry.parentPath ?? entry.path ?? dir;
    out.push(path.join(base, entry.name));
  }
  return out;
}

const files = walk(TARGET_DIR);
let failed = false;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const { name, pattern } of FORBIDDEN) {
    if (pattern.test(content)) {
      console.error(`❌ ${rel} — запрещённый паттерн "${name}"`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nDANGEROUS JS PATTERNS: найден запрещённый паттерн — document.write/eval/new Function/строковый setTimeout-setInterval.');
  process.exit(1);
}

console.log(`OK — ${files.length} файл(ов) frontend/src без запрещённых JS-паттернов (document.write, eval, new Function, строковый setTimeout/setInterval)`);
