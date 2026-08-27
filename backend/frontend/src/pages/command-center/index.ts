/**
 * 21.x (Frontend rewrite continuation, batch of 11) — replacing
 * frontend/js/14-command-center.js file-for-file. window.__taskClientId
 * (legacy classic-script workaround for sharing state between
 * openCreateTaskModal/submitCreateTask) — nothing outside this file ever
 * read it, replaced with a private module variable, same precedent as
 * __storeProfileDisplayName (20.27.0).
 */
import type { CommandCenterAction, CommandCenterResponse, EmployeeListItem } from '../../../../src/shared/api-types.js';

let taskClientId = '';

export async function loadCommandCenterPage(): Promise<void> {
  const box = document.getElementById('ccPageBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d: CommandCenterResponse = await window.apiClient.getCommandCenter(authHeaders(), orgQueryParam());

    const health = Number(d.network?.health) || 0;
    const tone = commandCenterTone(health);
    const pace = Number((d.network as any)?.pace_delta) || 0;
    const paceText = (pace >= 0 ? '+' : '') + pace + '% к темпу дня';
    const problems = Array.isArray(d.problems) ? d.problems : [];
    const stores = Array.isArray(d.stores) ? (d.stores as any[]) : [];

    box.innerHTML = `
      <div class="section">
        <div class="section-title">Что происходит</div>
        <div class="cc-row" style="padding:0 16px">
          <div class="cc-health ${tone}">${health}</div>
          <div class="cc-meta">
            <div class="cc-line"><b>${(d.network as any)?.overall_pct || 0}%</b> план дня · ${(d.network as any)?.staff_on_shift || 0} на смене · ${(d.network as any)?.stores_count || 0} точек</div>
            <div class="cc-line cc-${pace >= 0 ? 'up' : 'down'}">${paceText}</div>
          </div>
        </div>
        <div class="workspace-grid" style="padding:10px 16px 0">
          ${
            stores
              .map(
                (st) => `
            <div class="progress-block" style="margin-bottom:8px;border-left:4px solid ${st.color || '#2AABEE'}">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>${esc(st.name)}</strong>
                <span style="font-weight:700">${st.today?.overall ?? 0}%</span>
              </div>
              <div style="font-size:12px;color:var(--hint);margin-top:4px">
                ${st.staff_count || 0} на смене · SIM ${st.today?.sim || 0}/${st.today?.plan_sim || 0} · MNP ${st.today?.mnp || 0}/${st.today?.plan_mnp || 0}
              </div>
            </div>`
              )
              .join('') || '<div class="empty">Нет точек в сети</div>'
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Где проблема ${problems.length ? `(${problems.length})` : ''}</div>
        <div class="workspace-grid" style="padding:0 16px 16px">
          ${
            problems.length
              ? problems
                  .map(
                    (p) => `
            <div class="sv-drop ${p.severity === 'critical' ? '' : 'warn'}" style="margin:8px 0 0">
              <div class="ico">${p.severity === 'critical' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M7 18v-6a5 5 0 1 1 10 0v6" /> <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" /> <path d="M21 12h1" /> <path d="M18.5 4.5 18 5" /> <path d="M2 12h1" /> <path d="M12 2v1" /> <path d="m4.929 4.929.707.707" /> <path d="M12 12v6" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /> </svg>'}</div>
              <div style="flex:1">
                <div class="t">${esc(p.store_name || 'Точка')}</div>
                <div class="s">${esc(p.message || '')}</div>
                ${p.ai_comment ? `<div class="s" style="margin-top:4px;font-style:italic"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" /> </svg> ${esc(p.ai_comment)}</div>` : ''}
                <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                  ${(p.actions || []).map((a) => ccActionButton(a)).join('')}
                  ${p.alert_id ? `<button class="mchip" onclick="ccAckAlert(${p.alert_id})">Взять в работу</button>` : ''}
                </div>
              </div>
            </div>`
                  )
                  .join('')
              : '<div class="empty" style="padding:10px 0 0">Проблем нет — сеть в ритме</div>'
          }
        </div>
      </div>

      ${
        canAdmin() || (typeof me !== 'undefined' && me?.role === 'supervisor')
          ? `
        <div class="section">
          <button class="row" onclick="enterSupervisorShell()">
            <div class="row-icon"><svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M18 17V9" /> <path d="M13 17V5" /> <path d="M8 17v-3" /> </svg></div>
            <div class="row-body">
              <div class="row-title">Полная аналитика сектора</div>
              <div class="row-sub">Тренд · топ продавцов · разбивка по точкам</div>
            </div>
            <div class="row-chevron">›</div>
          </button>
        </div>`
          : ''
      }
    `;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Command Center сейчас недоступен, зайди чуть позже</div>';
  }
}

export async function ccAckAlert(alertId: number): Promise<void> {
  try {
    await window.apiClient.changeAlertStatus(authHeaders(true), alertId, { status: 'in_progress' });
    toast('Взято в работу', 'ok');
    loadCommandCenterPage();
  } catch (e) {
    toast('Не удалось обновить алерт', 'err');
  }
}

export function ccActionButton(action: CommandCenterAction): string {
  if (action.type === 'open_employee') {
    return `<button class="mchip" onclick="openEmployeeProfile(${action.id})">Открыть сотрудника</button>`;
  }
  if (action.type === 'open_store') {
    return `<button class="mchip" onclick="openStoreProfile('${action.id}')">Открыть точку</button>`;
  }
  if (action.type === 'create_task') {
    const ctx = JSON.stringify({
      store_id: action.store_id || null,
      employee_id: action.employee_id || null,
      alert_id: action.alert_id || null,
      title: action.message || ''
    }).replace(/"/g, '&quot;');
    return `<button class="mchip" onclick='openCreateTaskModal(${ctx})'>Создать задачу</button>`;
  }
  return '';
}

interface CreateTaskCtx {
  store_id?: string | null;
  employee_id?: number | null;
  alert_id?: number | null;
  title?: string;
}

export async function openCreateTaskModal(ctx: CreateTaskCtx): Promise<void> {
  ctx = ctx || {};
  const empParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
  let employees: EmployeeListItem[] = [];
  try {
    employees = await window.apiClient.getEmployees(authHeaders(), empParam);
  } catch (_) {}

  // Один client_id на всю сессию формы — тот же приём, что у submitSale()
  // (07-add-sale.js): сетевой ретрай после потерянного ответа или повторный
  // тап "Создать" до дизейбла кнопки дедупятся бэкендом вместо второй
  // задачи + второго уведомления в Telegram.
  taskClientId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();

  const title = document.getElementById('modalTitle');
  if (title) title.textContent = 'Новая задача';
  const body = document.getElementById('modalBody');
  if (body) {
    body.innerHTML = `
    <div class="field">
      <label>Что сделать</label>
      <input type="text" id="taskTitle" value="${esc(ctx.title || '')}" placeholder="Например: проверить остатки после 18:00">
    </div>
    <div class="field">
      <label>Кому</label>
      <select id="taskAssignee">
        ${(employees || [])
          .map((e) => `<option value="${e.id}" ${String(e.id) === String(ctx.employee_id) ? 'selected' : ''}>${esc(e.full_name)}</option>`)
          .join('')}
      </select>
    </div>
    <div class="field">
      <label>Приоритет</label>
      <select id="taskPriority">
        <option value="normal" selected>Обычный</option>
        <option value="high">Высокий</option>
        <option value="urgent">Срочно</option>
        <option value="low">Низкий</option>
      </select>
    </div>
    <div class="field">
      <label>Дедлайн (необязательно)</label>
      <input type="datetime-local" id="taskDueAt">
    </div>
    <button class="btn-main" id="taskSubmitBtn" onclick="submitCreateTask(${JSON.stringify({
      store_id: ctx.store_id || null,
      alert_id: ctx.alert_id || null
    }).replace(/"/g, '&quot;')})">Создать</button>
  `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

interface SubmitTaskCtx {
  store_id?: string | null;
  alert_id?: number | null;
}

export async function submitCreateTask(ctx: SubmitTaskCtx): Promise<void> {
  const btn = document.getElementById('taskSubmitBtn') as HTMLButtonElement | null;
  if (btn?.disabled) return;

  const title = (document.getElementById('taskTitle') as HTMLInputElement | null)?.value.trim();
  const assignedTo = (document.getElementById('taskAssignee') as HTMLSelectElement | null)?.value;
  if (!title || !assignedTo) {
    toast('Укажи, что сделать и кому', 'err');
    return;
  }
  if (btn) btn.disabled = true;

  const priority = (document.getElementById('taskPriority') as HTMLSelectElement | null)?.value;
  const dueAtRaw = (document.getElementById('taskDueAt') as HTMLInputElement | null)?.value;
  const payload: any = {
    title,
    assigned_to: Number(assignedTo),
    priority,
    store_id: ctx.store_id || undefined,
    alert_id: ctx.alert_id || undefined,
    due_at: dueAtRaw ? new Date(dueAtRaw).toISOString() : undefined,
    client_id: taskClientId
  };
  if (me?.role === 'admin' && adminViewOrgId) payload.org_id = adminViewOrgId;

  try {
    await window.apiClient.createTask(authHeaders(true), payload);
    closeModal();
    toast('Задача создана', 'ok');
    if (typeof page !== 'undefined' && page === 'command-center') loadCommandCenterPage();
  } catch (e: any) {
    toast(e?.message || 'Не удалось создать задачу', 'err');
    if (btn) btn.disabled = false;
  }
}

declare global {
  interface Window {
    loadCommandCenterPage: typeof loadCommandCenterPage;
    ccAckAlert: typeof ccAckAlert;
    openCreateTaskModal: typeof openCreateTaskModal;
    submitCreateTask: typeof submitCreateTask;
  }
}
window.loadCommandCenterPage = loadCommandCenterPage;
window.ccAckAlert = ccAckAlert;
window.openCreateTaskModal = openCreateTaskModal;
window.submitCreateTask = submitCreateTask;
