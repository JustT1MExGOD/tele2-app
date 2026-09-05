/**
 * 20.58 Phase 2 (§7) — targeted WCAG AA (4.5:1, normal text) contrast audit
 * of --hint and small white-on-primary text, both themes. Not a full
 * automated a11y scanner — a fixed set of confirmed before/after pairs,
 * computed with the standard relative-luminance formula (WCAG 2.x).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

describe('Контраст --hint / --primary-text-bg — WCAG AA 4.5:1 для обычного текста (20.58 Phase 2 §7)', () => {
  it('light theme: --hint (#6e6e78) на --surface/--bg проходит AA (было #8e8e98, ~3.0-3.2:1)', () => {
    expect(stylesCss).toContain('--hint: #6e6e78;');
    expect(contrastRatio('#6e6e78', '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio('#6e6e78', '#f4f4f6')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('dark theme: --hint (#7e7e87) на --surface/--bg проходит AA (было #71717a, ~3.8-4.3:1)', () => {
    expect(stylesCss).toContain('--hint: #7e7e87;');
    expect(contrastRatio('#7e7e87', '#141416')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio('#7e7e87', '#000000')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('--primary-text-bg (#106fa3) с белым текстом проходит AA (var(--primary) сам по себе — только ~2.2-2.6:1)', () => {
    expect(stylesCss).toContain('--primary-text-bg: #106fa3;');
    expect(contrastRatio('#ffffff', '#106fa3')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    // Confirms the bug being fixed: var(--primary) itself would fail here.
    expect(contrastRatio('#ffffff', '#2aabee')).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio('#ffffff', '#3bb8f5')).toBeLessThan(AA_NORMAL_TEXT);
  });

  it('.mchip.on и .chat-new-messages используют --primary-text-bg, не var(--primary), для фона под белым текстом', () => {
    const mchipIdx = stylesCss.indexOf('.mchip.on {');
    expect(mchipIdx).toBeGreaterThanOrEqual(0);
    const mchipEnd = stylesCss.indexOf('}', mchipIdx);
    expect(stylesCss.slice(mchipIdx, mchipEnd + 1)).toContain('background: var(--primary-text-bg)');

    const badgeIdx = stylesCss.indexOf('.chat-new-messages {');
    expect(badgeIdx).toBeGreaterThanOrEqual(0);
    const badgeEnd = stylesCss.indexOf('}', badgeIdx);
    expect(stylesCss.slice(badgeIdx, badgeEnd + 1)).toContain('background: var(--primary-text-bg)');
  });
});
