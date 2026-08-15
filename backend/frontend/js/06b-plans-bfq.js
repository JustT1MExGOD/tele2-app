/* 06b-plans-bfq.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   BFQ-скоринг + месячные планы сотрудников + месячные/дневные планы точек
   (вынесено из 06-team-bfq.js, который тянул это вместе с командой). */
    // ===== BFQ =====
    async function loadBFQ() {
      const box = document.getElementById('bfqList');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const month = scheduleMonth || todayMoscow().slice(0, 7);
        const res = await fetch(API + '/bfq?month=' + month + orgQueryParam(), { headers: authHeaders() });
        if (!res.ok) throw new Error('no bfq');
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.items || []);
        if (!list.length) {
          box.innerHTML = '<div class="empty">Нет данных BFQ</div>';
          return;
        }
        box.innerHTML = list.map((e, i) => `
          <button class="row" onclick="openBFQCard(${e.employee_id})">
            <div class="row-icon">${i + 1}</div>
            <div class="row-body">
              <div class="row-title">${esc(e.full_name || e.name)}</div>
              <div class="row-sub">Кач. ${e.quality ?? '—'} · Приб. ${e.profit ?? '—'} · VMR ${e.vmr ?? 0}</div>
            </div>
            <div class="row-value">${e.total ?? e.bfq ?? '—'}</div>
            <div class="row-chevron">›</div>
          </button>
        `).join('');
      } catch {
        box.innerHTML = '<div class="empty">Ошибка BFQ</div>';
      }
    }

    async function openBFQCard(id) {
      document.getElementById('modalTitle').textContent = 'BFQ';
      document.getElementById('modalBody').innerHTML = '<div class="empty">Загрузка…</div>';
      document.getElementById('overlay').classList.add('show');
      try {
        const month = todayMoscow().slice(0, 7);
        const res = await fetch(API + '/bfq/' + id + '?month=' + month + orgQueryParam(), { headers: authHeaders() });
        const d = await res.json();
        const f = d.fact || {};
        const fc = d.forecast || {};
        let manual = '';
        if (canManage()) {
          manual = `
            <div class="field"><label>VMR средний</label>
              <input type="number" id="bfqVmr" value="${f.vmr || 0}" step="0.1"></div>
            <div class="field"><label>Штраф</label>
              <input type="number" id="bfqPenalty" value="${f.penalty || 0}" step="0.1"></div>
            <button class="btn-main" onclick="saveBFQManual(${id})">Сохранить VMR / штраф</button>`;
        }
        document.getElementById('modalBody').innerHTML = `
          <div class="stats-row">
            <div class="stat-chip"><div class="n">${f.total ?? '—'}</div><div class="l">Факт</div></div>
            <div class="stat-chip"><div class="n">${fc.total ?? '—'}</div><div class="l">Прогноз</div></div>
            <div class="stat-chip"><div class="n">${f.quality ?? '—'}</div><div class="l">Качество</div></div>
          </div>
          <div class="progress-block">
            ${progressHTML('GI', f.blocks?.gi, 50)}
            ${progressHTML('VMR блок', f.blocks?.vmr, 12)}
            ${progressHTML('Digital', f.blocks?.digital, 25)}
            ${progressHTML('Top-up', f.blocks?.topUp, 15)}
            ${progressHTML('Прибыль', f.profit, 20)}
          </div>
          <div class="empty" style="padding:8px 0">
            Смены: ${d.shifts?.worked || 0} отработано · ${d.shifts?.remaining || 0} осталось
          </div>
          ${manual}`;
      } catch {
        document.getElementById('modalBody').innerHTML = '<div class="empty">Ошибка</div>';
      }
    }

    async function saveBFQManual(employeeId) {
      const vmr = Number(document.getElementById('bfqVmr').value) || 0;
      const penalty = Number(document.getElementById('bfqPenalty').value) || 0;
      const month = todayMoscow().slice(0, 7);
      const body = { employee_id: employeeId, month, vmr_avg: vmr, penalty };
      if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
      const res = await fetch(API + '/bfq/manual', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (!res.ok) { toast('Нет прав или ошибка', 'err'); return; }
      toast('Сохранено', 'ok');
      closeModal();
      loadBFQ();
    }

    // ===== Планы сотрудников за месяц =====
    async function loadMonthPlans() {
      const box = document.getElementById('monthPlanList');
      const meta = document.getElementById('monthPlanMeta');
      const label = document.getElementById('planMonthLabel');
      if (!planMonth) planMonth = todayMoscow().slice(0, 7);
      if (label) label.textContent = monthLabel(planMonth);
      if (box) box.innerHTML = '<div class="skeleton"></div>';
      try {
        const res = await fetch(API + '/plans/employees/month?month=' + planMonth + orgQueryParam(), { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const rows = data.rows || [];
        if (meta) {
          meta.innerHTML = `Сотрудников: <b>${rows.length}</b> · ост. дней: <b>${data.remaining_days ?? '—'}</b>`;
        }

        const MAIN = METRICS.slice(0, 6).map(x => ({ id: x.id, label: x.label }));
        const EXTRA = METRICS.slice(6).map(x => ({ id: x.id, label: x.label }));

        function cell(m, fact, pct) {
          const f = Number(fact[m.id]) || 0;
          const pc = Number(pct[m.id]) || 0;
          const tone = pc >= 100 ? 'good' : pc >= 50 ? 'warn' : (f > 0 ? '' : 'bad');
          return `<div class="mt-cell ${tone}"><div class="v">${f}</div><div class="l">${m.label}</div></div>`;
        }

        if (!rows.length) {
          box.innerHTML = '<div class="empty">Нет данных за ' + planMonth + '</div>';
          if (typeof loadStoreDailyPlans === 'function') loadStoreDailyPlans();
          return;
        }

        let html = '<div class="mobile-table">' + rows.map((r, idx) => {
          const plan = r.plan || {};
          const fact = r.fact || {};
          const pct = r.pct || {};
          const nameClick = canManage()
            ? `onclick="event.stopPropagation();editEmployeeMonthPlan(${r.employee_id}, '${String(r.full_name || '').replace(/'/g, "\\'")}')"`
            : '';
          const mainCells = MAIN.map(m => cell(m, fact, pct)).join('');
          const extraCells = EXTRA.map(m => cell(m, fact, pct)).join('');
          const eid = 'mpx-' + idx;
          return `<div class="mt-card">
            <div class="mt-card-head" ${nameClick} style="${nameClick ? 'cursor:pointer' : ''}">
              <div>
                <div class="mt-name">${esc(r.full_name || '')}</div>
                <div class="mt-meta">${r.role || ''} · смен ${r.shifts || 0} · ост. ${r.remaining_shifts || 0}</div>
              </div>
            </div>
            <div class="mt-grid">${mainCells}</div>
            <div class="mt-more">
              <button type="button" class="mt-toggle" onclick="toggleMonthExtra('${eid}', this)">Ещё метрики ▾</button>
              <div class="mt-extra" id="${eid}">${extraCells}</div>
            </div>
          </div>`;
        }).join('') + '</div>';

        const tf = (data.totals && data.totals.fact) || null;
        // data.totals.pct тоже существовал в ответе (getMonthSummaryTable()),
        // просто раньше не читался — карточка всегда рендерилась без тона
        // (зелёный/жёлтый), потому что cell() получала пустой {} вместо pct.
        const tp = (data.totals && data.totals.pct) || {};
        if (tf) {
          html += `<div class="mt-card" style="margin:0 12px 16px;border-color:var(--primary)">
            <div class="mt-name" style="margin-bottom:10px">Итого сеть · ${planMonth}</div>
            <div class="mt-grid">${MAIN.map(m => cell(m, tf, tp)).join('')}</div>
            <div class="mt-more">
              <button type="button" class="mt-toggle" onclick="toggleMonthExtra('mpx-tot', this)">Ещё метрики ▾</button>
              <div class="mt-extra" id="mpx-tot">${EXTRA.map(m => cell(m, tf, tp)).join('')}</div>
            </div>
          </div>`;
        }
        box.innerHTML = html;
        if (typeof loadStoreDailyPlans === 'function') loadStoreDailyPlans();
      } catch (e) {
        console.error(e);
        if (box) box.innerHTML = '<div class="empty">Планы месяца недоступны</div>';
      }
    }

    function shiftPlanMonth(delta) {
      const [y, m] = planMonth.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      planMonth = d.toISOString().slice(0, 7);
      loadMonthPlans();
    }

    // «Сеть за месяц» — все 15 метрик сразу, план/факт/% всей команды сети,
    // строками-барами (тот же стиль, что кабинет супервайзера, svBarRowHTML/
    // svBarColor из 08-access-supervisor.js — переиспользуем как есть, это
    // тот же общий global scope). Данные те же, что и «Итого сеть» на
    // «Планы и факт за месяц» (GET /plans/employees/month, data.totals) —
    // просто отдельная быстрая вкладка без разбивки по сотрудникам.
    function shiftNetMonth(delta) {
      const [y, m] = planMonth.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      planMonth = d.toISOString().slice(0, 7);
      loadNetMonth();
    }

    async function loadNetMonth() {
      const box = document.getElementById('netMonthBody');
      const label = document.getElementById('netMonthLabel');
      if (!box) return;
      if (label) label.textContent = planMonth;
      box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      try {
        const res = await fetch(API + '/plans/employees/month?month=' + planMonth + orgQueryParam(), { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const totals = data.totals || {};
        const fact = totals.fact || {};
        const plan = totals.plan || {};
        const netRows = METRICS.map(m => svBarRowHTML(m.label, Number(fact[m.id]) || 0, Number(plan[m.id]) || 0)).join('');
        let html = `<div class="sv-store" style="--sc:#2AABEE"><div class="sv-bars">${netRows}</div></div>`
          + `<div class="empty" style="text-align:left;padding:8px 16px">Сотрудников: ${data.rows ? data.rows.length : 0} · ост. дней: ${data.remaining_days ?? '—'}</div>`;

        // По каждому сотруднику сети — тот же барный стиль, что у сети целиком,
        // вместо .mt-cell сетки на «Планы и факт за месяц». MAIN(6)/EXTRA(9) —
        // тот же сплит, что и там, просто другой визуал.
        const empRows = data.rows || [];
        if (empRows.length) {
          html += `<div class="sv-section">По сотрудникам</div>`;
          const mainIds = METRICS.slice(0, 6);
          const extraIds = METRICS.slice(6);
          html += empRows.map((r, idx) => {
            const ef = r.fact || {};
            const ep = r.plan || {};
            const mainRows = mainIds.map(m => svBarRowHTML(m.label, Number(ef[m.id]) || 0, Number(ep[m.id]) || 0)).join('');
            const extraRows = extraIds.map(m => svBarRowHTML(m.label, Number(ef[m.id]) || 0, Number(ep[m.id]) || 0)).join('');
            return `<div class="sv-store" style="--sc:#2AABEE">
              <div class="sv-store-head">
                <div>
                  <div class="sv-store-name">${esc(r.full_name || '')}</div>
                  <div class="sv-store-code">${roleLabel(r.role)} · смен ${r.shifts || 0} · ост. ${r.remaining_shifts || 0}</div>
                </div>
              </div>
              <div class="sv-bars">${mainRows}</div>
              ${svExtraToggleHTML('nme-' + idx, extraRows)}
            </div>`;
          }).join('');
        }

        box.innerHTML = html;
      } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="empty">Не удалось загрузить</div>';
      }
    }

    function toggleMonthExtra(id, btn) {
      const el = document.getElementById(id);
      if (!el) return;
      const open = el.classList.toggle('open');
      if (btn) btn.textContent = open ? 'Свернуть ▴' : 'Ещё метрики ▾';
    }

    async function editEmployeeMonthPlan(employeeId, name) {
      if (!canManage()) return;
      await loadMetricsCatalog();
      const month = planMonth || scheduleMonth || todayMoscow().slice(0, 7);
      const res = await fetch(API + '/plans/employees/' + employeeId + '/month?month=' + month, {
        headers: authHeaders()
      });
      const p = res.ok ? await res.json() : {};
      document.getElementById('modalTitle').textContent = 'План: ' + (name || employeeId);
      const fields = METRICS.map(m => {
        let val = p[m.id];
        if (val == null && m.id === 'credit_issued') val = p.credit;
        return '<div class="field"><label>' + m.label + (m.unit ? ' (' + m.unit + ')' : '') + '</label>' +
          '<input type="number" id="mp_' + m.id + '" value="' + (Number(val) || 0) + '"></div>';
      }).join('');
      document.getElementById('modalBody').innerHTML =
        '<div class="empty" style="text-align:left;padding:0 0 12px">Месяц ' + month + '. Дневной = остаток / смены.</div>' +
        fields +
        '<button class="btn-main" onclick="saveEmployeeMonthPlan(' + employeeId + ')">Сохранить</button>';
      document.getElementById('overlay').classList.add('show');
    }

    async function saveEmployeeMonthPlan(employeeId) {
      const month = planMonth || scheduleMonth || todayMoscow().slice(0, 7);
      const body = { month };
      for (const m of METRICS) {
        const el = document.getElementById('mp_' + m.id);
        if (el) body[m.id] = Number(el.value) || 0;
      }
      if (body.credit_issued != null) body.credit = body.credit_issued;
      const res = await fetch(API + '/plans/employees/' + employeeId + '/month', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let msg = 'Ошибка';
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch (_) {}
        toast(msg, 'err');
        return;
      }
      toast('План сохранён', 'ok');
      closeModal();
      if (typeof loadMonthPlans === 'function') loadMonthPlans();
    }

    // ===== Планы точек: дневной расчёт + ручной ввод месячного плана =====
    // Кэш имён точек последней загрузки — чтобы не передавать имя через
    // onclick-атрибут строкой (кавычки в названии точки уже ломали такое раньше).
    let storeDailyPlanNames = {};

    async function loadStoreDailyPlans() {
      const box = document.getElementById('storeDailyPlans');
      if (!box) return;
      try {
        const res = await fetch(API + '/plans/stores/daily?_=1' + orgQueryParam(), { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const stores = data.stores || [];
        storeDailyPlanNames = {};
        stores.forEach(st => { storeDailyPlanNames[st.store_id] = st.name; });
        if (!stores.length) {
          box.innerHTML = '<div class="empty">Нет данных</div>';
          return;
        }
        const editable = canManage();
        box.innerHTML = stores.map(st => {
          const col = storeColor(st.store_id, st);
          const p = st.plan || {};
          const initial = (st.name || '?').slice(0, 2).toUpperCase();
          const chips = METRICS.slice(0, 8).map(m =>
            `<div class="stat-chip"><div class="n">${p[m.id] || 0}</div><div class="l">${m.label}</div></div>`
          ).join('');
          const click = editable ? `onclick="editStoreMonthPlan('${st.store_id}')" style="cursor:pointer"` : 'style="cursor:default"';
          return `
            <div class="store-card" style="border-left:4px solid ${col};margin:8px 12px">
              <div class="store-head" ${click}>
                <div class="store-badge" style="background:${col}33;color:${col}">${initial}</div>
                <div class="store-meta">
                  <div class="store-name">${st.name}</div>
                  <div class="store-code">${st.code || ''} · дневной план${st.has_plan ? '' : ' · план на месяц не задан'}</div>
                </div>
                ${editable ? '<div class="row-chevron">›</div>' : ''}
              </div>
              <div class="stats-row" style="padding:0 12px 12px">${chips}</div>
            </div>`;
        }).join('');
        // Кнопка «Записать дневные планы в БД» убрана (19.3) — оба случая,
        // ради которых её нажимали, давно автоматизированы: ежедневный крон
        // в 6:00 МСК (cron/reports.ts) и мгновенный пересчёт сразу при
        // правке плана точки (routes-plans-v5.ts, PUT /plans/stores/:id/month).
      } catch {
        box.innerHTML = '<div class="empty">Дневные планы точек пока недоступны</div>';
      }
    }

    // План точки на месяц — вручную, независимо от планов сотрудников
    // (эпик 17.0: убрали распределение по долям, точка теперь ведёт свой план сама).
    async function editStoreMonthPlan(storeId) {
      if (!canManage()) return;
      await loadMetricsCatalog();
      const month = todayMoscow().slice(0, 7);
      const name = storeDailyPlanNames[storeId] || storeId;
      const res = await fetch(API + '/plans/stores/' + storeId + '/month?month=' + month, {
        headers: authHeaders()
      });
      const p = res.ok ? await res.json() : {};
      document.getElementById('modalTitle').textContent = 'План точки: ' + name;
      const fields = METRICS.map(m => {
        let val = p[m.id];
        if (val == null && m.id === 'credit_issued') val = p.credit;
        return '<div class="field"><label>' + m.label + (m.unit ? ' (' + m.unit + ')' : '') + '</label>' +
          '<input type="number" id="smp_' + m.id + '" value="' + (Number(val) || 0) + '"></div>';
      }).join('');
      document.getElementById('modalBody').innerHTML =
        '<div class="empty" style="text-align:left;padding:0 0 12px">Месяц ' + month + ', план на всю точку целиком. Дневной = остаток / оставшиеся дни.</div>' +
        fields +
        '<button class="btn-main" onclick="saveStoreMonthPlan(\'' + storeId + '\')">Сохранить</button>';
      document.getElementById('overlay').classList.add('show');
    }

    async function saveStoreMonthPlan(storeId) {
      const month = todayMoscow().slice(0, 7);
      const body = { month };
      for (const m of METRICS) {
        const el = document.getElementById('smp_' + m.id);
        if (el) body[m.id] = Number(el.value) || 0;
      }
      if (body.credit_issued != null) body.credit = body.credit_issued;
      // Точка уже пришла из списка, отфильтрованного переключателем сети —
      // без org_id бэкенд резолвит orgId в СВОЮ сеть admin'а и 403-ит на
      // чужой точке (assertStoreInOrg), хотя сама точка видна в списке.
      if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
      const res = await fetch(API + '/plans/stores/' + storeId + '/month', {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        let msg = 'Ошибка';
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch (_) {}
        toast(msg, 'err');
        return;
      }
      toast('План точки сохранён', 'ok');
      closeModal();
      if (typeof loadStoreDailyPlans === 'function') loadStoreDailyPlans();
    }
