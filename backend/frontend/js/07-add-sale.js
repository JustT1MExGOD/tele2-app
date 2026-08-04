/* 07-add-sale.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== ADD SALE (smart) =====
    async function openAddSale(presetEmployeeId) {
      await loadMetricsCatalog();
      try {
        const [empRes, storeRes, schRes] = await Promise.all([
          fetch(API + '/employees'),
          fetch(API + '/stores'),
          fetch(API + '/schedules?date=' + todayMoscow())
        ]);
        employees = await empRes.json();
        stores = await storeRes.json();
        const schedules = await schRes.json();

        const schByEmp = {};
        (Array.isArray(schedules) ? schedules : []).forEach(s => {
          schByEmp[s.employee_id] = s.store_id;
        });

        const isMgr = canManage();
        let empList = employees || [];
        if (!isMgr && me?.employee_id) {
          empList = empList.filter(e => String(e.id) === String(me.employee_id));
          if (!empList.length) empList = [{ id: me.employee_id, full_name: me.full_name || 'Я' }];
        }
        let defaultEmp = isMgr
          ? (presetEmployeeId || me?.employee_id || (schedules[0] && schedules[0].employee_id) || empList[0]?.id)
          : (me?.employee_id || empList[0]?.id);
        let defaultStore = schByEmp[defaultEmp] || stores[0]?.id;

        saleSelection = {};
        document.getElementById('modalTitle').textContent = 'Добавить продажу';
        document.getElementById('modalBody').innerHTML = `
          <div class="field">
            <label>Сотрудник</label>
            <select id="modalEmployee" onchange="onEmpChange()" ${isMgr ? '' : 'disabled'}>
              ${empList.map(e =>
                `<option value="${e.id}" ${String(e.id) === String(defaultEmp) ? 'selected' : ''}>${esc(e.full_name)}</option>`
              ).join('')}
            </select>
            ${isMgr ? '' : '<div style="font-size:12px;color:var(--hint);margin-top:4px">Можно вносить только свои продажи</div>'}
          </div>
          <div class="field">
            <label>Точка <span style="font-weight:500;text-transform:none;color:var(--primary)">(из графика)</span></label>
            <select id="modalStore">
              ${(stores || []).map(s =>
                `<option value="${s.id}" ${s.id === defaultStore ? 'selected' : ''}>${s.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="field">
            <label>Тип <span style="font-weight:500;text-transform:none;color:var(--text-secondary)">(можно несколько)</span></label>
            <div class="metric-grid" id="metricGrid"></div>
          </div>
          <div class="field">
            <label>Количество</label>
            <div id="saleQtyList" class="qty-list"></div>
            <div class="quick">
              <button type="button" onclick="setAllQty(1)">1</button>
              <button type="button" onclick="setAllQty(2)">2</button>
              <button type="button" onclick="setAllQty(5)">5</button>
              <button type="button" onclick="setAllQty(10)">10</button>
            </div>
          </div>
          <button class="btn-main" onclick="submitSale()">Добавить</button>
        `;

        window._schByEmp = schByEmp;
        renderSaleMetrics();
        document.getElementById('overlay').classList.add('show');
      } catch (e) {
        console.error(e);
        toast('Ошибка загрузки', 'err');
      }
    }

    function onEmpChange() {
      const id = document.getElementById('modalEmployee').value;
      const storeId = window._schByEmp?.[id];
      if (storeId) {
        const sel = document.getElementById('modalStore');
        if (sel) sel.value = storeId;
      }
    }

    function renderSaleMetrics() {
      const grid = document.getElementById('metricGrid');
      if (!grid) return;
      grid.innerHTML = METRICS.map(m => `
        <button type="button" class="mchip ${saleSelection[m.id] != null ? 'on' : ''}" data-m="${m.id}"
          onclick="toggleSaleMetric('${m.id}')">${m.label}</button>
      `).join('');
      renderSaleQtyList();
    }

    function toggleSaleMetric(id) {
      if (saleSelection[id] != null) {
        delete saleSelection[id];
      } else {
        saleSelection[id] = 1;
      }
      renderSaleMetrics();
    }

    function renderSaleQtyList() {
      const list = document.getElementById('saleQtyList');
      if (!list) return;
      const keys = Object.keys(saleSelection);
      if (!keys.length) {
        list.innerHTML = '<div class="qty-empty">Выбери одну или несколько метрик</div>';
        return;
      }
      list.innerHTML = keys.map(key => {
        const m = METRICS.find(x => x.id === key) || { label: key, unit: '' };
        return `
          <div class="qty-row">
            <div class="qty-label">${m.label}<small>${m.unit || ''}</small></div>
            <input type="number" min="0" step="1" inputmode="decimal"
              value="${saleSelection[key]}"
              oninput="saleSelection['${key}'] = Number(String(this.value).replace(',','.')) || 0" />
          </div>
        `;
      }).join('');
    }

    function setAllQty(n) {
      Object.keys(saleSelection).forEach(k => { saleSelection[k] = n; });
      renderSaleQtyList();
    }

    function openModal() {
      const ov = document.getElementById('overlay');
      if (!ov) { console.error('overlay missing'); return; }
      ov.classList.add('show');
    }

    function closeModal() {
      document.getElementById('overlay')?.classList.remove('show');
    }


    async function openCorrectSale(saleRow) {
      if (!saleRow) return;
      const isMgr = canManage();
      if (!isMgr && me?.employee_id && String(saleRow.employee_id) !== String(me.employee_id)) {
        toast('Нельзя править чужие продажи', 'err');
        return;
      }
      saleSelection = {};
      document.getElementById('modalTitle').textContent = 'Исправить продажу (дельта)';
      document.getElementById('modalBody').innerHTML = `
        <div class="empty" style="text-align:left;padding:0 0 10px">
          Укажи <b>изменение</b>: −1 уменьшит, +1 добавит. Сотрудник: ${saleRow.full_name || saleRow.employee_id}
        </div>
        <input type="hidden" id="modalEmployee" value="${saleRow.employee_id}">
        <input type="hidden" id="modalStore" value="${saleRow.store_id}">
        <div class="field">
          <label>Метрики для правки</label>
          <div class="metric-grid" id="metricGrid"></div>
        </div>
        <div class="field">
          <label>Дельта</label>
          <div id="saleQtyList" class="qty-list"></div>
          <div class="quick">
            <button type="button" onclick="setAllQty(-1)">−1</button>
            <button type="button" onclick="setAllQty(1)">+1</button>
            <button type="button" onclick="setAllQty(-5)">−5</button>
          </div>
        </div>
        <button class="btn-main" onclick="submitSale()">Сохранить правку</button>
      `;
      renderSaleMetrics();
      document.getElementById('overlay').classList.add('show');
    }

    async function submitSale() {
      const employeeId = document.getElementById('modalEmployee')?.value;
      const storeId = document.getElementById('modalStore')?.value;
      if (!employeeId || !storeId) {
        toast('Укажи сотрудника и точку', 'err');
        return;
      }

      const payload = {
        employee_id: Number(employeeId),
        store_id: storeId,
        sale_date: todayMoscow()
      };

      let hasAny = false;
      const parts = [];
      for (const [k, v] of Object.entries(saleSelection)) {
        const n = Number(v);
        if (n > 0) {
          payload[k] = n;
          hasAny = true;
          const m = METRICS.find(x => x.id === k);
          parts.push((m ? m.label : k) + ' × ' + n);
        }
      }
      if (!hasAny) {
        toast('Выбери метрики и количество', 'err');
        return;
      }

      try {
        const res = await fetch(API + '/sales', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'fail');
        }
        closeModal();
        const streak = bumpStreak();
        const streakMsg = streak > 1 ? ` · 🔥 ${streak} дн.` : '';
        toast('Добавлено: ' + parts.join(', ') + streakMsg, 'ok');
        saleSelection = {};
        loadPage(page);
      } catch (e) {
        console.error(e);
        const msg = String(e?.message || e || '');
        // В очередь только реальная сеть (TypeError/Failed to fetch), не 400/403
        const isNetwork = /failed to fetch|network|load failed|offline/i.test(msg) || e?.name === 'TypeError';
        if (isNetwork && typeof OfflineQueue !== 'undefined') {
          try {
            const metrics = {};
            for (const [k, v] of Object.entries(saleSelection)) {
              const n = Number(v);
              if (n > 0) metrics[k] = n;
            }
            await OfflineQueue.enqueueSale({
              store_id: storeId,
              employee_id: Number(employeeId),
              metrics,
              sale_date: todayMoscow()
            });
            closeModal();
            saleSelection = {};
            toast('Нет сети — сохранено в очередь, уйдёт при Wi‑Fi', 'ok');
            return;
          } catch (e2) {
            console.error(e2);
          }
        }
        toast(msg && msg !== 'fail' ? msg : 'Ошибка сохранения', 'err');
      }
    }

    // overlay close
    document.getElementById('overlay').addEventListener('click', (e) => {
      if (e.target.id === 'overlay') closeModal();
    });

    // pull-to-refresh simple
    let touchStartY = 0;
    document.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0) touchStartY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (touchStartY && e.changedTouches[0].clientY - touchStartY > 80 && window.scrollY === 0) {
        refreshAll();
      }
      touchStartY = 0;
    }, { passive: true });

