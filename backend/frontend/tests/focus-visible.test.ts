/**
 * 20.58 (visual-correction pass, §4) — единая система :focus-visible.
 * Только 3 селектора файл-вайд блокируют outline безусловным
 * `outline: none` (не только на :focus) — им нужны собственные
 * :focus-visible-переопределения выше по специфичности, иначе
 * универсальное низкоспецифичное правило `:focus-visible{...}` их не
 * достанет. Список — результат grep по всему styles.css; если появится
 * новый `outline: none` без пары `:focus-visible`, этот тест должен
 * поймать регресс.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

describe('Единая система :focus-visible (20.58)', () => {
  it('есть универсальное низкоспецифичное правило :focus-visible', () => {
    expect(stylesCss).toMatch(/(?<!-)\n\s*:focus-visible\s*\{\s*\n\s*outline:\s*2px solid var\(--primary\)/);
  });

  it('.field select/input: собственный outline:none имеет :focus-visible-переопределение', () => {
    const idx = stylesCss.indexOf('.field select, .field input {');
    expect(idx).toBeGreaterThanOrEqual(0);
    const after = stylesCss.slice(idx, idx + 600);
    expect(after).toContain('outline: none');
    expect(after).toContain('.field select:focus-visible, .field input:focus-visible');
  });

  it('.gate-card input/select: собственный outline:none имеет :focus-visible-переопределение', () => {
    const idx = stylesCss.indexOf('.gate-card input, .gate-card select {');
    expect(idx).toBeGreaterThanOrEqual(0);
    const after = stylesCss.slice(idx, idx + 400);
    expect(after).toContain('outline: none');
    expect(after).toContain('.gate-card input:focus-visible, .gate-card select:focus-visible');
  });

  it('.chat-composer-input:focus: собственный outline:none имеет :focus-visible-переопределение', () => {
    const idx = stylesCss.indexOf('.chat-composer-input:focus {');
    expect(idx).toBeGreaterThanOrEqual(0);
    const after = stylesCss.slice(idx, idx + 300);
    expect(after).toContain('outline: none');
    expect(after).toContain('.chat-composer-input:focus-visible');
  });
});
