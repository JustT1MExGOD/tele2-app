/* 04-schedule.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== PLAN DAY =====
    async function loadPlanDay() {
      const box = document.getElementById('planList');
      box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      try {
        const date = todayMoscow();
        // 1) факт + график + шаблон/день из /plans?date=
        // 2) параллельно computed из /plans/stores/daily (из месячных планов сотрудников)
        const ov = orgQueryParam();
        const [stRes, statsRes, schRes, plansRes, dailyRes] = await Promise.all([
          fetch(API + '/stores', { headers: authHeaders() }),
          fetch(API + '/stats/daily?date=' + date + ov, { headers: authHeaders() }),
          fetch(API + '/schedules?date=' + date + ov, { headers: authHeaders() }),
          fetch(API + '/plans?date=' + date, { headers: authHeaders() }),
          fetch(API + '/plans/stores/daily?date=' + date + ov, { headers: authHeaders() })
        ]);
        // /stores намеренно не scoped по сети (нужен целиком в других местах —
        // подмена в чужой сети в форме продажи/кассе) — глобальную переменную
        // stores не трогаем, для карточек здесь берём локально отфильтрованный список.
        stores = await stRes.json();
        const myOrgId = me?.role === 'admin' && adminViewOrgId ? adminViewOrgId : me?.org_id;
        const myStores = (Array.isArray(stores) ? stores : []).filter((s) => (s.org_id || 'default') === (myOrgId || 'default'));
        const stats = await statsRes.json();
        const schedules = await schRes.json();
        const plans = await plansRes.json();
        let dailyComputed = null;
        try {
          if (dailyRes.ok) dailyComputed = await dailyRes.json();
        } catch (_) {}

        const statsMap = {};
        (Array.isArray(stats) ? stats : []).forEach(s => { statsMap[s.store_id || s.id] = s; });

        // Приоритет планов:
        // A) материализованные на сегодня (plan_date = date)
        // B) computed из месячных планов сотрудников (/plans/stores/daily)
        // C) шаблон plan_date IS NULL
        const planMap = {};
        const todayStr = date;

        (Array.isArray(plans) ? plans : []).forEach(p => {
          const pd = p.plan_date ? String(p.plan_date).slice(0, 10) : null;
          if (pd === todayStr) {
            planMap[p.store_id] = { ...p, _src: 'day' };
          } else if (pd == null && !planMap[p.store_id]) {
            planMap[p.store_id] = { ...p, _src: 'template' };
          }
        });

        if (dailyComputed?.stores?.length) {
          dailyComputed.stores.forEach(st => {
            const hasDay = planMap[st.store_id]?._src === 'day';
            // если на сегодня ещё не записали в БД — берём live-расчёт
            if (!hasDay && st.plan) {
              const anyPositive = Object.values(st.plan).some(v => Number(v) > 0);
              if (anyPositive || !planMap[st.store_id]) {
                planMap[st.store_id] = { store_id: st.store_id, ...st.plan, _src: 'computed' };
              }
            }
          });
        }
        const staffMap = {};
        (Array.isArray(schedules) ? schedules : []).forEach(s => {
          if (!staffMap[s.store_id]) staffMap[s.store_id] = [];
          staffMap[s.store_id].push(s);
        });

        const list = myStores.slice().sort((a, b) => (a.hours || 0) - (b.hours || 0));
        if (!list.length) {
          box.innerHTML = '<div class="empty">Нет точек</div>';
          return;
        }

        box.innerHTML = list.map((store, idx) => {
          const fact = statsMap[store.id] || {};
          const plan = planMap[store.id] || {};
          const staff = staffMap[store.id] || [];
          const keys = METRICS.slice(0, 8).map(m => m.id);
          let sf = 0, sp = 0;
          keys.forEach(k => { sf += +fact[k] || 0; sp += +plan[k] || 0; });
          const overall = sp > 0 ? Math.round((sf / sp) * 100) : (sf > 0 ? 100 : 0);

          return `
            <div class="store-card ${idx === 0 ? 'open' : ''}" id="sc-${store.id}">
              <div class="store-head" onclick="toggleStore('${store.id}')">
                <div class="store-badge">${(store.short_name || store.name || '?').slice(0, 2)}</div>
                <div class="store-meta">
                  <div class="store-name">${store.name}</div>
                  <div class="store-code">${store.code || ''} · ${store.work_time || ''}</div>
                </div>
                <div class="store-pct ${pctTone(overall)}">${overall}%</div>
              </div>
              <div class="store-body">
                ${staff.length ? `<div class="chips">${staff.map(s =>
                  `<span class="chip">${esc(s.full_name)}${s.shift_text ? ' · ' + esc(s.shift_text) : ''}</span>`
                ).join('')}</div>` : '<div class="empty" style="padding:12px 0">Нет на смене</div>'}

                <div class="block-label">Блок GI</div>
                ${progressHTML(metricLabel('sim'), fact.sim, plan.sim)}
                ${progressHTML(metricLabel('mnp'), fact.mnp, plan.mnp)}
                ${progressHTML(metricLabel('pa'), fact.pa, plan.pa)}

                <div class="block-label">Товарка</div>
                ${progressHTML(metricLabel('combo'), fact.combo, plan.combo)}
                ${progressHTML(metricLabel('phones'), fact.phones, plan.phones)}
                ${progressHTML(metricLabel('accessories'), fact.accessories, plan.accessories)}
                ${progressHTML(metricLabel('insurance'), fact.insurance, plan.insurance)}

                <div class="block-label">Ростелеком</div>
                ${progressHTML(metricLabel('wink'), fact.wink, plan.wink)}
                ${progressHTML(metricLabel('shpd'), fact.shpd, plan.shpd)}
                ${progressHTML(metricLabel('focus'), fact.focus, plan.focus)}

                <div class="block-label">Кредиты</div>
                ${progressHTML('Заявка', fact.credit_request, plan.credit_request)}
                ${progressHTML('Выданный', fact.credit_issued, plan.credit_issued)}
              </div>
            </div>`;
        }).join('');
      } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="empty">Ошибка загрузки</div>';
      }
    }

    function toggleStore(id) {
      document.getElementById('sc-' + id)?.classList.toggle('open');
    }

    // ===== TODAY SCHEDULE =====
    async function loadTodaySchedule() {
      const box = document.getElementById('todayList');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const date = todayMoscow();
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const [schRes, stRes] = await Promise.all([
          fetch(API + '/schedules?date=' + date + orgParam, { headers: authHeaders() }),
          fetch(API + '/stores', { headers: authHeaders() })
        ]);
        const schedules = await schRes.json();
        stores = await stRes.json();

        if (!Array.isArray(schedules) || !schedules.length) {
          box.innerHTML = '<div class="section"><div class="empty">Сегодня никого в графике</div></div>';
          return;
        }

        const byStore = {};
        schedules.forEach(s => {
          if (!byStore[s.store_id]) byStore[s.store_id] = [];
          byStore[s.store_id].push(s);
        });

        box.innerHTML = (Array.isArray(stores) ? stores : []).map(store => {
          const list = byStore[store.id] || [];
          if (!list.length) return '';
          return `
            <div class="section today-store">
              <div class="section-title">${store.name}
                <div class="section-sub">${store.code || ''}</div>
              </div>
              ${list.map(s => `
                <button class="row" onclick="openEmployeeCard(${s.employee_id})">
                  <div class="row-icon">👤</div>
                  <div class="row-body">
                    <div class="row-title">${esc(s.full_name)}</div>
                    <div class="row-sub">${esc(s.shift_text || '')} · ${s.hours || ''}ч</div>
                  </div>
                  <div class="row-chevron">›</div>
                </button>
              `).join('')}
            </div>`;
        }).join('') || '<div class="section"><div class="empty">Пусто</div></div>';
      } catch (e) {
        box.innerHTML = '<div class="empty">Ошибка</div>';
      }
    }

    // ===== MONTH SCHEDULE =====
    function shiftMonth(delta) {
      const [y, m] = scheduleMonth.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      scheduleMonth = d.toISOString().slice(0, 7);
      loadMonthSchedule();
    }

    function monthLabel(ym) {
      const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
      const [y, m] = ym.split('-');
      return names[+m - 1] + ' ' + y;
    }

    function daysInMonth(ym) {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, m, 0).getDate();
    }

    async function loadMonthSchedule() {
      document.getElementById('monthLabel').textContent = monthLabel(scheduleMonth);
      const box = document.getElementById('monthBoard');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const res = await fetch(API + '/schedules/month?month=' + scheduleMonth + orgParam, { headers: authHeaders() });
        let data;
        if (res.ok) {
          data = await res.json();
        } else {
          // fallback: empty
          data = { items: [] };
        }
        const items = data.items || [];

        if (!stores.length) {
          const stRes = await fetch(API + '/stores', { headers: authHeaders() });
          stores = await stRes.json();
        }

        // Всегда полный список сотрудников, смены накладываем поверх
        const empRes = await fetch(API + '/employees', { headers: authHeaders() });
        const emps = await empRes.json();
        const byEmp = {};
        (emps || []).forEach(e => {
          byEmp[e.id] = { id: e.id, name: e.full_name, days: {} };
        });
        items.forEach(row => {
          const id = row.employee_id;
          if (!byEmp[id]) byEmp[id] = { id, name: row.full_name, days: {} };
          const key = String(row.work_date).slice(0, 10);
          byEmp[id].days[key] = row;
        });

        const total = daysInMonth(scheduleMonth);
        const list = Object.values(byEmp).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        const editable = canManage();
        const hint = editable
          ? '<div class="empty" style="padding:8px 0 12px">Нажми на день, чтобы поставить / убрать смену</div>'
          : '';

        box.innerHTML = hint + list.map(emp => {
          const workCount = Object.keys(emp.days).length;
          let cells = '';
          for (let d = 1; d <= total; d++) {
            const key = scheduleMonth + '-' + String(d).padStart(2, '0');
            const row = emp.days[key];
            const storeId = row?.store_id || (stores[0] && stores[0].id) || '';
            const hours = row?.hours || 0;
            const click = editable
              ? `onclick="editDay(${emp.id}, '${key}', '${storeId}', ${hours})"`
              : '';
            if (row) {
              const short = (row.store_short || row.store_name || '').slice(0, 4);
              const col = storeColor(row.store_id);
              cells += `<div class="sch-cell work" ${click} title="${row.store_name || ''} ${row.shift_text || ''}"
                style="background:${col}22;color:${col};border-color:${col}">
                <div class="d">${d}</div><div class="s">${short}</div></div>`;
            } else {
              cells += `<div class="sch-cell off" ${click}><div class="d">${d}</div></div>`;
            }
          }
          return `
            <div class="sch-emp">
              <div class="sch-emp-head">
                <span>${emp.name}</span>
                <span class="cnt">${workCount} смен</span>
              </div>
              <div class="sch-grid">${cells}</div>
            </div>`;
        }).join('') || '<div class="empty">Нет данных</div>';
      } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="empty">Ошибка загрузки графика</div>';
      }
    }

    async function editDay(employeeId, dateStr, currentStoreId, currentHours) {
      if (!canManage()) return;
      if (!stores.length) {
        const stRes = await fetch(API + '/stores', { headers: authHeaders() });
        stores = await stRes.json();
      }
      document.getElementById('modalTitle').textContent = 'Смена ' + dateStr;
      document.getElementById('modalBody').innerHTML = `
        <div class="field">
          <label>Точка</label>
          <select id="schStore">
            ${(stores || []).map(s =>
              `<option value="${s.id}" ${s.id === currentStoreId ? 'selected' : ''}>${s.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label>Часы (0 = выходной)</label>
          <input type="number" id="schHours" value="${currentHours || 0}" min="0" max="14">
        </div>
        <div class="field">
          <label>Смена</label>
          <input id="schText" value="${currentHours ? '10-21' : '10-21'}" placeholder="10-21">
        </div>
        <button class="btn-main" onclick="saveShift(${employeeId}, '${dateStr}')">Сохранить</button>
      `;
      document.getElementById('overlay').classList.add('show');
    }

    async function saveShift(employeeId, dateStr) {
      const store_id = document.getElementById('schStore').value;
      const hours = Number(document.getElementById('schHours').value) || 0;
      const shift_text = document.getElementById('schText').value || '';
      try {
        const res = await fetch(API + '/schedules/bulk', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            items: [{ employee_id: employeeId, work_date: dateStr, store_id, hours, shift_text }]
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast(err.message || 'Нет прав', 'err');
          return;
        }
        toast('Смена сохранена', 'ok');
        closeModal();
        loadMonthSchedule();
      } catch (e) {
        toast('Ошибка', 'err');
      }
    }

