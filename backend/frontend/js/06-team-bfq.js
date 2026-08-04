/* 06-team-bfq.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен. */
    // ===== TEAM =====
    async function loadTeam() {
      const box = document.getElementById('teamList');
      box.innerHTML = '<div class="skeleton"></div>';
      const tools = document.getElementById('managerTools');
      if (tools) tools.style.display = canManage() ? 'block' : 'none';
      try {
        const [empRes, salesRes] = await Promise.all([
          fetch(API + '/employees', { headers: authHeaders() }),
          fetch(API + '/sales?date=' + todayMoscow(), { headers: authHeaders() })
        ]);
        employees = await empRes.json();
        const sales = await salesRes.json();
        const map = {};
        (Array.isArray(sales) ? sales : []).forEach(s => {
          if (!map[s.employee_id]) map[s.employee_id] = { sim: 0, phones: 0, combo: 0 };
          map[s.employee_id].sim += +s.sim || 0;
          map[s.employee_id].phones += +s.phones || 0;
          map[s.employee_id].combo += +s.combo || 0;
        });
        const list = Array.isArray(employees) ? employees : [];
        box.innerHTML = list.map(e => {
          const st = map[e.id] || { sim: 0, phones: 0, combo: 0 };
          const roleBadge = e.role === 'manager' || e.role === 'admin' ? ' · ⭐' : '';
          const adminBtns = canManage()
            ? `<div style="display:flex;gap:6px;padding:0 16px 10px">
                <button class="mchip" style="flex:1" onclick="event.stopPropagation();setRole(${e.id},'manager')">Manager</button>
                <button class="mchip" style="flex:1" onclick="event.stopPropagation();setRole(${e.id},'employee')">Employee</button>
                <button class="mchip" style="flex:1;color:var(--danger)" onclick="event.stopPropagation();removeEmployee(${e.id})">Удалить</button>
              </div>`
            : '';
          return `
            <div>
              <button class="row" onclick="openEmployeeCard(${e.id})">
                <div class="row-icon">👤</div>
                <div class="row-body">
                  <div class="row-title">${esc(e.full_name)}${roleBadge}</div>
                  <div class="row-sub">SIM ${st.sim} · Комбо ${st.combo} · Тел ${st.phones} · ${e.role || 'employee'}</div>
                </div>
                <div class="row-chevron">›</div>
              </button>
              ${adminBtns}
            </div>`;
        }).join('') || '<div class="empty">Нет сотрудников</div>';
      } catch {
        box.innerHTML = '<div class="empty">Ошибка</div>';
      }
    }

    // ===== Employee card =====
    async function openEmployeeCard(id) {
      document.getElementById('modalTitle').textContent = 'Сотрудник';
      document.getElementById('modalBody').innerHTML = '<div class="empty">Загрузка…</div>';
      document.getElementById('overlay').classList.add('show');

      try {
        const [empRes, salesRes, schRes] = await Promise.all([
          fetch(API + '/employees', { headers: authHeaders() }),
          fetch(API + '/sales?date=' + todayMoscow(), { headers: authHeaders() }),
          fetch(API + '/schedules?date=' + todayMoscow(), { headers: authHeaders() })
        ]);
        const emps = await empRes.json();
        const sales = await salesRes.json();
        const schedules = await schRes.json();
        const emp = (emps || []).find(e => String(e.id) === String(id));
        const sale = (sales || []).find(s => String(s.employee_id) === String(id));
        const sch = (schedules || []).find(s => String(s.employee_id) === String(id));

        const saleMetrics = [
          ['sim', 'SIM'], ['mnp', 'MNP'], ['pa', 'ПА'], ['combo', 'Комбо'],
          ['phones', 'Телефоны'], ['accessories', 'Аксессуары'], ['wink', 'Wink'], ['shpd', 'ШПД']
        ];
        // manager/admin может отменить ошибочно внесённую метрику за сегодня —
        // sales аддитивные, отдельной "продажи" для удаления нет, поэтому это
        // обнуление конкретного показателя, не всей записи за день.
        const nonZero = sale ? saleMetrics.filter(([key]) => Number(sale[key]) > 0) : [];
        const correctionBlock = (canManage() && sale && nonZero.length)
          ? `<div class="block-label">Исправить ошибочный ввод</div>
             <div class="progress-block" style="display:flex;flex-direction:column;gap:8px">
               ${nonZero.map(([key, label]) => `
                 <div style="display:flex;justify-content:space-between;align-items:center">
                   <span style="font-size:14px">${label}: <b>${Number(sale[key])}</b></span>
                   <button class="mchip" style="color:var(--danger)" onclick="zeroSaleMetric(${sale.id},'${key}','${label}',${id})">Удалить</button>
                 </div>`).join('')}
             </div>`
          : '';

        document.getElementById('modalTitle').textContent = emp?.full_name || 'Сотрудник';
        document.getElementById('modalBody').innerHTML = `
          <div class="field">
            <label>Смена сегодня</label>
            <div style="font-size:15px;font-weight:600">
              ${sch ? `${sch.store_name || sch.store_id} · ${sch.shift_text || ''} (${sch.hours || ''}ч)` : 'Выходной / нет в графике'}
            </div>
          </div>
          <div class="block-label">Продажи сегодня</div>
          <div class="progress-block">
            ${saleMetrics.map(([key, label]) => progressHTML(label, sale?.[key], 0)).join('')}
          </div>
          ${correctionBlock}
          <button class="btn-main" onclick="openAddSale(${id})">Добавить продажу</button>
        `;
      } catch (e) {
        document.getElementById('modalBody').innerHTML = '<div class="empty">Ошибка</div>';
      }
    }

    // ===== BFQ =====
    async function loadBFQ() {
      const box = document.getElementById('bfqList');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const month = scheduleMonth || todayMoscow().slice(0, 7);
        const res = await fetch(API + '/bfq?month=' + month, { headers: authHeaders() });
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
        const res = await fetch(API + '/bfq/' + id + '?month=' + month, { headers: authHeaders() });
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
      const res = await fetch(API + '/bfq/manual', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ employee_id: employeeId, month, vmr_avg: vmr, penalty })
      });
      if (!res.ok) { toast('Нет прав или ошибка', 'err'); return; }
      toast('Сохранено', 'ok');
      closeModal();
      loadBFQ();
    }

    async function loadHistory() {
      const box = document.getElementById('historyList');
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        const from = todayMoscow().slice(0, 8) + '01';
        const to = todayMoscow();
        const res = await fetch(
          `${API}/sales/history?from=${from}&to=${to}`,
          { headers: authHeaders() }
        );
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const items = data.items || [];
        if (!items.length) {
          box.innerHTML = '<div class="empty">Нет продаж за период</div>';
          return;
        }
        box.innerHTML = items.map(s => `
          <div class="row">
            <div class="row-body">
              <div class="row-title">${esc(s.full_name)}</div>
              <div class="row-sub">${String(s.sale_date).slice(0, 10)} · ${esc(s.store_name)}
                · SIM ${s.sim || 0} · MNP ${s.mnp || 0} · ПА ${s.pa || 0}</div>
            </div>
          </div>
        `).join('');
      } catch {
        box.innerHTML = '<div class="empty">Нужна привязка Telegram</div>';
      }
    }

    function cellTone(pct) {
      if (pct >= 100) return 'background:#34c75933;color:#34c759';
      if (pct >= 70) return 'background:#ffd96644;color:#e6b800';
      if (pct > 0) return 'background:#ff3b3033;color:#ff453a';
      return '';
    }

    async function loadMonthPlans() {
      const box = document.getElementById('monthPlanList');
      const meta = document.getElementById('monthPlanMeta');
      const label = document.getElementById('planMonthLabel');
      if (!planMonth) planMonth = todayMoscow().slice(0, 7);
      if (label) label.textContent = monthLabel(planMonth);
      if (box) box.innerHTML = '<div class="skeleton"></div>';
      try {
        const res = await fetch(API + '/plans/employees/month?month=' + planMonth, { headers: authHeaders() });
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
        if (tf) {
          html += `<div class="mt-card" style="margin:0 12px 16px;border-color:var(--primary)">
            <div class="mt-name" style="margin-bottom:10px">Итого сеть · ${planMonth}</div>
            <div class="mt-grid">${MAIN.map(m => cell(m, tf, {})).join('')}</div>
            <div class="mt-more">
              <button type="button" class="mt-toggle" onclick="toggleMonthExtra('mpx-tot', this)">Ещё метрики ▾</button>
              <div class="mt-extra" id="mpx-tot">${EXTRA.map(m => cell(m, tf, {})).join('')}</div>
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

    function toggleMonthExtra(id, btn) {
      const el = document.getElementById(id);
      if (!el) return;
      const open = el.classList.toggle('open');
      if (btn) btn.textContent = open ? 'Свернуть ▴' : 'Ещё метрики ▾';
    }




    async function loadStoreDailyPlans() {
      const box = document.getElementById('storeDailyPlans');
      if (!box) return;
      try {
        const res = await fetch(API + '/plans/stores/daily', { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        const stores = data.stores || [];
        if (!stores.length) {
          box.innerHTML = '<div class="empty">Нет данных</div>';
          return;
        }
        box.innerHTML = stores.map(st => {
          const col = storeColor(st.store_id, st);
          const p = st.plan || {};
          const chips = METRICS.slice(0, 8).map(m =>
            `<div class="stat-chip"><div class="n">${p[m.id] || 0}</div><div class="l">${m.label}</div></div>`
          ).join('');
          return `
            <div class="store-card" style="border-left:4px solid ${col};margin:8px 12px">
              <div class="store-head" style="cursor:default">
                <div class="store-badge" style="background:${col}33;color:${col}">${Math.round((st.share || st.plan_share || 0) * 100)}%</div>
                <div class="store-meta">
                  <div class="store-name">${st.name}</div>
                  <div class="store-code">${st.code || ''} · дневной план</div>
                </div>
              </div>
              <div class="stats-row" style="padding:0 12px 12px">${chips}</div>
            </div>`;
        }).join('') +
        (canManage()
          ? `<div style="padding:8px 12px 16px"><button class="btn-main" onclick="materializeDailyPlans()">Записать дневные планы в БД</button></div>`
          : '');
      } catch {
        box.innerHTML = '<div class="empty">Дневные планы точек пока недоступны</div>';
      }
    }

    async function materializeDailyPlans() {
      const res = await fetch(API + '/plans/stores/daily/materialize', {
        method: 'POST',
        headers: authHeaders(true),
        body: '{}'
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Дневные планы записаны', 'ok');
      loadStoreDailyPlans();
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

        async function loadSupport() {
      const box = document.getElementById('faqList');
      try {
        const res = await fetch(API + '/support/faq', { headers: authHeaders() });
        const list = res.ok ? await res.json() : [];
        if (!list.length) {
          box.innerHTML = '<div class="empty">FAQ пока пуст</div>';
        } else {
          box.innerHTML = list.map(f => `
            <button class="row" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">
              <div class="row-body"><div class="row-title">${f.question}</div></div>
              <div class="row-chevron">›</div>
            </button>
            <div class="empty" style="display:none;text-align:left;padding:0 16px 14px;color:var(--text-secondary)">${f.answer}</div>
          `).join('');
        }
      } catch {
        box.innerHTML = '<div class="empty">Не удалось загрузить FAQ</div>';
      }

      // мой чат / последние тикеты
      const chat = document.getElementById('supportChat');
      if (chat) {
        try {
          const r = await fetch(API + '/support/my', { headers: authHeaders() });
          if (r.ok) {
            const tickets = await r.json();
            if (!tickets.length) {
              chat.innerHTML = '<div class="empty" style="padding:8px 0">Пока нет обращений</div>';
            } else {
              chat.innerHTML = tickets.slice(0, 8).map(tk => `
                <div class="progress-block" style="margin-bottom:8px;padding:10px 12px">
                  <div style="font-size:12px;color:var(--hint)">#${tk.id} · ${tk.status || ''}</div>
                  <div style="font-size:14px;margin:4px 0">${esc(tk.message || '')}</div>
                  ${tk.admin_reply ? `<div style="font-size:13px;color:var(--primary);margin-top:6px">↩ ${esc(tk.admin_reply)}</div>` : ''}
                </div>
              `).join('');
            }
          }
        } catch (_) {}
      }

      const adm = document.getElementById('adminTicketsSection');
      if (adm && canAdmin()) {
        adm.style.display = '';
        try {
          const r = await fetch(API + '/support/tickets', { headers: authHeaders() });
          const list = r.ok ? await r.json() : [];
          const box2 = document.getElementById('adminTicketsList');
          if (!list.length) box2.innerHTML = '<div class="empty">Нет тикетов</div>';
          else box2.innerHTML = list.map(tk => `
            <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
              <div class="row-title">#${tk.id} ${esc(tk.full_name || '')}</div>
              <div class="row-sub">${esc(tk.message || '')}</div>
              <button class="btn-main" style="margin-top:4px" onclick="replyTicketPrompt(${tk.id})">Ответить</button>
            </div>
          `).join('');
        } catch (_) {}
      } else if (adm) {
        adm.style.display = 'none';
      }
    }

    // Поддержка (раздел «Поддержка», простой prompt()). Раньше называлась
    // так же, как replyTicket ниже — из-за этого вообще не работала:
    // JS хостит function-декларации, и вторая, более поздняя, тихо
    // перетирала первую в глобальной области.
    async function replyTicketPrompt(id) {
      if (!canAdmin()) { toast('Только admin', 'err'); return; }
      const text = prompt('Ответ на тикет #' + id);
      if (!text) return;
      const res = await fetch(API + '/support/tickets/' + id + '/reply', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ reply: text })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Ответ отправлен', 'ok');
      loadSupport();
    }

    async function sendSupport() {
      const message = document.getElementById('supportMsg').value.trim();
      if (!message) { toast('Введите сообщение', 'err'); return; }
      try {
        const res = await fetch(API + '/support', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            message,
            telegram_id: tgUser()?.id,
            full_name: me?.full_name || tgUser()?.first_name || 'Гость'
          })
        });
        const data = await res.json();
        const el = document.getElementById('supportResult');
        el.style.display = 'block';
        el.textContent = data.auto_reply || data.message || 'Отправлено';
        document.getElementById('supportMsg').value = '';
        toast('Отправлено', 'ok');
      } catch {
        toast('Ошибка отправки', 'err');
      }
    }

    function openAddEmployee() {
      if (!canManage()) return;
      document.getElementById('modalTitle').textContent = 'Новый сотрудник';
      document.getElementById('modalBody').innerHTML = `
        <div class="field"><label>ФИО</label><input id="ne_name" placeholder="Иванов Иван Иванович"></div>
        <div class="field"><label>Роль</label>
          <select id="ne_role">
            <option value="employee">employee</option>
            <option value="manager">manager</option>
          </select>
        </div>
        <button class="btn-main" onclick="saveNewEmployee()">Создать</button>
      `;
      document.getElementById('overlay').classList.add('show');
    }

    async function saveNewEmployee() {
      const full_name = document.getElementById('ne_name').value.trim();
      const role = document.getElementById('ne_role').value;
      if (!full_name) { toast('Укажите ФИО', 'err'); return; }
      const res = await fetch(API + '/employees', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ full_name, role })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Сотрудник добавлен', 'ok');
      closeModal();
      loadTeam();
    }

    function openAddStore() {
      if (!canManage()) return;
      document.getElementById('modalTitle').textContent = 'Новая точка';
      document.getElementById('modalBody').innerHTML = `
        <div class="field"><label>ID (латиница)</label><input id="ns_id" placeholder="lenina15"></div>
        <div class="field"><label>Название</label><input id="ns_name" placeholder="Ленина 15"></div>
        <div class="field"><label>Код</label><input id="ns_code" placeholder="123456"></div>
        <div class="field"><label>Цвет</label><input id="ns_color" value="#6d9eeb"></div>
        <button class="btn-main" onclick="saveNewStore()">Создать</button>
      `;
      document.getElementById('overlay').classList.add('show');
    }

    async function saveNewStore() {
      const id = document.getElementById('ns_id').value.trim();
      const name = document.getElementById('ns_name').value.trim();
      const code = document.getElementById('ns_code').value.trim();
      const color = document.getElementById('ns_color').value.trim();
      if (!id || !name) { toast('ID и название обязательны', 'err'); return; }
      const res = await fetch(API + '/stores', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ id, name, code, color })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Точка создана', 'ok');
      closeModal();
      stores = [];
    }

    async function setRole(id, role) {
      if (!canManage()) return;
      const res = await fetch(API + '/employees/' + id, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ role })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Роль: ' + role, 'ok');
      loadTeam();
    }

    async function removeEmployee(id) {
      if (!canManage()) return;
      if (!confirm('Деактивировать сотрудника?')) return;
      const res = await fetch(API + '/employees/' + id, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Удалён', 'ok');
      loadTeam();
    }

    async function zeroSaleMetric(saleId, metric, label, employeeId) {
      if (!canManage()) return;
      if (!confirm(`Убрать «${label}» из продаж сегодня?`)) return;
      try {
        const res = await fetch(API + '/sales/' + saleId + '/zero', {
          method: 'PUT',
          headers: authHeaders(true),
          body: JSON.stringify({ metric })
        });
        if (!res.ok) { toast('Ошибка', 'err'); return; }
        toast('Исправлено', 'ok');
        openEmployeeCard(employeeId);
      } catch (e) {
        toast('Ошибка', 'err');
      }
    }

    function mondayOf(d) {
      const x = new Date(d + 'T12:00:00');
      const day = x.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      x.setDate(x.getDate() + diff);
      return x.toISOString().slice(0, 10);
    }

    async function copyScheduleWeek() {
      if (!canManage()) return;
      const from = mondayOf(todayMoscow());
      const toD = new Date(from + 'T12:00:00');
      toD.setDate(toD.getDate() + 7);
      const to = toD.toISOString().slice(0, 10);
      if (!confirm(`Скопировать график ${from} → неделя с ${to}?`)) return;
      const res = await fetch(API + '/schedules/copy-week', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ from_monday: from, to_monday: to })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      const data = await res.json();
      toast('Скопировано смен: ' + (data.copied || 0), 'ok');
    }

    async function loadManagerTickets() {
      if (!canManage()) return;
      const box = document.getElementById('ticketsBox');
      box.innerHTML = '<div class="section"><div class="section-title">Тикеты</div><div class="skeleton"></div></div>';
      try {
        const res = await fetch(API + '/support/tickets', { headers: authHeaders() });
        if (!res.ok) throw new Error('fail');
        const list = await res.json();
        const open = (list || []).filter(t => t.status !== 'closed');
        box.innerHTML = `<div class="section"><div class="section-title">Тикеты (${open.length})</div>` +
          (open.length ? open.map(t => `
            <div class="progress-block" style="margin:8px 12px">
              <div class="row-title">#${t.id} · ${esc(t.full_name || 'Гость')} · ${t.status}</div>
              <div class="row-sub" style="margin:6px 0">${esc(t.message)}</div>
              ${t.admin_reply ? `<div class="empty" style="text-align:left">Ответ: ${esc(t.admin_reply)}</div>` : `
              <div class="field"><input id="treply_${t.id}" placeholder="Ответ сотруднику"></div>
              <button class="btn-main" onclick="replyTicket(${t.id})">Ответить в личку</button>`}
            </div>`).join('') : '<div class="empty">Нет открытых</div>') + '</div>';
      } catch {
        box.innerHTML = '<div class="empty">Не удалось загрузить тикеты</div>';
      }
    }

    async function replyTicket(id) {
      const text = document.getElementById('treply_' + id)?.value?.trim();
      if (!text) { toast('Введите ответ', 'err'); return; }
      const res = await fetch(API + '/support/tickets/' + id + '/reply', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ reply: text })
      });
      if (!res.ok) { toast('Ошибка', 'err'); return; }
      toast('Ответ отправлен', 'ok');
      loadManagerTickets();
    }

    async function exportCSV(type) {
      if (!canManage()) { toast('Только управляющий', 'err'); return; }
      const month = todayMoscow().slice(0, 7);
      const from = month + '-01';
      const to = todayMoscow();
      let path = '';
      if (type === 'sales') path = `/export/sales.csv?from=${from}&to=${to}`;
      if (type === 'bfq') path = `/export/bfq.csv?month=${month}`;
      if (type === 'schedules') path = `/export/schedules.csv?month=${month}`;
      try {
        const res = await fetch(API + path, { headers: authHeaders() });
        if (!res.ok) { toast('Ошибка экспорта', 'err'); return; }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = type + '_' + month + '.csv';
        a.click();
        toast('Скачано', 'ok');
      } catch {
        toast('Ошибка', 'err');
      }
    }

