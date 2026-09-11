#!/usr/bin/env node
/**
 * 17-layer security hardening pass, new Layer 13 (Supply-chain Security)
 * — SBOM generation, CycloneDX format, for the backend's production
 * component. Not wired into the PR-gating CI job (an SBOM is an
 * artifact/inventory, not a pass/fail gate — nothing here should block a
 * merge) — run on demand (`npm run sbom`) or from a scheduled/release
 * workflow.
 *
 * Uses `@cyclonedx/cyclonedx-npm` via npx rather than as a committed
 * devDependency — it's a build-time tool run rarely (release/audit time),
 * not something every `npm install` needs to carry; npx fetches it
 * on-demand from the same npm registry already trusted for every other
 * dependency in this project.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'sbom.cdx.json');

console.log('Generating CycloneDX SBOM for backend/ production dependencies…');
const res = spawnSync(
  'npx --yes @cyclonedx/cyclonedx-npm --output-format JSON --output-file ' + JSON.stringify(OUT),
  { cwd: ROOT, stdio: 'inherit', shell: true }
);

if (res.status !== 0) {
  console.error('❌ SBOM generation failed.');
  process.exit(res.status || 1);
}

console.log(`✅ SBOM written to ${path.relative(process.cwd(), OUT)}`);
console.log('Not committed to the repo by default (regenerate per release) — add it to a release');
console.log('artifact/workflow if a persisted SBOM per version is wanted going forward.');
