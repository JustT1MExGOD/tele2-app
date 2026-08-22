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
        const orgs = await window.apiClient.getOrgsAdmin(authHeaders());
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
      // Пикеры точек кэшируют список на window.__stores/stores — без сброса
      // после смены сети admin продолжил бы видеть точки прошлой сети.
      window.__stores = null;
      stores = [];
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
      const netBtn = document.getElementById('btnNetworks');
      if (netBtn) netBtn.style.display = canAdmin() ? '' : 'none';
      const auditBtn = document.getElementById('btnAudit');
      if (auditBtn) auditBtn.style.display = canAdmin() ? '' : 'none';
      renderOrgSwitcher();
      try {
        const orgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
        const [emps, sales] = await Promise.all([
          window.apiClient.getEmployees(authHeaders(), orgParam),
          window.apiClient.getSales(authHeaders(), todayMoscow(), orgQueryParam())
        ]);
        employees = emps;
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
          const roleBadge = e.role && e.role !== 'employee' && e.role !== 'trainee' ? ' · <svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /> </svg>' : '';
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
                <div class="team-avatar${st.active ? ' active' : ''}" id="ta-${e.id}">${initial}</div>
                <div class="row-body">
                  <div class="row-title">${esc(e.full_name)}${roleBadge}</div>
                  <div class="row-sub">SIM ${st.sim} · Комбо ${st.combo} · Тел ${st.phones} · ${roleLabel(e.role)}</div>
                </div>
                <div class="row-chevron">›</div>
              </button>
              ${adminBtns}
            </div>`;
        }).join('') || '<div class="empty">🍉 В команде пока никого нет</div>';
        list.forEach(e => applyAvatarImg('ta-' + e.id, e.id));
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
        const [emps, sales, schedules] = await Promise.all([
          window.apiClient.getEmployees(authHeaders(), orgParam),
          window.apiClient.getSales(authHeaders(), todayMoscow(), orgQueryParam()),
          window.apiClient.getSchedules(authHeaders(), todayMoscow(), orgQueryParam())
        ]);
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
          ${typeof canViewAnalytics === 'function' && canViewAnalytics()
            ? `<button class="btn-ghost" style="width:100%;margin-bottom:12px" onclick="closeModal();openEmployeeProfile(${id})">Профиль →</button>`
            : ''}
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
        const zeroOrgParam = me?.role === 'admin' && adminViewOrgId ? '&org_id=' + encodeURIComponent(adminViewOrgId) : '';
        await window.apiClient.zeroSaleMetric(authHeaders(true), saleId, zeroOrgParam, metric);
        toast('Исправлено', 'ok');
        openEmployeeCard(employeeId);
      } catch (e) {
        toast('Ошибка', 'err');
      }
    }

    async function setRole(id, role) {
      if (!canManage()) return;
      try {
        await window.apiClient.setEmployeeRole(authHeaders(true), id, role);
      } catch (e) {
        toast(e.message || 'Ошибка', 'err');
        return;
      }
      toast('Роль: ' + roleLabel(role), 'ok');
      loadTeam();
    }

    async function removeEmployee(id) {
      if (!canManage()) return;
      if (!confirm('Деактивировать сотрудника?')) return;
      try {
        await window.apiClient.deactivateEmployee(authHeaders(), id);
      } catch (e) {
        toast('Ошибка', 'err');
        return;
      }
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
      try {
        await window.apiClient.createEmployee(authHeaders(true), body);
      } catch (e) {
        toast('Ошибка', 'err');
        return;
      }
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
        <div class="field"><label>Часы работы (например 10-21)</label><input id="ns_work_time" value="10-21"></div>
        <div class="field"><label>Часов в смене</label><input id="ns_hours" type="number" value="11"></div>
        <div class="field"><label>Время итога дня</label><input id="ns_close_time" value="21:00"></div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input id="ns_24h" type="checkbox" onchange="toggle24hStore()">
          <label for="ns_24h" style="margin:0">Круглосуточно</label>
        </div>
        <button class="btn-main" onclick="saveNewStore()">Создать</button>
      `;
      document.getElementById('overlay').classList.add('show');
    }

    function toggle24hStore() {
      const on = document.getElementById('ns_24h').checked;
      const wt = document.getElementById('ns_work_time');
      const hrs = document.getElementById('ns_hours');
      wt.value = on ? 'круглосуточно' : '10-21';
      hrs.value = on ? 24 : 11;
      wt.disabled = on;
      hrs.disabled = on;
    }

    async function saveNewStore() {
      const id = document.getElementById('ns_id').value.trim();
      const name = document.getElementById('ns_name').value.trim();
      const code = document.getElementById('ns_code').value.trim();
      const color = document.getElementById('ns_color').value.trim();
      const work_time = document.getElementById('ns_work_time').value.trim();
      const hours = Number(document.getElementById('ns_hours').value) || 11;
      const close_time = document.getElementById('ns_close_time').value.trim();
      if (!id || !name) { toast('ID и название обязательны', 'err'); return; }
      const body = {
        id, name, code, color,
        work_time: work_time || undefined,
        hours,
        close_time_weekday: close_time || undefined,
        close_time_sunday: close_time || undefined
      };
      if (me?.role === 'admin' && adminViewOrgId) body.org_id = adminViewOrgId;
      try {
        await window.apiClient.createStore(authHeaders(true), body);
      } catch (e) {
        toast('Ошибка', 'err');
        return;
      }
      toast('Точка создана', 'ok');
      closeModal();
      stores = [];
      window.__stores = null;
    }
