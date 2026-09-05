/**
 * 20.58 Phase 2 (§5) — на ≥860px рядом с .app-header уже есть .sidebar
 * (Desktop Shell, 20.39), поэтому мобильный вертикальный воздух (padding-
 * bottom:32px под .sheet's margin-top:-18px, лишний margin-bottom у
 * .app-header-top) на десктопе не нужен — только padding сжимается,
 * контент/структура не меняются. Статические проверки исходника
 * styles.css, тот же приём, что в chat-layout-height.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function ruleInDesktopShellBlock(selector: string): string {
  const shellIdx = stylesCss.indexOf('@media (min-width: 860px)');
  expect(shellIdx, 'Desktop Shell media block not found').toBeGreaterThanOrEqual(0);
  const idx = stylesCss.indexOf(selector, shellIdx);
  expect(idx, `selector "${selector}" not found inside the ≥860px media block`).toBeGreaterThanOrEqual(0);
  const end = stylesCss.indexOf('}', idx);
  return stylesCss.slice(idx, end + 1);
}

describe('Desktop Shell (≥860px) — уменьшенный footprint .app-header (20.58 Phase 2 §5)', () => {
  it('.app-header на ≥860px получает меньший вертикальный padding, чем базовое мобильное правило', () => {
    const css = ruleInDesktopShellBlock('.app-header {');
    expect(css).toMatch(/padding-top:\s*calc\(var\(--sp-2\)\s*\+\s*var\(--app-safe-top\)\)/);
    expect(css).toMatch(/padding-bottom:\s*var\(--sp-4\)/);
  });

  it('.app-header-top на ≥860px получает меньший margin-bottom (--sp-3 вместо --sp-4)', () => {
    const css = ruleInDesktopShellBlock('.app-header-top {');
    expect(css).toMatch(/margin-bottom:\s*var\(--sp-3\)/);
  });

  it('.header-pills .store-pill на ≥860px получает более компактный вертикальный padding', () => {
    const css = ruleInDesktopShellBlock('.header-pills .store-pill {');
    expect(css).toMatch(/padding:\s*var\(--sp-2\)\s*var\(--sp-4\)/);
  });

  it('базовое мобильное правило .app-header не изменилось (мобильная раскладка не тронута ни на пиксель)', () => {
    const idx = stylesCss.indexOf('.app-header {');
    expect(idx).toBeGreaterThanOrEqual(0);
    const end = stylesCss.indexOf('}', idx);
    const css = stylesCss.slice(idx, end + 1);
    expect(css).toMatch(/padding:\s*calc\(var\(--sp-3\)\s*\+\s*var\(--app-safe-top\)\)\s*var\(--sp-4\)\s*var\(--sp-8\)/);
  });
});
