/* 09-cash-metrics.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== CASH =====
    function deltaTone(d) {
      if (d < -100) return 'background:#ff3b3033;color:#ff453a;font-weight:800';
      if (d > 100) return 'background:#34c75933;color:#34c759;font-weight:800';
      return 'background:#ffd96644;color:#c9a000;font-weight:700';
    }

    async function loadCash() {
      const box = document.getElementById('cashTable');
      const edit = document.getElementById('cashEditSection');
      if (edit) edit.style.display = 'block';
      if (box) box.innerHTML = '<div class="skeleton"></div>';
      try {
        if (!stores.length) {
          stores = await fetchOrgStores();
        }
        const sel = document.getElementById('cashStore');
        if (sel) sel.innerHTML = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        const dateInp = document.getElementById('cashDate');
        if (dateInp && !dateInp.value) dateInp.value = todayMoscow();

        const from = todayMoscow().slice(0, 8) + '01';
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const res = await fetch(API + '/cash/table?from=' + from + '&to=' + todayMoscow() + orgParam, { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const stList = data.stores || stores;
        const dates = data.dates || [];
        const cells = data.cells || {};

        if (!dates.length) {
          box.innerHTML = '<div class="empty">🍉 Пока нет ни одной записи кассы — внеси первую строку ниже</div>';
          return;
        }

        box.innerHTML = dates.map(d => {
          const rows = stList.map(s => {
            const c = (cells[d] && cells[d][s.id]) || {};
            const fact = c.cash_fact;
            const c1 = c.cash_1c;
            const delta = c.delta != null ? Number(c.delta)
              : (fact != null && c1 != null ? Number(fact) - (Number(c1) + 2000) : null);
            const dClass = delta == null ? '' : (delta >= 0 ? 'delta-pos' : 'delta-neg');
            const click = `onclick="fillCashForm('${s.id}','${d}',${Number(fact)||0},${Number(c1)||0})"`;
            return `<div class="cash-row" ${click} style="${click ? 'cursor:pointer' : ''}">
              <div class="sn">${s.name || s.id}</div>
              <div>${fact != null && fact !== '' ? Number(fact).toLocaleString('ru-RU') : '—'}</div>
              <div>${c1 != null && c1 !== '' ? Number(c1).toLocaleString('ru-RU') : '—'}</div>
              <div class="${dClass}">${delta == null || delta === '' ? '—' : ((delta > 0 ? '+' : '') + Number(delta).toLocaleString('ru-RU'))}</div>
            </div>`;
          }).join('');
          const label = String(d).slice(8,10) + '.' + String(d).slice(5,7) + '.' + String(d).slice(2,4);
          return `<div class="cash-day">
            <div class="cash-day-h"><span>${label}</span></div>
            <div class="cash-cols"><div>Точка</div><div>Факт</div><div>1С</div><div>Δ (−2000)</div></div>
            ${rows}</div>`;
        }).join('');
      } catch (e) {
        console.error(e);
        if (box) box.innerHTML = '<div class="empty">🍉 Касса сейчас недоступна, зайди чуть позже</div>';
      }
    }


    function fillCashForm(storeId, date, fact, c1) {
      document.getElementById('cashStore').value = storeId;
      document.getElementById('cashDate').value = date;
      document.getElementById('cashFact').value = fact;
      document.getElementById('cash1c').value = c1;
      document.getElementById('cashEditSection')?.scrollIntoView({ behavior: 'smooth' });
    }

    async function saveCash() {
      // кассу вносят все сотрудники на точке (не только manager)
      if (!me?.employee_id && !me?.id) { toast('Нужна авторизация', 'err'); return; }
      const body = {
        store_id: document.getElementById('cashStore').value,
        cash_date: document.getElementById('cashDate').value || todayMoscow(),
        cash_fact: Number(document.getElementById('cashFact').value) || 0,
        cash_1c: Number(document.getElementById('cash1c').value) || 0,
        comment: document.getElementById('cashComment').value || ''
      };
      if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
      const res = await fetch(API + '/cash', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Касса сохранена', 'ok');
      loadCash();
    }

    // ===== COMBO CALC =====
    

    

    // ===== CUSTOM METRICS =====
    // Базовые метрики защищены от удаления и на бэкенде (DELETE /metrics/:id);
    // список здесь только чтобы не показывать бесполезную кнопку «Удалить».
    const LOCKED_METRICS = new Set([
      'sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'settings',
      'insurance', 'wink', 'shpd', 'focus', 'credit_request', 'credit_issued',
      'plotter', 'hb', 'credit'
    ]);

    async function openAddMetric() {
      if (!canManage()) return;
      await loadMetricsCatalog();
      document.getElementById('modalTitle').textContent = 'Метрики плана';
      const custom = (METRICS || []).filter(m => !LOCKED_METRICS.has(m.id));
      const listHtml = custom.length
        ? `<div class="block-label">Свои метрики</div>
           <div class="progress-block" style="display:flex;flex-direction:column;gap:8px">
             ${custom.map(m => `
               <div style="display:flex;justify-content:space-between;align-items:center">
                 <span style="font-size:14px">${esc(m.label)} <span style="color:var(--hint)">(${esc(m.id)})</span></span>
                 <button class="mchip" style="color:var(--danger)" onclick="deleteMetric('${m.id}',${JSON.stringify(m.label)})">Удалить</button>
               </div>`).join('')}
           </div>`
        : '';
      document.getElementById('modalBody').innerHTML = `
        ${listHtml}
        <div class="block-label">Новая метрика</div>
        <div class="field"><label>Название</label><input id="nm_label" placeholder="Например: eSIM"></div>
        <div class="field"><label>Короткое</label><input id="nm_short" placeholder="eSIM"></div>
        <div class="field"><label>Тип</label>
          <select id="nm_unit">
            <option value="count">Количество</option>
            <option value="money">Деньги</option>
          </select>
        </div>
        <button class="btn-main" onclick="saveMetric()">Создать</button>
      `;
      document.getElementById('overlay').classList.add('show');
    }

    async function deleteMetric(id, label) {
      if (!canManage()) return;
      if (!confirm(`Удалить метрику «${label}»? Она перестанет показываться в формах — уже внесённые по ней данные останутся в базе.`)) return;
      const res = await fetch(API + '/metrics/' + id, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!res.ok) {
        let msg = 'Ошибка';
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch (_) {}
        toast(msg, 'err');
        return;
      }
      toast('Метрика удалена', 'ok');
      await openAddMetric();
    }

    async function saveMetric() {
      const label = document.getElementById('nm_label').value.trim();
      if (!label) { toast('Укажи название', 'err'); return; }
      const res = await fetch(API + '/metrics', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          label,
          short_label: document.getElementById('nm_short').value.trim() || label.slice(0, 8),
          unit: document.getElementById('nm_unit').value
        })
      });
      if (!res.ok) {
        let msg = 'Ошибка';
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch (_) {}
        toast(msg, 'err');
        return;
      }
      const data = await res.json().catch(() => ({}));
      toast('Метрика «' + (data.item?.label || label) + '» добавлена', 'ok');
      closeModal();
      await loadMetricsCatalog();
    }

