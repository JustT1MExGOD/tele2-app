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
  const map = { urgent: '🔴 Срочно', high: '🟠 Высокий', normal: '', low: '⚪ Низкий' };
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
    const res = await fetch(API + '/tasks?_=1' + orgQueryParam(), { headers: authHeaders() });
    if (!res.ok) throw new Error('fail');
    const all = await res.json();
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
            <div class="row-icon">${t.status === 'done' ? '✅' : t.status === 'cancelled' ? '🚫' : '📋'}</div>
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
    const res = await fetch(API + '/tasks/' + id, { headers: authHeaders() });
    if (!res.ok) throw new Error('fail');
    const { task: t, comments } = await res.json();

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
    const res = await fetch(API + '/tasks/' + id + '/status', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('fail');
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
    const res = await fetch(API + '/tasks/' + id + '/comments', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ body })
    });
    if (!res.ok) throw new Error('fail');
    await renderTaskDetail(id);
  } catch (e) {
    toast('Не удалось отправить комментарий', 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}
