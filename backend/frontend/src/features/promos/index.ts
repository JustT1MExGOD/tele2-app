/**
 * 21.x (Frontend rewrite continuation, after 20.12.0's pilot) — second
 * migrated legacy page, replacing frontend/js/12-promos.js file-for-file.
 * Picked as the next step: zero other frontend/js/*.js files call any of
 * its functions, no page-local mutable state, not even wired into the
 * switchPage()/loadPage() nav dispatch — a self-contained modal triggered
 * from two static onclick="openPromos()" buttons in index.html.
 *
 * Not a router.ts "page" — app/router.ts is specifically for the
 * page-<name> DOM / switchPage() nav system, and this modal never goes
 * through it (same #modalTitle/#modalBody/#overlay shell that
 * 07-add-sale.js's openModal()/closeModal() manage). Shaped like
 * features/send-network-digest instead, just bigger: every function here
 * is bridged onto window.* because the legacy modal HTML calls back into
 * them via onclick="..." attribute strings baked into innerHTML — the
 * same reason reports.js kept window.loadReportsPage as a bridge.
 */
import type {
  PromosListResponse,
  PromoCard,
  CreatePromoRequest
} from '../../../../src/shared/api-types.js';

export async function openPromos(): Promise<void> {
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  if (title) title.textContent = 'Промокоды РТК';
  if (body) {
    body.innerHTML = `
      <div class="empty" style="text-align:left;padding:0 0 12px;line-height:1.4">
        Общий пул твоей сети. Коды скрыты — открой карточку, чтобы увидеть. Если использовал — отметь, код исчезнет у всех.
      </div>
      <button class="btn-main" onclick="openAddPromo()">+ Добавить промокод</button>
      <div id="promoList" style="margin-top:14px"><div class="skeleton"></div></div>
    `;
  }
  if (typeof openModal === 'function') openModal();
  else document.getElementById('overlay')?.classList.add('show');
  loadPromos();
}

export async function loadPromos(): Promise<void> {
  const box = document.getElementById('promoList');
  if (!box) return;
  try {
    const data: PromosListResponse = await window.apiClient.getPromos(authHeaders(), orgQueryParam());
    const items = data.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty">Пока пусто — добавь первый код</div>';
      return;
    }
    box.innerHTML = items
      .map(
        (it) => `
          <div class="promo-item" onclick="openPromoCard(${it.id})">
            <div>
              <div class="promo-mask">${it.mask || '••••'}</div>
              <div class="promo-meta">${it.created_by_name || ''} · ${String(it.created_at || '').slice(0, 10)}</div>
            </div>
            <div style="color:var(--hint)">›</div>
          </div>
        `
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">🍉 Промокоды сейчас недоступны, зайди чуть позже</div>';
  }
}

export function openAddPromo(): void {
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  if (title) title.textContent = 'Новый промокод РТК';
  if (body) {
    body.innerHTML = `
      <div class="field"><label>Промокод</label>
        <input id="promoCode" placeholder="XXXX-XXXX" autocomplete="off"></div>
      <div class="field"><label>Заметка (необязательно)</label>
        <input id="promoNote" placeholder="откуда / для чего"></div>
      <button class="btn-main" onclick="submitPromo()">Сохранить</button>
      <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)" onclick="openPromos()">Назад к списку</button>
    `;
  }
  setTimeout(() => (document.getElementById('promoCode') as HTMLInputElement | null)?.focus(), 200);
}

export async function submitPromo(): Promise<void> {
  const code = (document.getElementById('promoCode') as HTMLInputElement | null)?.value?.trim();
  const note = (document.getElementById('promoNote') as HTMLInputElement | null)?.value?.trim() || '';
  if (!code) {
    toast('Введи код', 'err');
    return;
  }
  try {
    const body: CreatePromoRequest = { code, note };
    if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
    await window.apiClient.createPromo(authHeaders(true), body);
    toast('Добавлено', 'ok');
    openPromos();
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
  }
}

export async function openPromoCard(id: number): Promise<void> {
  try {
    const data: PromoCard = await window.apiClient.getPromoCard(authHeaders(), id);
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    if (title) title.textContent = 'Промокод РТК';
    if (body) {
      body.innerHTML = `
        <div class="empty" style="text-align:left;padding:0">Полный код (можно выделить):</div>
        <div class="promo-code-big" id="promoFullCode">${data.code || ''}</div>
        ${data.note ? `<div class="empty" style="text-align:left">${data.note}</div>` : ''}
        <div class="promo-meta" style="text-align:center;margin-bottom:12px">${data.created_by_name || ''}</div>
        <button class="btn-main" onclick="promoMarkUsed(${id})">Промокод использован</button>
        <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)" onclick="promoKeep(${id})">Не использован</button>
      `;
    }
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
  }
}

export async function promoMarkUsed(id: number): Promise<void> {
  try {
    await window.apiClient.markPromoUsed(authHeaders(true), id);
    toast('Списан из пула', 'ok');
    openPromos();
  } catch {
    toast('Ошибка', 'err');
  }
}

export async function promoKeep(id: number): Promise<void> {
  try {
    await window.apiClient.keepPromo(authHeaders(true), id);
  } catch {
    // тот же приём, что в легаси — молча игнорируем: keep не меняет
    // ничего критичного, отдельный тост на неудаче не добавляет ценности
  }
  openPromos();
}

declare global {
  interface Window {
    openPromos: typeof openPromos;
    loadPromos: typeof loadPromos;
    openAddPromo: typeof openAddPromo;
    submitPromo: typeof submitPromo;
    openPromoCard: typeof openPromoCard;
    promoMarkUsed: typeof promoMarkUsed;
    promoKeep: typeof promoKeep;
  }
}
window.openPromos = openPromos;
window.loadPromos = loadPromos;
window.openAddPromo = openAddPromo;
window.submitPromo = submitPromo;
window.openPromoCard = openPromoCard;
window.promoMarkUsed = promoMarkUsed;
window.promoKeep = promoKeep;
