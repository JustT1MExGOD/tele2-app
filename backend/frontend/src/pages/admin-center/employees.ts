/**
 * Admin Control Center (20.59.0) — Employees tab: search-driven (no
 * bulk list route exists server-side, only GET /admin/search and
 * GET /admin/employees/:id — see src/api/routes/admin/search.ts) +
 * detail panel with safe actions.
 */
import { confirmDangerousAction, requestStepUpTicket } from './shared/dialogs.js';

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

export function renderEmployeesTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Сотрудники</div>
      <div style="padding:0 16px 8px">
        <input type="text" id="adminEmpSearchInput" placeholder="Поиск по имени (от 2 символов)" style="width:100%;box-sizing:border-box">
      </div>
      <div id="adminEmpSearchResults"></div>
    </div>
    <div id="adminEmpDetail"></div>
  `;

  const input = document.getElementById('adminEmpSearchInput') as HTMLInputElement | null;
  input?.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runEmployeeSearch(input.value), 250);
  });

  document.getElementById('adminEmpSearchResults')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-employee-id]');
    if (row?.dataset.employeeId) renderEmployeeDetail(Number(row.dataset.employeeId));
  });
}

async function runEmployeeSearch(term: string): Promise<void> {
  const box = document.getElementById('adminEmpSearchResults');
  if (!box) return;
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminSearch(authHeaders(), trimmed, orgQueryParam());
    if (!res.employees.length) {
      box.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = res.employees
      .map(
        (emp) => `
        <button class="row" type="button" data-employee-id="${emp.id}">
          <div class="row-body">
            <div class="row-title">${esc(emp.full_name)}</div>
            <div class="row-sub">${esc(roleLabel(emp.role))}</div>
          </div>
          <div class="row-chevron">›</div>
        </button>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Ошибка поиска</div>';
  }
}

async function renderEmployeeDetail(employeeId: number): Promise<void> {
  const box = document.getElementById('adminEmpDetail');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = await window.apiClient.adminGetEmployee(authHeaders(), employeeId);
    const emp = d.employee;
    const roles = assignableRoles(me.role);

    box.innerHTML = `
      <div class="section">
        <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span>${esc(emp.full_name)}</span>
          <span class="mchip" style="cursor:default">${esc(roleLabel(emp.role))}</span>
        </div>
        <div style="padding:0 16px 8px;color:var(--text-secondary,#8e8e93);font-size:13px">
          ${emp.is_active ? 'Активен' : 'Деактивирован'}${emp.access_status ? ' · ' + esc(emp.access_status) : ''}${emp.hire_date ? ' · нанят ' + esc(emp.hire_date) : ''}
        </div>
        <div style="padding:0 16px 12px;display:flex;gap:8px;flex-wrap:wrap">
          <select id="empRoleSelect">
            ${roles.map((r) => `<option value="${esc(r)}" ${r === emp.role ? 'selected' : ''}>${esc(roleLabel(r))}</option>`).join('')}
          </select>
          <button type="button" class="btn-ghost" id="empRoleApply">Сменить роль</button>
          ${emp.is_active
            ? `<button type="button" class="btn-ghost" id="empDeactivate">Деактивировать</button>`
            : `<button type="button" class="btn-ghost" id="empReactivate">Восстановить</button>`}
        </div>
      </div>
      <div class="section">
        <div class="section-title">Сессии</div>
        ${d.sessions.length
          ? d.sessions
              .map(
                (s) => `
          <div class="row" style="cursor:default">
            <div class="row-body">
              <div class="row-title">Сессия #${s.id}</div>
              <div class="row-sub">Последняя активность: ${esc(formatDateRu(s.last_seen_at?.slice(0, 10) || ''))}</div>
            </div>
            <button type="button" class="btn-ghost" data-revoke-session="${s.id}">Отозвать</button>
          </div>`
              )
              .join('')
          : '<div class="empty">Нет активных сессий</div>'}
        ${d.sessions.length ? '<div style="padding:8px 16px"><button type="button" class="btn-ghost" id="empRevokeAll">Отозвать все сессии</button></div>' : ''}
      </div>
      <div class="section">
        <div class="section-title">Безопасность</div>
        <div style="padding:0 16px 16px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn-ghost" id="empMfaReset">Сбросить MFA</button>
          <button type="button" class="btn-ghost" id="empPasswordReset">Сброс пароля</button>
        </div>
      </div>
    `;

    document.getElementById('empRoleApply')?.addEventListener('click', () => onChangeRole(employeeId, emp.role));
    document.getElementById('empDeactivate')?.addEventListener('click', () => onDeactivate(employeeId));
    document.getElementById('empReactivate')?.addEventListener('click', () => onReactivate(employeeId));
    document.getElementById('empRevokeAll')?.addEventListener('click', () => onRevokeAll(employeeId));
    document.getElementById('empMfaReset')?.addEventListener('click', () => onMfaReset(employeeId));
    document.getElementById('empPasswordReset')?.addEventListener('click', () => onPasswordReset(employeeId));
    box.querySelectorAll<HTMLElement>('[data-revoke-session]').forEach((btn) => {
      btn.addEventListener('click', () => onRevokeSession(employeeId, Number(btn.dataset.revokeSession)));
    });
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить сотрудника</div>';
  }
}

async function onChangeRole(employeeId: number, currentRole: string): Promise<void> {
  const select = document.getElementById('empRoleSelect') as HTMLSelectElement | null;
  const newRole = select?.value;
  if (!newRole || newRole === currentRole) return;
  try {
    let stepUpToken: string | undefined;
    if (isMfaMandatoryForRoleClient(newRole)) {
      const ticket = await requestStepUpTicket();
      if (!ticket) return;
      stepUpToken = ticket;
    }
    await window.apiClient.adminChangeEmployeeRole(authHeaders(true), employeeId, { role: newRole }, stepUpToken);
    toast('Роль изменена', 'ok');
    renderEmployeeDetail(employeeId);
  } catch (e: any) {
    if (e?.code === 'step_up_required') {
      const ticket = await requestStepUpTicket();
      if (!ticket) return;
      try {
        await window.apiClient.adminChangeEmployeeRole(authHeaders(true), employeeId, { role: newRole }, ticket);
        toast('Роль изменена', 'ok');
        renderEmployeeDetail(employeeId);
        return;
      } catch (_) {}
    }
    toast('Не удалось изменить роль', 'err');
  }
}

// Mirrors auth/guards.ts's MFA-mandatory role set at the level this UI
// cares about (admin/supervisor) — server re-validates independently;
// this only decides whether to proactively ask for a step-up ticket.
function isMfaMandatoryForRoleClient(role: string): boolean {
  return role === 'admin' || role === 'supervisor';
}

async function onDeactivate(employeeId: number): Promise<void> {
  const reason = await confirmDangerousAction({
    title: 'Деактивировать сотрудника',
    description: 'Сотрудник потеряет доступ к системе. Действие обратимо.'
  });
  if (reason === null) return;
  try {
    await window.apiClient.adminDeactivateEmployee(authHeaders(true), employeeId);
    toast('Сотрудник деактивирован', 'ok');
    renderEmployeeDetail(employeeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onReactivate(employeeId: number): Promise<void> {
  try {
    await window.apiClient.adminReactivateEmployee(authHeaders(true), employeeId);
    toast('Сотрудник восстановлен', 'ok');
    renderEmployeeDetail(employeeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onRevokeSession(employeeId: number, sessionId: number): Promise<void> {
  try {
    await window.apiClient.adminRevokeEmployeeSession(authHeaders(true), employeeId, sessionId);
    toast('Сессия отозвана', 'ok');
    renderEmployeeDetail(employeeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onRevokeAll(employeeId: number): Promise<void> {
  try {
    await window.apiClient.adminRevokeAllEmployeeSessions(authHeaders(true), employeeId);
    toast('Все сессии отозваны', 'ok');
    renderEmployeeDetail(employeeId);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onMfaReset(employeeId: number): Promise<void> {
  const ticket = await requestStepUpTicket();
  if (!ticket) return;
  try {
    await window.apiClient.adminResetEmployeeMfa(authHeaders(true), employeeId, ticket);
    toast('MFA сброшена', 'ok');
  } catch (e) {
    toast('Ошибка', 'err');
  }
}

async function onPasswordReset(employeeId: number): Promise<void> {
  try {
    const res = await window.apiClient.adminInitiatePasswordReset(authHeaders(true), employeeId);
    toast('Ссылка на сброс пароля создана', 'ok');
    console.info('password reset token issued', res.token);
  } catch (e) {
    toast('Ошибка', 'err');
  }
}
