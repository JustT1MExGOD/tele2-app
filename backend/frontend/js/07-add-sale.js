/* 07-add-sale.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== ADD SALE (smart) =====
    async function openAddSale(presetEmployeeId) {
      await loadMetricsCatalog();
      try {
        // Та же дыра, что и в карточке сотрудника/месячном графике —
        // без org_id admin при просмотре чужой сети видел бы в форме
        // добавления продажи СВОИХ сотрудников, а не сети, которую смотрит.
        const empParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const [empRes, storesData, schRes] = await Promise.all([
          fetch(API + '/employees' + empParam, { headers: authHeaders() }),
          fetchOrgStores(),
          fetch(API + '/schedules?date=' + todayMoscow() + orgQueryParam(), { headers: authHeaders() })
        ]);
        employees = await empRes.json();
        stores = storesData;
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
          <button class="btn-main" id="saleSubmitBtn" onclick="submitSale()">Добавить</button>
        `;

        // Один client_id на всю сессию формы — если submitSale() ретраит
        // (ошибка сети) или пользователь дважды тапнул кнопку до того, как
        // она успела задизейблиться, бэкенд задедупит по этому же ключу
        // вместо того чтобы удвоить сумму продажи.
        window.__saleClientId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

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
      const btn = document.getElementById('saleSubmitBtn');
      // Дизейблим сразу — иначе нетерпеливый двойной тап на сенсорном
      // экране успевает уйти двумя запросами ДО того, как придёт первый
      // ответ; client_id ниже страхует и сетевые ретраи, но не отменяет
      // смысла не плодить лишние запросы на ровном месте.
      if (btn?.disabled) return;
      if (btn) btn.disabled = true;

      const employeeId = document.getElementById('modalEmployee')?.value;
      const storeId = document.getElementById('modalStore')?.value;
      if (!employeeId || !storeId) {
        toast('Укажи сотрудника и точку', 'err');
        if (btn) btn.disabled = false;
        return;
      }

      const payload = {
        employee_id: Number(employeeId),
        store_id: storeId,
        sale_date: todayMoscow(),
        client_id: window.__saleClientId
      };
      if (me?.role === 'admin' && adminViewOrgId) payload.org_id = adminViewOrgId;

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
        if (btn) btn.disabled = false;
        return;
      }

      // Тренировочный режим обучения: форма настоящая, но запись в БД и в чат
      // не уходит — 10-tutorial.js ставит этот флаг перед openAddSale().
      if (window.__tutorialDryRun) {
        closeModal();
        toast('Тренировка: ' + parts.join(', ') + ' — по-настоящему это уйдёт в базу и в чат', 'ok');
        saleSelection = {};
        window.__tutorialDryRunCallback?.();
        if (btn) btn.disabled = false;
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
              sale_date: todayMoscow(),
              client_id: window.__saleClientId
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
        if (btn) btn.disabled = false;
      }
    }

    // overlay close
    document.getElementById('overlay').addEventListener('click', (e) => {
      if (e.target.id === 'overlay') closeModal();
    });

    // pull-to-refresh — раньше проверялись только начало/конец жеста: любой
    // быстрый скролл к верху страницы, у которого естественный отскок
    // (elastic bounce на границе) укладывался в "начали и закончили при
    // scrollY===0, палец сместился вниз на 80px+", засчитывался как
    // осознанная протяжка и незаметно триггерил обновление — жалобы на
    // "выбешивающее" обновление при обычном скролле. Теперь жест
    // отслеживается целиком (touchmove, не только start/end): если в любой
    // момент scrollY отошёл от 0, это была прокрутка/отскок, а не протяжка,
    // и жест сбрасывается. Плюс видимый индикатор (растёт с протяжкой,
    // меняет текст на пороге) — обновление больше не происходит "невидимо
    // из ниоткуда", и короткий cooldown, чтобы дребезг на границе не мог
    // выстрелить дважды подряд.
    const PTR_THRESHOLD = 100;
    const PTR_COOLDOWN_MS = 3000;
    let ptrStartY = 0;
    let ptrTracking = false;
    let ptrLastFireAt = 0;
    const ptrEl = document.getElementById('ptrIndicator');

    function ptrReset() {
      ptrTracking = false;
      ptrStartY = 0;
      if (ptrEl) {
        ptrEl.classList.remove('ready');
        ptrEl.style.opacity = '';
        ptrEl.style.transform = '';
      }
    }

    document.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0) {
        ptrStartY = e.touches[0].clientY;
        ptrTracking = true;
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!ptrTracking) return;
      if (window.scrollY !== 0) { ptrReset(); return; }
      const delta = e.touches[0].clientY - ptrStartY;
      if (!ptrEl) return;
      if (delta <= 0) {
        ptrEl.style.opacity = '0';
        ptrEl.style.transform = 'translateX(-50%) translateY(-48px)';
        ptrEl.classList.remove('ready');
        return;
      }
      const progress = Math.min(1, delta / PTR_THRESHOLD);
      ptrEl.style.opacity = String(progress);
      ptrEl.style.transform = `translateX(-50%) translateY(${-48 + progress * 48}px)`;
      const ready = delta >= PTR_THRESHOLD;
      ptrEl.classList.toggle('ready', ready);
      ptrEl.textContent = ready ? 'Отпусти, чтобы обновить' : 'Потяни, чтобы обновить';
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!ptrTracking) return;
      const delta = e.changedTouches[0].clientY - ptrStartY;
      const now = Date.now();
      const shouldFire =
        delta >= PTR_THRESHOLD && window.scrollY === 0 && now - ptrLastFireAt > PTR_COOLDOWN_MS;
      ptrReset();
      if (shouldFire) {
        ptrLastFireAt = now;
        refreshAll();
      }
    }, { passive: true });

