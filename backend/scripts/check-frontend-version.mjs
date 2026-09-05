#!/usr/bin/env node
/**
 * Hotfix 20.57.1 PASS 3, finding #4 — frontend/src/app/core.ts hardcoded
 * `APP_VERSION = '15.0'`, stale since v15.x while backend/package.json
 * moved on through 20.x. No build-time injection exists for the 24
 * separate Vite bundle configs (frontend/vite.*.config.ts), and adding one
 * would be a build-system refactor out of scope for a hotfix — instead
 * this is a cheap ratchet: fails CI/pre-push the moment the two drift
 * again, same discipline as check-no-direct-sql.mjs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const backendVersion = String(pkg.version);

const corePath = path.join(ROOT, 'frontend/src/app/core.ts');
const core = fs.readFileSync(corePath, 'utf8');
const match = core.match(/const APP_VERSION = '([^']+)';/);

if (!match) {
  console.error(`check-frontend-version: could not find APP_VERSION constant in ${corePath}`);
  process.exit(1);
}

const frontendVersion = match[1];
if (frontendVersion !== backendVersion) {
  console.error(
    `check-frontend-version: frontend/src/app/core.ts APP_VERSION ('${frontendVersion}') ` +
    `does not match package.json version ('${backendVersion}'). Update APP_VERSION.`
  );
  process.exit(1);
}

const indexPath = path.join(ROOT, 'frontend/index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const indexMatch = indexHtml.match(/T2 Sales v([0-9][0-9.]*[0-9])/);
if (!indexMatch) {
  console.error(`check-frontend-version: could not find "T2 Sales v<version>" text in ${indexPath}`);
  process.exit(1);
}
if (indexMatch[1] !== backendVersion) {
  console.error(
    `check-frontend-version: frontend/index.html version text ('${indexMatch[1]}') ` +
    `does not match package.json version ('${backendVersion}'). Update it.`
  );
  process.exit(1);
}

console.log(`check-frontend-version: OK (${backendVersion})`);
