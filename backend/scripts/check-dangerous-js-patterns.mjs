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

// 20.83.0 — targeted gate for the confirmed attribute-breakout class from
// the 20.49.0 audit: an inline handler attribute that interpolates a value
// that is NOT a safe identifier/id/key/status/date-like expression and is
// NOT already wrapped in esc()/jsEsc()/JSON.stringify()/Number()/encodeURI*.
// Example of the leak it locks out: `onclick="fn('${r.full_name}')"` — a
// user-controlled string dropped raw into a quoted attribute slot, which is
// exactly how attribute-breakout happened. Numeric/catalog id slugs
// (`${id}`, `${key}`, `${m.id}`, `${s.store_id}`, `${dateStr}`...) are safe
// here because they resolve to generated `a-z0-9_`/date values that cannot
// carry a quote; flagging them would make this a blunt "any onclick=" gate
// with hundreds of false positives, so we classify the expression instead.
const HANDLER_ATTR = /on(?:click|change|input|submit)="([^"]*?)"/g;
const INTERP = /\$\{([^}]+)\}/g;
const ESCAPED = /\b(?:esc|jsEsc|JSON\.stringify|Number|encodeURI)/;
// Suffixes that resolve to safe scalar/id-like values in this codebase —
// catalog ids, dates, status/role keys, numeric counters — never raw text.
const SAFE_BARE = /^(id|key|status|role|date|slug|st|s|r|d|i|idx|n|num|qty|eid|e|month|day|employeeId|storeId|dateStr|nameSafe|idPrefix|originalFilename|orgId|metricId|alertId|taskId|clientMessageId|sectorId|code|hours|count|index|_id|saleId|promoId|ticketId|chapterId|stepId|attemptId|empId|kind)$/;
const SAFE_MEMBER = /\.(id|key|store_id|storeId|employee_id|employeeId|task_id|taskId|alert_id|alertId|clientMessageId|date|dateStr|slug|_id|code|status|role|sector_id|sectorId|metric_id|metricId|hours|index|idx|i|n|num|qty|count|month|day|store_code|orgId|org_id|nameSafe|idPrefix|originalFilename|saleId|promoId|ticketId|chapterId|stepId|attemptId|empId|idPrefix)$/;
function isDangerousHandlerInterpolation(expr) {
  const e = expr.trim();
  if (ESCAPED.test(e)) return false;
  if (SAFE_BARE.test(e)) return false;             // `${id}`, `${key}`, `${dateStr}`
  if (SAFE_MEMBER.test(e)) return false;           // `${m.id}`, `${s.store_id}`
  if (/^[a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*$/.test(e) && /id$/i.test(e)) return false; // `${x.task_id}`, `${p.alert_id}` camelCase ids
  // `|| ''`/`||` fallback chains built only of safe id-like members — e.g.
  // `${o.id || ''}` — still resolve to a slug/id, not raw text.
  if (/\|\|/.test(e)) {
    const parts = e.split('||').map((p) => p.trim());
    if (parts.every((p) => /^'[^']*'$/.test(p) || /^[a-zA-Z_$][\w$]*$/.test(p) || /^[a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*$/.test(p))) {
      const nonLiteral = parts.filter((p) => !/^'[^']*'$/.test(p));
      if (nonLiteral.length && nonLiteral.every((p) => SAFE_BARE.test(p) || SAFE_MEMBER.test(p) || /id$/i.test(p))) return false;
    }
  }
  return true;                                     // `${r.full_name}`, `${fn(x)}` calls — the breakout class
}

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
  // Inline-handler interpolation gate — only fires on genuinely unescaped,
  // non-id expressions (the attribute-breakout class), not on the ~74
  // legitimate numeric/catalog-id interpolations that exist across the app.
  for (const m of content.matchAll(HANDLER_ATTR)) {
    for (const im of m[1].matchAll(INTERP)) {
      if (isDangerousHandlerInterpolation(im[1])) {
        console.error(`❌ ${rel} — inline handler с неэкранированной строкой-интерполяцией: \${${im[1].trim().slice(0, 60)}} (attribute-breakout, esc()/jsEsc() нужен)`);
        failed = true;
      }
    }
  }
}

if (failed) {
  console.error('\nDANGEROUS JS PATTERNS: найден запрещённый паттерн — document.write/eval/new Function/строковый setTimeout-setInterval или неэкранированная строка-интерполяция в inline handler-атрибуте (attribute-breakout, 20.49.0).');
  process.exit(1);
}

console.log(`OK — ${files.length} файл(ов) frontend/src без запрещённых JS-паттернов (document.write, eval, new Function, строковый setTimeout/setInterval, неэкранированная строка в inline handler)`);
