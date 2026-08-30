#!/usr/bin/env node
/**
 * Route Auth Policy ratchet (Full Security & Reliability Hardening,
 * 20.53.0) — every `app.get/post/put/patch/delete(...)` registration in
 * api/routes/** must either call one of the recognized centralized
 * guards (requireActive/requireManager/requireSupervisor/
 * requireManagerOrSupervisor/requireAdmin/assertStepUp/requireStepUp,
 * or the requireStoreInOrg/requireEmployeeInOrg preHandler decorators)
 * within its own handler, OR be explicitly listed in PUBLIC_ROUTES below
 * with a reason. A route matching neither fails CI.
 *
 * Model: same allowlist+grep discipline as check-no-direct-sql.mjs — no
 * ESLint/AST in this project, a small script is proportionate. This is
 * NOT a substitute for reading the code; it only prevents a NEW route
 * from silently landing with no auth check AND no explicit sign-off
 * (the exact class of gap found by the 20.52.1 external audit — routes
 * quietly using requireAuth's weaker semantics, or no guard at all).
 *
 * Known limitation: detects named guard-function calls, not inline
 * `request.user?.employee_id` checks — the PUBLIC_ROUTES list below
 * covers the handful of routes that use such inline checks
 * intentionally (pre-auth/bootstrap flows), each with why. A genuinely
 * new unguarded route (inline check or none at all) that isn't in this
 * list fails CI and forces a deliberate decision, not a silent gap.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'src/api/routes');

const GUARD_PATTERNS = [
  'requireActive(', 'requireManager(', 'requireSupervisor(', 'requireManagerOrSupervisor(',
  'requireAdmin(', 'assertStepUp(', 'requireStepUp(', 'requireStoreInOrg(', 'requireEmployeeInOrg('
];

/**
 * Routes intentionally reachable without a centralized guard —
 * pre-authentication (login/register/reset), bootstrap identity flows
 * (before an employee_id/active-status exists to gate on), or
 * deliberately public read surfaces. Each has a one-line reason;
 * adding to this list is the "explicit sign-off" this ratchet exists to
 * force, not a way to bypass it quietly — a reviewer sees the diff.
 */
const PUBLIC_ROUTES = new Set([
  'POST /auth/register', // открытая регистрация — сам смысл роута
  'POST /auth/login', // primary credential check сам по себе
  'POST /auth/login/mfa', // pre-session — identity через mfa_token, не cookie/initData
  'POST /auth/login/mfa/webauthn/options', // pre-session, тот же mfa_token flow
  'POST /auth/logout', // должен работать даже с истёкшей/отсутствующей сессией (idempotent clear)
  'POST /auth/reset/:token', // токен в URL — сам секрет, это и есть доказательство личности
  'GET /avatars/:employeeId', // <img src> не может послать auth-заголовок; rate-limited известный trade-off
  'GET /me', // identity bootstrap — обязан отвечать 200/bound:false для не-привязанного пользователя
  'GET /me/day', // тот же bootstrap-паттерн, что /me — bound:false для неавторизованных
  'GET /me/access', // возвращает сам identity-объект, для ещё не активного пользователя тоже
  'POST /me/bind', // первая привязка Telegram → employee — до этого employee_id не существует
  'POST /me/link-phone', // самопривязка телефона — inline employee_id-check, до access_status активности не относится
  'GET /metrics', // бизнес-каталог меток (не продажи/кассы) — публичный список для форм/пикеров
  'GET /support/faq', // общий справочный контент, не тикеты
  'POST /support', // гостевой тикет поддержки — намеренно доступен ДО одобрения доступа
  'GET /access/status', // проверка статуса заявки САМА ПО СЕБЕ — до вынесения решения по заявке
  'GET /access/orgs', // публичный список сетей для формы регистрации — известный trade-off, rate-limited
  'GET /access/employees-directory', // публичный каталог для "я из списка" при регистрации — известный trade-off, rate-limited
  'POST /access/request', // сама заявка на доступ — inline telegram_id-check, до access_status активности
  'GET /branding' // публичное оформление (лого/цвета) для экрана логина
]);

function walk(dir) {
  let out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out = out.concat(walk(p));
    else if (f.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(ROUTES_DIR);
const violations = [];
let total = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/app\.(get|post|put|patch|delete)\(/.test(lines[i])) continue;
    const methodMatch = lines[i].match(/app\.(get|post|put|patch|delete)\(/);
    let routePath = null;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      const pm = lines[j].match(/['"`](\/[a-zA-Z0-9_\-:./]*)['"`]/);
      if (pm) { routePath = pm[1]; break; }
    }
    if (!routePath) continue;
    total++;
    const key = `${methodMatch[1].toUpperCase()} ${routePath}`;
    if (PUBLIC_ROUTES.has(key)) continue;

    let guarded = false;
    for (let j = i; j < Math.min(i + 40, lines.length); j++) {
      if (j !== i && /app\.(get|post|put|patch|delete)\(/.test(lines[j])) break;
      if (GUARD_PATTERNS.some((g) => lines[j].includes(g))) { guarded = true; break; }
    }
    if (!guarded) {
      violations.push(`${key} — ${path.relative(ROOT, file)}:${i + 1}`);
    }
  }
}

if (violations.length) {
  console.error('❌ Route(s) without a recognized auth guard and not in PUBLIC_ROUTES allowlist:\n');
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '\nEvery business route must call a centralized guard (requireActive/requireManager/…). ' +
    'If this route is genuinely meant to be reachable without one, add it to PUBLIC_ROUTES ' +
    'in scripts/check-route-auth-policy.mjs with a one-line reason — that review IS the point ' +
    'of this check, not something to route around.'
  );
  process.exit(1);
}

console.log(`OK — ${total} route(s) scanned, all either guarded or explicitly allowlisted as public (${PUBLIC_ROUTES.size} public).`);
