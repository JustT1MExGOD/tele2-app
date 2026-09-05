/**
 * 20.58 Phase 2 (§5/§10H) — the shared #overlay/.sheet-modal is used
 * across ~30 call sites (team/schedule/network-admin/plans/shift/etc.)
 * that all toggle the SAME element's 'show' class directly, not through
 * openModal()/closeModal(). initModalA11y() (features/add-sale/index.ts)
 * wires Escape-to-close + focus management via a MutationObserver on that
 * shared node instead of touching every call site — this proves it works
 * end-to-end for both the module's own openModal() AND a raw
 * classList.add('show') from an unrelated caller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// MutationObserver callbacks fire as a microtask, not synchronously — every
// assertion that depends on the observer having reacted to a class change
// must flush one first.
function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function setupDom() {
  document.body.innerHTML = `
    <button id="opener">Open</button>
    <div id="overlay">
      <div class="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1">
        <button type="button" id="modalCloseBtn" aria-label="Закрыть">×</button>
        <div class="modal-title" id="modalTitle"></div>
        <div id="modalBody"><input id="firstField" /></div>
      </div>
    </div>
  `;
}

async function freshImport() {
  vi.resetModules();
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: 'employee', full_name: 'Иван' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => false);
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });
  return import('../src/features/add-sale/index.js');
}

describe('index.html — .sheet-modal имеет корректную dialog-семантику (20.58 Phase 2 §5/§10)', () => {
  it('.sheet-modal объявлен как role="dialog" aria-modal="true" с aria-labelledby на #modalTitle', () => {
    const idx = indexHtml.indexOf('class="sheet-modal"');
    expect(idx).toBeGreaterThanOrEqual(0);
    const tagEnd = indexHtml.indexOf('>', idx);
    const openingTag = indexHtml.slice(idx - 40, tagEnd + 1);
    expect(openingTag).toContain('role="dialog"');
    expect(openingTag).toContain('aria-modal="true"');
    expect(openingTag).toContain('aria-labelledby="modalTitle"');
  });

  it('модалка содержит видимую и доступную кнопку закрытия (aria-label, не только backdrop-tap/свайп)', () => {
    expect(indexHtml).toContain('id="modalCloseBtn"');
    const idx = indexHtml.indexOf('id="modalCloseBtn"');
    const tagStart = indexHtml.lastIndexOf('<button', idx);
    const tagEnd = indexHtml.indexOf('>', idx);
    const tag = indexHtml.slice(tagStart, tagEnd + 1);
    expect(tag).toContain('aria-label=');
  });
});

describe('Модалка #overlay/.sheet-modal — Escape-to-close и focus management (20.58 Phase 2 §5)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('Escape закрывает модалку, когда она открыта через openModal()', async () => {
    setupDom();
    const { openModal } = await freshImport();
    openModal();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(false);
  });

  it('Escape закрывает модалку, даже если её открыли напрямую через classList.add(\'show\') (не openModal())', async () => {
    setupDom();
    await freshImport();
    document.getElementById('overlay')!.classList.add('show');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(false);
  });

  it('Escape не закрывает модалку, если она уже закрыта (no-op)', async () => {
    setupDom();
    await freshImport();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(false);
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(false);
  });

  it('при открытии фокус уходит на первое поле формы внутри #modalBody', async () => {
    setupDom();
    (document.getElementById('opener') as HTMLElement).focus();
    const { openModal } = await freshImport();
    openModal();
    await flushMicrotasks();
    expect(document.activeElement).toBe(document.getElementById('firstField'));
  });

  it('при закрытии фокус возвращается на элемент, с которого была открыта модалка', async () => {
    setupDom();
    const opener = document.getElementById('opener') as HTMLElement;
    opener.focus();
    const { openModal, closeModal } = await freshImport();
    openModal();
    await flushMicrotasks();
    expect(document.activeElement).not.toBe(opener);
    closeModal();
    await flushMicrotasks();
    expect(document.activeElement).toBe(opener);
  });

  it('repeated re-imports do not accumulate duplicate keydown listeners (idempotency guard, §0A pattern)', async () => {
    setupDom();
    const addSpy = vi.spyOn(document, 'addEventListener');
    await freshImport();
    setupDom();
    await freshImport();
    setupDom();
    await freshImport();
    const keydownAdds = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(keydownAdds).toBe(3); // 3 imports install, but each disposes the previous first
    addSpy.mockRestore();
  });
});
