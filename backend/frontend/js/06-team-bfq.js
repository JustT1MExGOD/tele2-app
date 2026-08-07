/* 06-team-bfq.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   Команда: список, роли, добавление/удаление сотрудников и точек.
   BFQ, планы (месяц/день) и поддержка/тикеты вынесены в 06b-plans-bfq.js / 06c-support-tickets.js. */
    // ===== TEAM =====
    // Переключатель сети — только у admin (видит по умолчанию свою рабочую
    // сеть, «Команда» больше не мешает всех сотрудников всех сетей в кучу).
    async function renderOrgSwitcher() {
      const sw = document.getElementById('orgSwitcher');
      if (!sw) return;
      if (me?.role !== 'admin') { sw.style.display = 'none'; return; }
      sw.style.display = 'block';
      if (sw.dataset.loaded) return;
      try {
        const res = await fetch(API + '/orgs', { headers: authHeaders() });
        const orgs = await res.json();
        const current = adminViewOrgId || me.org_id;
        sw.innerHTML = `<div class="field"><label>Сеть</label>
          <select onchange="switchAdminOrg(this.value)">
            ${(Array.isArray(orgs) ? orgs : []).map((o) => `<option value="${o.id}"${o.id === current ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </div>`;
        sw.dataset.loaded = '1';
      } catch (_) {}
    }

    function switchAdminOrg(orgId) {
      adminViewOrgId = orgId;
      loadTeam();
    }

    async function loadTeam() {
      const box = document.getElementById('teamList');
      box.innerHTML = '<div class="skeleton"></div>';
      const tools = document.getElementById('managerTools');
      if (tools) tools.style.display = canManage() ? 'block' : 'none';
      // Тикеты поддержки на бэке намеренно только admin (эскалация к
      // разработчику/платформе, не менеджерский инбокс сети) — кнопка
      // раньше показывалась всем manager/senior и падала на 403.
      const ticketsBtn = document.getElementById('btnSupportTickets');
      if (ticketsBtn) ticketsBtn.style.display = canAdmin() ? '' : 'none';
      renderOrgSwitcher();
      try {
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const [empRes, salesRes] = await Promise.all([
          fetch(API + '/employees' + orgParam, { headers: authHeaders() }),
          fetch(API + '/sales?date=' + todayMoscow() + orgQueryParam(), { headers: authHeaders() })
        ]);
        employees = await empRes.json();
        const sales = await salesRes.json();
        const map = {};
        (Array.isArray(sales) ? sales : []).forEach(s => {
          if (!map[s.employee_id]) map[s.employee_id] = { sim: 0, phones: 0, combo: 0, active: false };
          map[s.employee_id].sim += +s.sim || 0;
          map[s.employee_id].phones += +s.phones || 0;
          map[s.employee_id].combo += +s.combo || 0;
          map[s.employee_id].active = true;
        });
        const list = Array.isArray(employees) ? employees : [];
        const myAssignable = canManage() ? assignableRoles(me?.role) : [];
        box.innerHTML = list.map(e => {
          const st = map[e.id] || { sim: 0, phones: 0, combo: 0, active: false };
          const roleBadge = e.role && e.role !== 'employee' && e.role !== 'trainee' ? ' · ⭐' : '';
          const initial = (e.full_name || '?').trim().charAt(0).toUpperCase();
          // Роли ниже моей и отличные от текущей роли сотрудника — нет смысла предлагать ту же самую.
          const roleBtns = myAssignable.filter((r) => r !== e.role);
          const adminBtns = canManage()
            ? `<div style="display:flex;gap:6px;padding:0 16px 10px;flex-wrap:wrap">
                ${roleBtns.map((r) => `<button class="mchip" onclick="event.stopPropagation();setRole(${e.id},'${r}')">${roleLabel(r)}</button>`).join('')}
                <button class="mchip" style="color:var(--danger)" onclick="event.stopPropagation();removeEmployee(${e.id})">Удалить</button>
              </div>`
            : '';
          return `
            <div>
              <button class="row" onclick="openEmployeeCard(${e.id})">
                <div class="team-avatar${st.active ? ' active' : ''}">${initial}</div>
                <div class="row-body">
                  <div class="row-title">${esc(e.full_name)}${roleBadge}</div>
                  <div class="row-sub">SIM ${st.sim} · Комбо ${st.combo} · Тел ${st.phones} · ${roleLabel(e.role)}</div>
                </div>
                <div class="row-chevron">›</div>
              </button>
              ${adminBtns}
            </div>`;
        }).join('') || '<div class="empty">🍉 В команде пока никого нет</div>';
      } catch {
        box.innerHTML = '<div class="empty">🍉 Не получилось загрузить команду, зайди чуть позже</div>';
      }
    }

    // ===== Employee card =====
    async function openEmployeeCard(id) {
      document.getElementById('modalTitle').textContent = 'Сотрудник';
      document.getElementById('modalBody').innerHTML = '<div class="empty">Загрузка…</div>';
      document.getElementById('overlay').classList.add('show');

      try {
        // Карточка сотрудника открывается и при просмотре чужой сети
        // (переключатель у admin) — без org_id все три запроса тихо
        // резолвились в СВОЮ сеть admin'а, а не в ту, что он смотрит.
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const [empRes, salesRes, schRes] = await Promise.all([
          fetch(API + '/employees' + orgParam, { headers: authHeaders() }),
          fetch(API + '/sales?date=' + todayMoscow() + orgQueryParam(), { headers: authHeaders() }),
          fetch(API + '/schedules?date=' + todayMoscow() + orgQueryParam(), { headers: authHeaders() })
        ]);
        const emps = await empRes.json();
        const sales = await salesRes.json();
        const schedules = await schRes.json();
        const emp = (emps || []).find(e => String(e.id) === String(id));
        const sale = (sales || []).find(s => String(s.employee_id) === String(id));
        const sch = (schedules || []).find(s => String(s.employee_id) === String(id));

        const saleMetrics = ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'wink', 'shpd'];
        // manager/admin может отменить ошибочно внесённую метрику за сегодня —
        // sales аддитивные, отдельной "продажи" для удаления нет, поэтому это
        // обнуление конкретного показателя, не всей записи за день.
        const nonZero = sale ? saleMetrics.filter(key => Number(sale[key]) > 0) : [];
        const correctionBlock = (canManage() && sale && nonZero.length)
          ? `<div class="block-label">Исправить ошибочный ввод</div>
             <div class="progress-block" style="display:flex;flex-direction:column;gap:8px">
               ${nonZero.map(key => `
                 <div style="display:flex;justify-content:space-between;align-items:center">
                   <span style="font-size:14px">${metricLabel(key)}: <b>${Number(sale[key])}</b></span>
                   <button class="mchip" style="color:var(--danger)" onclick="zeroSaleMetric(${sale.id},'${key}',${id})">Удалить</button>
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
            ${saleMetrics.map(key => progressHTML(metricLabel(key), sale?.[key], 0)).join('')}
          </div>
          ${correctionBlock}
          <button class="btn-main" onclick="openAddSale(${id})">Добавить продажу</button>
        `;
      } catch (e) {
        document.getElementById('modalBody').innerHTML = '<div class="empty">Ошибка</div>';
      }
    }

    async function zeroSaleMetric(saleId, metric, employeeId) {
      if (!canManage()) return;
      if (!confirm(`Убрать «${metricLabel(metric)}» из продаж сегодня?`)) return;
      try {
        const zeroOrgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const res = await fetch(API + '/sales/' + saleId + '/zero' + zeroOrgParam, {
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

    async function setRole(id, role) {
      if (!canManage()) return;
      const res = await fetch(API + '/employees/' + id + '/role', {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ role })
      });
      if (!res.ok) { toast(res.status === 403 ? 'Можно назначать только роли ниже своей' : 'Ошибка', 'err'); return; }
      toast('Роль: ' + roleLabel(role), 'ok');
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

    function openAddEmployee() {
      if (!canManage()) return;
      const roles = assignableRoles(me?.role);
      const options = (roles.length ? roles : ['employee'])
        .map((r) => `<option value="${r}"${r === 'employee' ? ' selected' : ''}>${roleLabel(r)}</option>`)
        .join('');
      document.getElementById('modalTitle').textContent = 'Новый сотрудник';
      document.getElementById('modalBody').innerHTML = `
        <div class="field"><label>ФИО</label><input id="ne_name" placeholder="Иванов Иван Иванович"></div>
        <div class="field"><label>Роль</label>
          <select id="ne_role">${options}</select>
        </div>
        <button class="btn-main" onclick="saveNewEmployee()">Создать</button>
      `;
      document.getElementById('overlay').classList.add('show');
    }

    async function saveNewEmployee() {
      const full_name = document.getElementById('ne_name').value.trim();
      const role = document.getElementById('ne_role').value;
      if (!full_name) { toast('Укажите ФИО', 'err'); return; }
      const body = { full_name, role };
      if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
      const res = await fetch(API + '/employees', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body)
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
