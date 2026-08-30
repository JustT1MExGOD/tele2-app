/**
 * 21.x (Frontend rewrite continuation) — jsdom render test for the second
 * migrated legacy page (frontend/js/12-promos.js → src/features/promos),
 * same approach as reports-page.test.ts: real DOM render + real simulated
 * interactions, no browser tool available in this environment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { esc } from '../src/app/core.js';

function setupGlobals(overrides: { role?: string; adminViewOrgId?: string | null; withOpenModal?: boolean } = {}) {
  document.body.innerHTML = `
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  // 20.49.0 — openPromoCard() теперь зовёт esc() на code/note/created_by_name
  // (XSS-фикс); реальная реализация, не no-op.
  vi.stubGlobal('esc', esc);
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee', org_id: 'default', full_name: 'Test' });
  vi.stubGlobal('adminViewOrgId', overrides.adminViewOrgId ?? null);
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
  vi.stubGlobal('orgQueryParam', () =>
    overrides.role === 'admin' && overrides.adminViewOrgId ? '&org_id=' + encodeURIComponent(overrides.adminViewOrgId) : ''
  );
  vi.stubGlobal('toast', vi.fn());
  if (overrides.withOpenModal !== false) {
    vi.stubGlobal('openModal', vi.fn());
  }

  const getPromos = vi.fn().mockResolvedValue({ items: [] });
  const getPromoCard = vi.fn();
  const createPromo = vi.fn();
  const markPromoUsed = vi.fn();
  const keepPromo = vi.fn();
  (window as any).apiClient = { getPromos, getPromoCard, createPromo, markPromoUsed, keepPromo };
  return { getPromos, getPromoCard, createPromo, markPromoUsed, keepPromo };
}

describe('промокоды РТК (миграция frontend/js/12-promos.js → src/features/promos)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('openPromos: заголовок/skeleton сразу, дальше грузит список; вызывает openModal(), если он есть', async () => {
    setupGlobals({ withOpenModal: true });
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();

    expect(document.getElementById('modalTitle')!.textContent).toBe('Промокоды РТК');
    expect((globalThis as any).openModal).toHaveBeenCalled();
    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(false);
  });

  it('openPromos: без openModal() (typeof-гейт) — фолбэк на overlay.classList.add("show")', async () => {
    setupGlobals({ withOpenModal: false });
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();

    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
  });

  it('loadPromos: пустой список — "Пока пусто"', async () => {
    const { getPromos } = setupGlobals();
    getPromos.mockResolvedValue({ items: [] });
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();

    expect(document.getElementById('promoList')!.textContent).toContain('Пока пусто');
  });

  it('loadPromos: рендерит маску/автора/дату по каждому промокоду', async () => {
    const { getPromos } = setupGlobals();
    getPromos.mockResolvedValue({
      items: [{ id: 7, mask: 'XX••1234', created_by_name: 'Иван', created_at: '2026-08-20T10:00:00Z' }]
    });
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();

    const list = document.getElementById('promoList')!;
    expect(list.innerHTML).toContain('XX••1234');
    expect(list.innerHTML).toContain('Иван');
    expect(list.innerHTML).toContain('2026-08-20');
    expect(list.innerHTML).toContain('openPromoCard(7)');
  });

  // Documentation-audit XSS fix — created_by_name в списке (.promo-meta)
  // не проходил esc(), хотя то же поле в карточке (openPromoCard) уже
  // экранировалось с 20.49.0 — пропуск в одном из двух мест рендера.
  it('loadPromos: created_by_name с HTML в списке не исполняется как разметка', async () => {
    const { getPromos } = setupGlobals();
    const payload = '<img src=x onerror="window.__pwned=1">';
    getPromos.mockResolvedValue({
      items: [{ id: 7, mask: 'XX••1234', created_by_name: payload, created_at: '2026-08-20T10:00:00Z' }]
    });
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();

    // jsdom реально парсит HTML — если бы created_by_name не экранировался,
    // здесь появился бы настоящий <img onerror> элемент.
    expect(document.querySelectorAll('img[onerror]').length).toBe(0);
    expect((window as any).__pwned).toBeUndefined();
    // Значение всё ещё видно на экране (в HTML-экранированном виде), не
    // молча отброшено.
    const list = document.getElementById('promoList')!;
    expect(list.textContent).toContain(payload);
  });

  // §P1-E (20.54.0) — same class of gap as created_by_name above, found
  // in the same audit pass: `mask` (server-computed from the admin-
  // entered promo code, first+last 2 chars survive masking) was rendered
  // raw in the list view while other fields nearby were already esc()'d.
  it('loadPromos: mask с HTML-подобным содержимым не исполняется как разметка', async () => {
    const { getPromos } = setupGlobals();
    getPromos.mockResolvedValue({
      items: [{ id: 7, mask: '<s•••••••pt', created_by_name: 'Иван', created_at: '2026-08-20T10:00:00Z' }]
    });
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();
    const list = document.getElementById('promoList')!;
    expect(list.querySelectorAll('s').length).toBe(0);
    expect(list.innerHTML).toContain('&lt;s');
  });

  it('loadPromos: ошибка API — не падает, показывает сообщение', async () => {
    const { getPromos } = setupGlobals();
    getPromos.mockRejectedValue(new Error('network'));
    const { openPromos } = await import('../src/features/promos/index.js');
    await openPromos();

    expect(document.getElementById('promoList')!.textContent).toContain('недоступны');
  });

  it('submitPromo: пустой код — toast err, createPromo НЕ вызывается', async () => {
    const { createPromo } = setupGlobals();
    const { submitPromo, openAddPromo } = await import('../src/features/promos/index.js');
    openAddPromo();
    (document.getElementById('promoCode') as HTMLInputElement).value = '   ';

    await submitPromo();

    expect(createPromo).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Введи код', 'err');
  });

  it('submitPromo: успех — создаёт промокод, тостит, возвращается к списку', async () => {
    const { createPromo, getPromos } = setupGlobals();
    createPromo.mockResolvedValue({ ok: true, item: { id: 1, code: 'AB-CD', note: null, created_at: '2026-08-25' } });
    const { submitPromo, openAddPromo } = await import('../src/features/promos/index.js');
    openAddPromo();
    (document.getElementById('promoCode') as HTMLInputElement).value = 'AB-CD';
    (document.getElementById('promoNote') as HTMLInputElement).value = 'заметка';

    await submitPromo();

    expect(createPromo).toHaveBeenCalledWith(expect.anything(), { code: 'AB-CD', note: 'заметка' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Добавлено', 'ok');
    expect(getPromos).toHaveBeenCalled(); // openPromos() -> loadPromos() после успеха
    expect(document.getElementById('modalTitle')!.textContent).toBe('Промокоды РТК');
  });

  it('submitPromo: admin с активным переключателем сети — org_id уходит в тело запроса', async () => {
    const { createPromo } = setupGlobals({ role: 'admin', adminViewOrgId: 'other_org' });
    createPromo.mockResolvedValue({ ok: true, item: { id: 1, code: 'X', note: null, created_at: '2026-08-25' } });
    const { submitPromo, openAddPromo } = await import('../src/features/promos/index.js');
    openAddPromo();
    (document.getElementById('promoCode') as HTMLInputElement).value = 'X';

    await submitPromo();

    expect(createPromo).toHaveBeenCalledWith(expect.anything(), { code: 'X', note: '', org_id: 'other_org' });
  });

  it('openPromoCard: показывает полный код и кнопки использован/не использован', async () => {
    const { getPromoCard } = setupGlobals();
    getPromoCard.mockResolvedValue({ id: 5, code: 'FULL-CODE-1234', note: 'из акции', created_by_name: 'Мария', created_at: '2026-08-01' });
    const { openPromoCard } = await import('../src/features/promos/index.js');

    await openPromoCard(5);

    const body = document.getElementById('modalBody')!;
    expect(body.innerHTML).toContain('FULL-CODE-1234');
    expect(body.innerHTML).toContain('из акции');
    expect(body.innerHTML).toContain('promoMarkUsed(5)');
    expect(body.innerHTML).toContain('promoKeep(5)');
  });

  it('promoMarkUsed: списывает промокод, тостит, возвращается к списку', async () => {
    const { markPromoUsed, getPromos } = setupGlobals();
    const { promoMarkUsed } = await import('../src/features/promos/index.js');

    await promoMarkUsed(9);

    expect(markPromoUsed).toHaveBeenCalledWith(expect.anything(), 9);
    expect((globalThis as any).toast).toHaveBeenCalledWith('Списан из пула', 'ok');
    expect(getPromos).toHaveBeenCalled();
  });

  it('promoKeep: даже если API упал — молча возвращается к списку (best-effort, как в легаси)', async () => {
    const { keepPromo, getPromos } = setupGlobals();
    keepPromo.mockRejectedValue(new Error('boom'));
    const { promoKeep } = await import('../src/features/promos/index.js');

    await promoKeep(3);

    expect(keepPromo).toHaveBeenCalledWith(expect.anything(), 3);
    expect(getPromos).toHaveBeenCalled();
  });

  it('все функции забинжены на window.* — легаси onclick="..." строки резолвятся', async () => {
    setupGlobals();
    await import('../src/features/promos/index.js');

    for (const name of ['openPromos', 'loadPromos', 'openAddPromo', 'submitPromo', 'openPromoCard', 'promoMarkUsed', 'promoKeep']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
