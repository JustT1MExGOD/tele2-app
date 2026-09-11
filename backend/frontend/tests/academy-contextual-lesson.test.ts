/**
 * T2 Academy §8 — contextual lessons wired into real pages via
 * shared/contextual-lesson.ts (deliberately outside features/tutorial/ so
 * importing it never pulls the lazy Academy bundle into a page's eager
 * bundle — only tapping "Показать" triggers window.startAcademy()).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maybeShowContextualLesson, removeContextualPrompt } from '../src/shared/contextual-lesson.js';

function setupGlobals() {
  document.body.innerHTML = '';
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
}

afterEach(() => {
  removeContextualPrompt();
  vi.unstubAllGlobals();
});

describe('maybeShowContextualLesson', () => {
  beforeEach(setupGlobals);

  it('shows the prompt when the server reports not dismissed', async () => {
    const getAcademyContextualStatus = vi.fn().mockResolvedValue({ dismissed: false });
    (window as any).apiClient = { getAcademyContextualStatus };
    await maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' });
    expect(getAcademyContextualStatus).toHaveBeenCalledWith({}, 'bfq');
    expect(document.getElementById('academyContextualPrompt')).toBeTruthy();
    expect(document.body.textContent).toContain('BFQ');
  });

  it('does not show the prompt when the server reports dismissed', async () => {
    (window as any).apiClient = { getAcademyContextualStatus: vi.fn().mockResolvedValue({ dismissed: true }) };
    await maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' });
    expect(document.getElementById('academyContextualPrompt')).toBeFalsy();
  });

  it('fails safe (no prompt, no throw) when the status fetch rejects', async () => {
    (window as any).apiClient = { getAcademyContextualStatus: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' })).resolves.toBeUndefined();
    expect(document.getElementById('academyContextualPrompt')).toBeFalsy();
  });

  it('"Показать" removes the prompt and starts the Academy for the given role', async () => {
    (window as any).apiClient = { getAcademyContextualStatus: vi.fn().mockResolvedValue({ dismissed: false }) };
    const startAcademy = vi.fn().mockResolvedValue(undefined);
    (window as any).startAcademy = startAcademy;
    await maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' });
    (document.querySelector('[data-action="show"]') as HTMLButtonElement).click();
    expect(document.getElementById('academyContextualPrompt')).toBeFalsy();
    expect(startAcademy).toHaveBeenCalledWith('employee');
  });

  it('"Не сейчас" just removes the prompt, without calling dismiss', async () => {
    const dismissAcademyContextual = vi.fn().mockResolvedValue(undefined);
    (window as any).apiClient = {
      getAcademyContextualStatus: vi.fn().mockResolvedValue({ dismissed: false }),
      dismissAcademyContextual
    };
    await maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' });
    (document.querySelector('[data-action="later"]') as HTMLButtonElement).click();
    expect(document.getElementById('academyContextualPrompt')).toBeFalsy();
    expect(dismissAcademyContextual).not.toHaveBeenCalled();
  });

  it('"Больше не показывать" removes the prompt and persists the dismissal server-side', async () => {
    const dismissAcademyContextual = vi.fn().mockResolvedValue(undefined);
    (window as any).apiClient = {
      getAcademyContextualStatus: vi.fn().mockResolvedValue({ dismissed: false }),
      dismissAcademyContextual
    };
    await maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' });
    (document.querySelector('[data-action="never"]') as HTMLButtonElement).click();
    expect(document.getElementById('academyContextualPrompt')).toBeFalsy();
    expect(dismissAcademyContextual).toHaveBeenCalledWith({ 'Content-Type': 'application/json' }, 'bfq');
  });

  it('escapes the title so a hostile title cannot break out of the markup', async () => {
    (window as any).apiClient = { getAcademyContextualStatus: vi.fn().mockResolvedValue({ dismissed: false }) };
    await maybeShowContextualLesson({ contextId: 'x', title: '<img src=x onerror=alert(1)>', role: 'employee' });
    expect(document.querySelector('#academyContextualPrompt img')).toBeFalsy();
  });

  it('re-showing replaces any existing prompt instead of stacking duplicates', async () => {
    (window as any).apiClient = { getAcademyContextualStatus: vi.fn().mockResolvedValue({ dismissed: false }) };
    await maybeShowContextualLesson({ contextId: 'bfq', title: 'BFQ', role: 'employee' });
    await maybeShowContextualLesson({ contextId: 'cash', title: 'Касса', role: 'employee' });
    expect(document.querySelectorAll('#academyContextualPrompt').length).toBe(1);
    expect(document.body.textContent).toContain('Касса');
  });
});
