/* 15-tasks.js — часть T2 Sales Mini App (см. index.html).
   Классический скрипт, общая глобальная область со всеми /js/*.js — порядок подключения важен.
   18.4: список задач сети для manager/supervisor/admin — вторая половина
   Tasks / Action System (создание — из Command Center, 14-command-center.js). */

let tasksFilter = 'active';

const TASK_STATUS_LABEL = {
  open: 'Открыта',
  in_progress: 'В работе',
  done: 'Выполнена',
  cancelled: 'Отменена'
};

function taskPriorityBadge(p) {
  const map = { urgent: '<span class="status-dot" style="background:var(--danger)"></span> Срочно', high: '<span class="status-dot" style="background:var(--warning)"></span> Высокий', normal: '', low: '<span class="status-dot" style="background:var(--border)"></span> Низкий' };
  return map[p] || '';
}

function setTasksFilter(f) {
  tasksFilter = f;
  loadTasksPage();
}

async function loadTasksPage() {
  const box = document.getElementById('tasksPageBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const all = await window.apiClient.getTasks(authHeaders(), orgQueryParam());
    const items = (all || []).filter(t => {
      if (tasksFilter === 'active') return t.status === 'open' || t.status === 'in_progress';
      if (tasksFilter === 'all') return true;
      return t.status === tasksFilter;
    });

    box.innerHTML = `
      <div class="quick" style="padding:0 16px 10px">
        <button class="${tasksFilter === 'active' ? 'active' : ''}" onclick="setTasksFilter('active')">Активные</button>
        <button class="${tasksFilter === 'done' ? 'active' : ''}" onclick="setTasksFilter('done')">Выполненные</button>
        <button class="${tasksFilter === 'all' ? 'active' : ''}" onclick="setTasksFilter('all')">Все</button>
      </div>
      <div style="padding:0 16px 16px">
        ${items.length ? items.map(t => `
          <button class="row" onclick="openTaskDetail(${t.id})">
            <div class="row-icon">${t.status === 'done' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 6 9 17l-5-5" /> </svg>' : t.status === 'cancelled' ? '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" /> </svg>' : '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg>'}</div>
            <div class="row-body">
              <div class="row-title">${esc(t.title)} ${taskPriorityBadge(t.priority)}</div>
              <div class="row-sub">${esc(t.assignee_name || '')}${t.store_name ? ' · ' + esc(t.store_name) : ''} · ${TASK_STATUS_LABEL[t.status] || t.status}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`).join('') : '<div class="empty">Нет задач</div>'}
      </div>`;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить задачи</div>';
  }
}

async function openTaskDetail(id) {
  document.getElementById('modalTitle').textContent = 'Задача';
  document.getElementById('modalBody').innerHTML = '<div class="skeleton"></div>';
  document.getElementById('overlay').classList.add('show');
  await renderTaskDetail(id);
}

async function renderTaskDetail(id) {
  const box = document.getElementById('modalBody');
  try {
    const { task: t, comments } = await window.apiClient.getTask(authHeaders(), id);

    const canManageTask = canManage() || (typeof me !== 'undefined' && me?.role === 'supervisor');
    const isAssignee = typeof me !== 'undefined' && String(me?.employee_id) === String(t.assigned_to);

    const nextButtons = [];
    if (isAssignee && t.status === 'open') nextButtons.push(['in_progress', 'Взять в работу']);
    if (isAssignee && (t.status === 'open' || t.status === 'in_progress')) nextButtons.push(['done', 'Отметить выполненной']);
    if (canManageTask && t.status !== 'cancelled') nextButtons.push(['cancelled', 'Отменить']);
    if (canManageTask && (t.status === 'done' || t.status === 'cancelled')) nextButtons.push(['open', 'Открыть заново']);

    box.innerHTML = `
      <div class="empty" style="text-align:left;padding:0 0 10px">
        <b>${esc(t.title)}</b>${t.description ? '<br>' + esc(t.description) : ''}
      </div>
      <div style="font-size:12px;color:var(--hint);margin-bottom:10px">
        ${esc(t.assignee_name || '')}${t.store_name ? ' · ' + esc(t.store_name) : ''} · ${TASK_STATUS_LABEL[t.status] || t.status}${t.due_at ? ' · до ' + new Date(t.due_at).toLocaleString('ru') : ''}
      </div>
      <div class="quick" style="margin-bottom:10px">
        ${nextButtons.map(([s, label]) => `<button onclick="changeTaskStatus(${t.id}, '${s}', this)">${label}</button>`).join('')}
      </div>
      <div class="field">
        <label>История</label>
        <div id="taskComments" style="max-height:180px;overflow-y:auto">
          ${(comments || []).map(c => `
            <div style="padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="font-size:12px;color:var(--hint)">${esc(c.author_name || 'Система')} · ${new Date(c.created_at).toLocaleString('ru')}</div>
              <div style="font-size:13px">${esc(c.body)}</div>
            </div>`).join('') || '<div class="empty">Пока пусто</div>'}
        </div>
      </div>
      <div class="field">
        <input type="text" id="taskCommentInput" placeholder="Комментарий">
      </div>
      <button class="btn-main" onclick="submitTaskComment(${t.id}, this)">Добавить комментарий</button>
    `;
  } catch (e) {
    box.innerHTML = '<div class="empty">Не удалось загрузить задачу</div>';
  }
}

async function changeTaskStatus(id, status, btnEl) {
  if (btnEl?.disabled) return;
  if (btnEl) btnEl.disabled = true;
  try {
    await window.apiClient.changeTaskStatus(authHeaders(true), id, { status });
    toast('Статус обновлён', 'ok');
    await renderTaskDetail(id);
    if (typeof page !== 'undefined' && page === 'tasks') loadTasksPage();
  } catch (e) {
    toast('Не удалось изменить статус', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

async function submitTaskComment(id, btnEl) {
  if (btnEl?.disabled) return;
  const input = document.getElementById('taskCommentInput');
  const body = input?.value.trim();
  if (!body) return;
  if (btnEl) btnEl.disabled = true;
  try {
    await window.apiClient.addTaskComment(authHeaders(true), id, { body });
    await renderTaskDetail(id);
  } catch (e) {
    toast('Не удалось отправить комментарий', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}
