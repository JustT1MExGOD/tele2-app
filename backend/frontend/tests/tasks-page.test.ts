/**
 * 21.x (Frontend rewrite continuation) — jsdom render test for the sixth
 * migrated legacy page (frontend/js/15-tasks.js → src/pages/tasks), same
 * approach as alerts-page.test.ts (near-identical legacy shape).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { page?: string; role?: string; employeeId?: number } = {}) {
  document.body.innerHTML = `
    <div id="tasksPageBody"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', (json?: boolean) => (json ? { 'Content-Type': 'application/json' } : {}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('page', overrides.page ?? 'tasks');
  vi.stubGlobal('canManage', () => overrides.role === 'manager');
  vi.stubGlobal('me', { employee_id: overrides.employeeId ?? 1, role: overrides.role ?? 'employee' });

  const getTasks = vi.fn().mockResolvedValue([]);
  const getTask = vi.fn();
  const changeTaskStatus = vi.fn().mockResolvedValue({ ok: true });
  const addTaskComment = vi.fn().mockResolvedValue({ ok: true });
  (window as any).apiClient = { getTasks, getTask, changeTaskStatus, addTaskComment };
  return { getTasks, getTask, changeTaskStatus, addTaskComment };
}

const TASK_A = {
  id: 5, org_id: 'default', title: 'Проверить остатки', description: 'После 18:00',
  created_by: 1, assigned_to: 1, store_id: 's1', alert_id: null, priority: 'high',
  status: 'open', due_at: null, completed_at: null, created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-20T10:00:00Z', assignee_name: 'Иван', store_name: 'Точка А'
};

describe('Задачи (миграция frontend/js/15-tasks.js → src/pages/tasks)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadTasksPage: пустой список — "Нет задач", по умолчанию фильтр "Активные"', async () => {
    setupGlobals();
    const { loadTasksPage } = await import('../src/pages/tasks/index.js');
    await loadTasksPage();

    const box = document.getElementById('tasksPageBody')!;
    expect(box.textContent).toContain('Нет задач');
    expect(box.innerHTML).toContain('class="active" onclick="setTasksFilter(\'active\')"');
  });

  it('loadTasksPage: фильтр "active" оставляет только open/in_progress', async () => {
    const { getTasks } = setupGlobals();
    getTasks.mockResolvedValue([
      { ...TASK_A, id: 1, status: 'open' },
      { ...TASK_A, id: 2, status: 'in_progress' },
      { ...TASK_A, id: 3, status: 'done' },
      { ...TASK_A, id: 4, status: 'cancelled' }
    ]);
    const { loadTasksPage } = await import('../src/pages/tasks/index.js');
    await loadTasksPage();

    const html = document.getElementById('tasksPageBody')!.innerHTML;
    expect(html).toContain('openTaskDetail(1)');
    expect(html).toContain('openTaskDetail(2)');
    expect(html).not.toContain('openTaskDetail(3)');
    expect(html).not.toContain('openTaskDetail(4)');
  });

  it('loadTasksPage: рендерит title/приоритет/исполнителя/точку/статус', async () => {
    const { getTasks } = setupGlobals();
    getTasks.mockResolvedValue([TASK_A]);
    const { loadTasksPage } = await import('../src/pages/tasks/index.js');
    await loadTasksPage();

    const html = document.getElementById('tasksPageBody')!.innerHTML;
    expect(html).toContain('Проверить остатки');
    expect(html).toContain('Иван');
    expect(html).toContain('Точка А');
    expect(html).toContain('Открыта');
    expect(html).toContain('Высокий'); // priority badge
  });

  it('loadTasksPage: ошибка API — не падает, показывает сообщение', async () => {
    const { getTasks } = setupGlobals();
    getTasks.mockRejectedValue(new Error('network'));
    const { loadTasksPage } = await import('../src/pages/tasks/index.js');
    await loadTasksPage();

    expect(document.getElementById('tasksPageBody')!.textContent).toContain('Не удалось загрузить задачи');
  });

  it('setTasksFilter: меняет фильтр и перезагружает список', async () => {
    const { getTasks } = setupGlobals();
    const { setTasksFilter } = await import('../src/pages/tasks/index.js');

    setTasksFilter('done');
    await Promise.resolve();
    await Promise.resolve();

    expect(getTasks).toHaveBeenCalled();
    const html = document.getElementById('tasksPageBody')!.innerHTML;
    expect(html).toContain('class="active" onclick="setTasksFilter(\'done\')"');
  });

  it('openTaskDetail: исполнитель, задача open — предлагает "Взять в работу" и "Отметить выполненной"', async () => {
    const { getTask } = setupGlobals({ role: 'employee', employeeId: 1 });
    getTask.mockResolvedValue({ task: { ...TASK_A, status: 'open', assigned_to: 1 }, comments: [] });
    const { openTaskDetail } = await import('../src/pages/tasks/index.js');

    await openTaskDetail(5);

    expect(document.getElementById('overlay')!.classList.contains('show')).toBe(true);
    expect(document.getElementById('modalTitle')!.textContent).toBe('Задача');
    const html = document.getElementById('modalBody')!.innerHTML;
    expect(html).toContain("changeTaskStatus(5, 'in_progress'");
    expect(html).toContain("changeTaskStatus(5, 'done'");
    expect(html).not.toContain("changeTaskStatus(5, 'cancelled'"); // не manager/supervisor
  });

  it('openTaskDetail: manager видит "Отменить", даже не будучи исполнителем', async () => {
    const { getTask } = setupGlobals({ role: 'manager', employeeId: 99 });
    getTask.mockResolvedValue({ task: { ...TASK_A, status: 'open', assigned_to: 1 }, comments: [] });
    const { openTaskDetail } = await import('../src/pages/tasks/index.js');

    await openTaskDetail(5);

    const html = document.getElementById('modalBody')!.innerHTML;
    expect(html).toContain("changeTaskStatus(5, 'cancelled'");
    expect(html).not.toContain("changeTaskStatus(5, 'in_progress'"); // не исполнитель
  });

  it('openTaskDetail: рендерит историю комментариев (автор/текст)', async () => {
    const { getTask } = setupGlobals();
    getTask.mockResolvedValue({
      task: TASK_A,
      comments: [{ id: 1, task_id: 5, author_id: 2, body: 'Сделано наполовину', created_at: '2026-08-21T09:00:00Z', author_name: 'Мария' }]
    });
    const { openTaskDetail } = await import('../src/pages/tasks/index.js');
    await openTaskDetail(5);
    expect(document.getElementById('modalBody')!.innerHTML).toContain('Сделано наполовину');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('Мария');
  });

  it('openTaskDetail: без комментариев — "Пока пусто"', async () => {
    const { getTask } = setupGlobals();
    getTask.mockResolvedValue({ task: TASK_A, comments: [] });
    const { openTaskDetail } = await import('../src/pages/tasks/index.js');
    await openTaskDetail(5);
    expect(document.getElementById('modalBody')!.innerHTML).toContain('Пока пусто');
  });

  it('changeTaskStatus: disabled-гейт от двойного клика', async () => {
    const { changeTaskStatus: apiChangeStatus } = setupGlobals();
    const { changeTaskStatus } = await import('../src/pages/tasks/index.js');
    const btn = document.createElement('button');
    btn.disabled = true;

    await changeTaskStatus(5, 'done', btn);

    expect(apiChangeStatus).not.toHaveBeenCalled();
  });

  it('changeTaskStatus: успех — тостит, перерисовывает деталь, список перезагружается только если page===\'tasks\'', async () => {
    const { changeTaskStatus: apiChangeStatus, getTask } = setupGlobals({ page: 'tasks' });
    getTask.mockResolvedValue({ task: TASK_A, comments: [] });
    const { changeTaskStatus } = await import('../src/pages/tasks/index.js');
    const btn = document.createElement('button');

    await changeTaskStatus(5, 'done', btn);

    expect(apiChangeStatus).toHaveBeenCalledWith(expect.anything(), 5, { status: 'done' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Статус обновлён', 'ok');
    expect(getTask).toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });

  it('submitTaskComment: пустой инпут — no-op, API не вызывается', async () => {
    const { addTaskComment } = setupGlobals();
    document.body.innerHTML += '<input id="taskCommentInput" value="   ">';
    const { submitTaskComment } = await import('../src/pages/tasks/index.js');

    await submitTaskComment(5, null);

    expect(addTaskComment).not.toHaveBeenCalled();
  });

  it('submitTaskComment: успех — отправляет комментарий и перерисовывает деталь', async () => {
    const { addTaskComment, getTask } = setupGlobals();
    getTask.mockResolvedValue({ task: TASK_A, comments: [] });
    document.body.innerHTML += '<input id="taskCommentInput" value="Готово">';
    const { submitTaskComment } = await import('../src/pages/tasks/index.js');

    await submitTaskComment(5, null);

    expect(addTaskComment).toHaveBeenCalledWith(expect.anything(), 5, { body: 'Готово' });
    expect(getTask).toHaveBeenCalled();
  });

  it('submitTaskComment: ошибка API — toast err', async () => {
    const { addTaskComment } = setupGlobals();
    addTaskComment.mockRejectedValue(new Error('boom'));
    document.body.innerHTML += '<input id="taskCommentInput" value="Готово">';
    const { submitTaskComment } = await import('../src/pages/tasks/index.js');

    await submitTaskComment(5, null);

    expect((globalThis as any).toast).toHaveBeenCalledWith('Не удалось отправить комментарий', 'err');
  });

  it('window.* мост — loadTasksPage/setTasksFilter/openTaskDetail/changeTaskStatus/submitTaskComment', async () => {
    setupGlobals();
    await import('../src/pages/tasks/index.js');

    for (const name of ['loadTasksPage', 'setTasksFilter', 'openTaskDetail', 'changeTaskStatus', 'submitTaskComment']) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
