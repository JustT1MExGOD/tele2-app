/**
 * 21.x (Frontend rewrite continuation) — sixth migrated legacy page,
 * replacing frontend/js/15-tasks.js file-for-file. Same shape as alerts.ts
 * (20.25.0) — real router.ts page, standard window.loadTasksPage bridge
 * (nav dispatch already calls it with the `load` prefix, unlike
 * employee/store-profile's non-standard bridge names).
 *
 * openTaskDetail is the one function already-migrated pages (alerts,
 * store-profile) call via an ambient `declare global` — this module now
 * provides the REAL implementation under the same window.* name, so
 * those two modules keep working unchanged, same as any other cross-file
 * global. setTasksFilter/changeTaskStatus/submitTaskComment are bridged
 * too — legacy-generated HTML calls them back via onclick="..." strings.
 * renderTaskDetail stays private — nothing calls it via onclick, only
 * from inside this module.
 */
import { registerPage, renderPage } from '../../app/router.js';
import type { TaskItem, TaskComment } from '../../../../src/shared/api-types.js';

let tasksFilter = 'active';

const TASK_STATUS_LABEL: Record<string, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  done: 'Выполнена',
  cancelled: 'Отменена'
};

const DONE_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M20 6 9 17l-5-5" /> </svg>';
const CANCELLED_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <circle cx="12" cy="12" r="10" /> <path d="M4.929 4.929 19.07 19.071" /> </svg>';
const OPEN_ICON =
  '<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" /> </svg>';

function taskPriorityBadge(p: string): string {
  const map: Record<string, string> = {
    urgent: '<span class="status-dot" style="background:var(--danger)"></span> Срочно',
    high: '<span class="status-dot" style="background:var(--warning)"></span> Высокий',
    normal: '',
    low: '<span class="status-dot" style="background:var(--border)"></span> Низкий'
  };
  return map[p] || '';
}

export function setTasksFilter(f: string): void {
  tasksFilter = f;
  loadTasksPage();
}

export async function loadTasksPage(): Promise<void> {
  const box = document.getElementById('tasksPageBody');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const all: TaskItem[] = await window.apiClient.getTasks(authHeaders(), orgQueryParam());
    const items = (all || []).filter((t) => {
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
        ${
          items.length
            ? items
                .map(
                  (t) => `
          <button class="row" onclick="openTaskDetail(${t.id})">
            <div class="row-icon">${t.status === 'done' ? DONE_ICON : t.status === 'cancelled' ? CANCELLED_ICON : OPEN_ICON}</div>
            <div class="row-body">
              <div class="row-title">${esc(t.title)} ${taskPriorityBadge(t.priority)}</div>
              <div class="row-sub">${esc(t.assignee_name || '')}${t.store_name ? ' · ' + esc(t.store_name) : ''} · ${TASK_STATUS_LABEL[t.status] || t.status}</div>
            </div>
            <div class="row-chevron">›</div>
          </button>`
                )
                .join('')
            : '<div class="empty">Нет задач</div>'
        }
      </div>`;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить задачи</div>';
  }
}

export async function openTaskDetail(id: number): Promise<void> {
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  if (title) title.textContent = 'Задача';
  if (body) body.innerHTML = '<div class="skeleton"></div>';
  document.getElementById('overlay')?.classList.add('show');
  await renderTaskDetail(id);
}

async function renderTaskDetail(id: number): Promise<void> {
  const box = document.getElementById('modalBody');
  if (!box) return;
  try {
    const { task: t, comments }: { task: TaskItem; comments: TaskComment[] } = await window.apiClient.getTask(authHeaders(), id);

    const canManageTask = canManage() || (typeof me !== 'undefined' && me?.role === 'supervisor');
    const isAssignee = typeof me !== 'undefined' && String(me?.employee_id) === String(t.assigned_to);

    const nextButtons: [string, string][] = [];
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
          ${
            (comments || [])
              .map(
                (c) => `
            <div style="padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="font-size:12px;color:var(--hint)">${esc(c.author_name || 'Система')} · ${new Date(c.created_at).toLocaleString('ru')}</div>
              <div style="font-size:13px">${esc(c.body)}</div>
            </div>`
              )
              .join('') || '<div class="empty">Пока пусто</div>'
          }
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

export async function changeTaskStatus(id: number, status: string, btnEl: HTMLButtonElement | null): Promise<void> {
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

export async function submitTaskComment(id: number, btnEl: HTMLButtonElement | null): Promise<void> {
  if (btnEl?.disabled) return;
  const input = document.getElementById('taskCommentInput') as HTMLInputElement | null;
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

registerPage('tasks', loadTasksPage);

declare global {
  interface Window {
    loadTasksPage: () => void;
    setTasksFilter: typeof setTasksFilter;
    openTaskDetail: typeof openTaskDetail;
    changeTaskStatus: typeof changeTaskStatus;
    submitTaskComment: typeof submitTaskComment;
  }
}
window.loadTasksPage = () => {
  renderPage('tasks');
};
window.setTasksFilter = setTasksFilter;
window.openTaskDetail = openTaskDetail;
window.changeTaskStatus = changeTaskStatus;
window.submitTaskComment = submitTaskComment;
