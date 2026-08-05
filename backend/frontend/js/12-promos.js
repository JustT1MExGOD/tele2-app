/* 12-promos.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== PROMOCODES RTK =====
    async function openPromos() {
      document.getElementById('modalTitle').textContent = 'Промокоды РТК';
      document.getElementById('modalBody').innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 12px;line-height:1.4">
          Общий пул твоей сети. Коды скрыты — открой карточку, чтобы увидеть. Если использовал — отметь, код исчезнет у всех.
        </div>
        <button class="btn-main" onclick="openAddPromo()">+ Добавить промокод</button>
        <div id="promoList" style="margin-top:14px"><div class="skeleton"></div></div>
      `;
      if (typeof openModal === 'function') openModal();
      else document.getElementById('overlay')?.classList.add('show');
      loadPromos();
    }

    async function loadPromos() {
      const box = document.getElementById('promoList');
      if (!box) return;
      try {
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const res = await fetch(API + '/promos' + orgParam, { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const items = data.items || [];
        if (!items.length) {
          box.innerHTML = '<div class="empty">Пока пусто — добавь первый код</div>';
          return;
        }
        box.innerHTML = items.map(it => `
          <div class="promo-item" onclick="openPromoCard(${it.id})">
            <div>
              <div class="promo-mask">${it.mask || '••••'}</div>
              <div class="promo-meta">${it.created_by_name || ''} · ${String(it.created_at || '').slice(0,10)}</div>
            </div>
            <div style="color:var(--hint)">›</div>
          </div>
        `).join('');
      } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="empty">🍉 Промокоды сейчас недоступны, зайди чуть позже</div>';
      }
    }

    function openAddPromo() {
      document.getElementById('modalTitle').textContent = 'Новый промокод РТК';
      document.getElementById('modalBody').innerHTML = `
        <div class="field"><label>Промокод</label>
          <input id="promoCode" placeholder="XXXX-XXXX" autocomplete="off"></div>
        <div class="field"><label>Заметка (необязательно)</label>
          <input id="promoNote" placeholder="откуда / для чего"></div>
        <button class="btn-main" onclick="submitPromo()">Сохранить</button>
        <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)" onclick="openPromos()">Назад к списку</button>
      `;
      setTimeout(() => document.getElementById('promoCode')?.focus(), 200);
    }

    async function submitPromo() {
      const code = document.getElementById('promoCode')?.value?.trim();
      const note = document.getElementById('promoNote')?.value?.trim() || '';
      if (!code) { toast('Введи код', 'err'); return; }
      try {
        const body = { code, note };
        if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
        const res = await fetch(API + '/promos', {
          method: 'POST', headers: authHeaders(true),
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'fail');
        toast('Добавлено', 'ok');
        openPromos();
      } catch (e) {
        toast(e.message || 'Ошибка', 'err');
      }
    }

    async function openPromoCard(id) {
      try {
        const res = await fetch(API + '/promos/' + id, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'not found');
        document.getElementById('modalTitle').textContent = 'Промокод РТК';
        document.getElementById('modalBody').innerHTML = `
          <div class="empty" style="text-align:left;padding:0">Полный код (можно выделить):</div>
          <div class="promo-code-big" id="promoFullCode">${data.code || ''}</div>
          ${data.note ? `<div class="empty" style="text-align:left">${data.note}</div>` : ''}
          <div class="promo-meta" style="text-align:center;margin-bottom:12px">${data.created_by_name || ''}</div>
          <button class="btn-main" onclick="promoMarkUsed(${id})">Промокод использован</button>
          <button class="btn-main" style="margin-top:8px;background:var(--surface-2);color:var(--text)" onclick="promoKeep(${id})">Не использован</button>
        `;
      } catch (e) {
        toast(e.message || 'Ошибка', 'err');
      }
    }

    async function promoMarkUsed(id) {
      try {
        const res = await fetch(API + '/promos/' + id + '/use', {
          method: 'POST', headers: authHeaders(true), body: '{}'
        });
        if (!res.ok) throw new Error('fail');
        toast('Списан из пула', 'ok');
        openPromos();
      } catch {
        toast('Ошибка', 'err');
      }
    }

    async function promoKeep(id) {
      try {
        await fetch(API + '/promos/' + id + '/keep', {
          method: 'POST', headers: authHeaders(true), body: '{}'
        });
      } catch (_) {}
      openPromos();
    }


    
