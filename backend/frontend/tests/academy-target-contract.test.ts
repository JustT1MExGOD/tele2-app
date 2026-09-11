/**
 * T2 Academy — required tutorial target IDs must exist in the actual page
 * source (a CSS/markup refactor that keeps the attribute has nothing to
 * fear; one that DROPS it should fail this test loudly rather than
 * silently break the course at runtime).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { employeeCourse } from '../src/features/tutorial/courses/employee/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(__dirname, '..');

function readSource(relPath: string): string {
  return readFileSync(resolve(FRONTEND_ROOT, relPath), 'utf8');
}

describe('T2 Academy — target contract (data-tutorial-id)', () => {
  it('every targetId referenced by the employee course exists somewhere in the frontend source', () => {
    const targetIds = employeeCourse.chapters
      .flatMap((c) => c.steps)
      .map((s) => s.targetId)
      .filter((id): id is string => !!id);
    expect(targetIds.length).toBeGreaterThan(0);

    const haystacks = [readSource('index.html'), readSource('src/pages/home/index.ts')].join('\n');
    for (const id of targetIds) {
      expect(haystacks).toContain(`data-tutorial-id="${id}"`);
    }
  });

  it('data-tutorial-id appears at most twice in index.html per id — exactly the desktop-sidebar + mobile-bottom-nav pairing spotlight.ts is designed to resolve, never a stray third/accidental duplicate', () => {
    const html = readSource('index.html');
    const ids = [...html.matchAll(/data-tutorial-id="([^"]+)"/g)].map((m) => m[1]);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, count] of counts) {
      expect(count, `data-tutorial-id="${id}" appears ${count} times, expected 1 or 2`).toBeLessThanOrEqual(2);
    }
  });
});
