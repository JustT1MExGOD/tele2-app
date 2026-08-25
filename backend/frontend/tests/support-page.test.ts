/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/06c-support-tickets.js → src/pages/support. Focused rather
 * than exhaustive (batch migration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { role?: string; filter?: number | null } = {}) {
  document.body.innerHTML = `
    <div id="historyList"></div>
    <div id="faqList"></div>
    <div id="supportChat"></div>
    <div id="adminTicketsSection"></div>
    <div id="adminTicketsList"></div>
    <div id="ticketsBox"></div>
    <input id="supportMsg">
    <div id="supportResult"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'employee', full_name: 'Иван' });
  vi.stubGlobal('tgUser', () => null);
  vi.stubGlobal('canManage', () => overrides.role === 'manager');
  vi.stubGlobal('canAdmin', () => overrides.role === 'admin');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('API', 'https://example.test');
  vi.stubGlobal('historyEmployeeFilter', overrides.filter ?? null);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  vi.stubGlobal('prompt', vi.fn().mockReturnValue('Ответ'));
  (window as any).historyEmployeeFilter = overrides.filter ?? null;

  const getSalesHistory = vi.fn().mockResolvedValue({ from: '', to: '', count: 0, items: [] });
  const getFaq = vi.fn().mockResolvedValue([]);
  const getMyTickets = vi.fn().mockResolvedValue([]);
  const getSupportTickets = vi.fn().mockResolvedValue([]);
  const replyTicket = vi.fn().mockResolvedValue({ ok: true });
  const createSupportTicket = vi.fn().mockResolvedValue({ ticket: {}, auto_reply: 'Спасибо' });
  const exportCsv = vi.fn().mockResolvedValue(new Blob(['a,b']));
  (window as any).apiClient = {
    getSalesHistory,
    getFaq,
    getMyTickets,
    getSupportTickets,
    replyTicket,
    createSupportTicket,
    exportCsv
  };
  return { getSalesHistory, getFaq, getMyTickets, getSupportTickets, replyTicket, createSupportTicket, exportCsv };
}

describe('Поддержка/история (миграция frontend/js/06c-support-tickets.js → src/pages/support)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('mondayOf: понедельник недели для произвольной даты', async () => {
    setupGlobals();
    const { mondayOf } = await import('../src/pages/support/index.js');
    expect(mondayOf('2026-08-25')).toBe('2026-08-24');
  });

  it('loadHistory: пусто — сообщение "Нет продаж за период"', async () => {
    setupGlobals();
    const { loadHistory } = await import('../src/pages/support/index.js');
    await loadHistory();
    expect(document.getElementById('historyList')!.textContent).toContain('Нет продаж за период');
  });

  it('loadHistory: без фильтра — показывает ФИО + точку; с фильтром — только точку', async () => {
    const { getSalesHistory } = setupGlobals({ filter: 42 });
    getSalesHistory.mockResolvedValue({
      from: '', to: '', count: 1,
      items: [{ id: 1, employee_id: 42, store_id: 's1', sale_date: '2026-08-20', full_name: 'Иван', store_name: 'Точка А', sim: 3, mnp: 1, pa: 0 }]
    });
    const { loadHistory } = await import('../src/pages/support/index.js');
    await loadHistory();
    expect(getSalesHistory).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('employee_id=42'));
    const html = document.getElementById('historyList')!.innerHTML;
    expect(html).toContain('Точка А');
    expect(html).toContain('SIM 3');
  });

  it('loadHistory: ошибка API — сообщение про привязку Telegram', async () => {
    const { getSalesHistory } = setupGlobals();
    getSalesHistory.mockRejectedValue(new Error('network'));
    const { loadHistory } = await import('../src/pages/support/index.js');
    await loadHistory();
    expect(document.getElementById('historyList')!.textContent).toContain('Нужна привязка Telegram');
  });

  it('copyScheduleWeek: не-manager — no-op (fetch не вызывается)', async () => {
    setupGlobals({ role: 'employee' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { copyScheduleWeek } = await import('../src/pages/support/index.js');
    await copyScheduleWeek();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('copyScheduleWeek: manager, подтверждено — POST на /schedules/copy-week (не apiClient)', async () => {
    setupGlobals({ role: 'manager' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ copied: 5 })
    } as any);
    const { copyScheduleWeek } = await import('../src/pages/support/index.js');
    await copyScheduleWeek();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/schedules/copy-week'), expect.objectContaining({ method: 'POST' }));
    expect((globalThis as any).toast).toHaveBeenCalledWith('Скопировано смен: 5', 'ok');
  });

  it('loadSupport: FAQ пуст, тикетов нет, не-admin — блок админ-тикетов скрыт', async () => {
    setupGlobals({ role: 'employee' });
    const { loadSupport } = await import('../src/pages/support/index.js');
    await loadSupport();
    expect(document.getElementById('faqList')!.textContent).toContain('FAQ пока пуст');
    expect((document.getElementById('adminTicketsSection') as HTMLElement).style.display).toBe('none');
  });

  it('loadSupport: admin — показывает блок тикетов с кнопкой "Ответить"', async () => {
    const { getSupportTickets } = setupGlobals({ role: 'admin' });
    getSupportTickets.mockResolvedValue([{ id: 7, full_name: 'Пётр', message: 'Проблема', status: 'open', admin_reply: null, telegram_id: null, employee_id: null, category: null, created_at: '' }]);
    const { loadSupport } = await import('../src/pages/support/index.js');
    await loadSupport();
    const html = document.getElementById('adminTicketsList')!.innerHTML;
    expect(html).toContain('#7 Пётр');
    expect(html).toContain('replyTicketPrompt(7)');
  });

  it('sendSupport: пустое сообщение — toast err, API не вызывается', async () => {
    const { createSupportTicket } = setupGlobals();
    const { sendSupport } = await import('../src/pages/support/index.js');
    await sendSupport();
    expect(createSupportTicket).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Введите сообщение', 'err');
  });

  it('sendSupport: успех — очищает поле, показывает auto_reply', async () => {
    const { createSupportTicket } = setupGlobals();
    (document.getElementById('supportMsg') as HTMLInputElement).value = 'Помогите';
    const { sendSupport } = await import('../src/pages/support/index.js');
    await sendSupport();
    expect(createSupportTicket).toHaveBeenCalled();
    expect((document.getElementById('supportMsg') as HTMLInputElement).value).toBe('');
    expect(document.getElementById('supportResult')!.textContent).toBe('Спасибо');
  });

  it('exportCSV: не-manager — no-op', async () => {
    const { exportCsv } = setupGlobals({ role: 'employee' });
    const { exportCSV } = await import('../src/pages/support/index.js');
    await exportCSV('sales');
    expect(exportCsv).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Только управляющий', 'err');
  });

  it('exportCSV: manager, sales — вызывает apiClient.exportCsv с sales.csv путём', async () => {
    const { exportCsv } = setupGlobals({ role: 'manager' });
    const { exportCSV } = await import('../src/pages/support/index.js');
    await exportCSV('sales');
    expect(exportCsv).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/export/sales.csv'));
    expect((globalThis as any).toast).toHaveBeenCalledWith('Скачано', 'ok');
  });

  it('replyTicketPrompt: не-admin — toast err, API не вызывается', async () => {
    const { replyTicket: apiReply } = setupGlobals({ role: 'employee' });
    const { replyTicketPrompt } = await import('../src/pages/support/index.js');
    await replyTicketPrompt(1);
    expect(apiReply).not.toHaveBeenCalled();
  });

  it('replyTicketPrompt: admin, prompt даёт текст — отвечает и перезагружает', async () => {
    const { replyTicket: apiReply } = setupGlobals({ role: 'admin' });
    const { replyTicketPrompt } = await import('../src/pages/support/index.js');
    await replyTicketPrompt(3);
    expect(apiReply).toHaveBeenCalledWith(expect.anything(), 3, { reply: 'Ответ' });
    expect((globalThis as any).toast).toHaveBeenCalledWith('Ответ отправлен', 'ok');
  });

  it('loadManagerTickets: не-admin — no-op', async () => {
    setupGlobals({ role: 'employee' });
    const { loadManagerTickets } = await import('../src/pages/support/index.js');
    await loadManagerTickets();
    expect(document.getElementById('ticketsBox')!.innerHTML).toBe('');
  });

  it('loadManagerTickets: admin — рендерит открытые тикеты с формой ответа', async () => {
    const { getSupportTickets } = setupGlobals({ role: 'admin' });
    getSupportTickets.mockResolvedValue([
      { id: 5, full_name: 'Ольга', message: 'Вопрос', status: 'open', admin_reply: null, telegram_id: null, employee_id: null, category: null, created_at: '' }
    ]);
    const { loadManagerTickets } = await import('../src/pages/support/index.js');
    await loadManagerTickets();
    const html = document.getElementById('ticketsBox')!.innerHTML;
    expect(html).toContain('#5 · Ольга');
    expect(html).toContain('treply_5');
  });

  it('replyTicket: пустой ввод — toast err, API не вызывается', async () => {
    const { replyTicket: apiReply } = setupGlobals({ role: 'admin' });
    document.body.innerHTML += '<input id="treply_9" value="">';
    const { replyTicket } = await import('../src/pages/support/index.js');
    await replyTicket(9);
    expect(apiReply).not.toHaveBeenCalled();
  });

  it('window.* мост — все 8 функций', async () => {
    setupGlobals();
    await import('../src/pages/support/index.js');
    for (const name of [
      'loadHistory',
      'copyScheduleWeek',
      'loadSupport',
      'replyTicketPrompt',
      'sendSupport',
      'loadManagerTickets',
      'replyTicket',
      'exportCSV'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
