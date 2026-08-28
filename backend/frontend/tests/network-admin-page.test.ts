/**
 * 21.x (Frontend rewrite continuation, batch of 13) — jsdom render test for
 * frontend/js/13-v14.js → src/pages/network-admin. Focused rather than
 * exhaustive (batch migration) — covers branding, heatmap, forecast,
 * staffing hints, the what-if scenario flow (add/run/save-A/compare),
 * announcements, org admin CRUD, and audit log.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals(overrides: { role?: string } = {}) {
  document.body.innerHTML = `
    <div id="hmStore"></div><div id="hmMeta"></div><div id="hmGrid"></div>
    <select id="fcStore"><option value="s1" selected></option></select><div id="fcList"></div>
    <select id="wiFrom"></select><select id="wiTo"></select><input id="wiDate"><input id="wiEmp"><div id="wiMovesList"></div><div id="wiResult"></div><div id="wiCompareBox"></div>
    <div id="staffHintsSection"></div><div id="staffHintsList"></div>
    <div id="anList"></div><div id="anCreate"></div>
    <select id="riStore"><option value="s1" selected></option></select><input id="riDate"><div id="riPreview"></div>
    <div id="orgsList"></div>
    <div id="orgsTableWrap"><table id="orgsTable"><thead id="orgsTableHead"></thead><tbody id="orgsTableBody"></tbody></table></div>
    <div id="auditFilters">
      <select id="auditFilterAction"></select>
      <select id="auditFilterTargetType"></select>
      <input type="date" id="auditFilterFrom">
      <input type="date" id="auditFilterTo">
    </div>
    <div id="auditList"></div>
    <div id="auditTableWrap"><table id="auditTable"><thead id="auditTableHead"></thead><tbody id="auditTableBody"></tbody></table></div>
    <button id="auditLoadMore" style="display:none"></button>
    <div id="overlay"></div><div id="modalTitle"></div><div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('orgQueryParam', () => '');
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('me', { employee_id: 1, role: overrides.role ?? 'manager' });
  vi.stubGlobal('adminViewOrgId', null);
  vi.stubGlobal('canManage', () => overrides.role === 'manager' || overrides.role === 'admin' || overrides.role === undefined);
  vi.stubGlobal('canAdmin', () => overrides.role === 'admin');
  vi.stubGlobal('todayMoscow', () => '2026-08-25');
  vi.stubGlobal('switchPage', vi.fn());
  vi.stubGlobal('closeModal', vi.fn());
  vi.stubGlobal('stores', []);
  vi.stubGlobal('fetchOrgStores', vi.fn().mockResolvedValue([{ id: 's1', name: 'Точка А' }]));
  vi.stubGlobal('loadMonthSchedule', vi.fn());
  (window as any).__stores = null;

  const getBranding = vi.fn().mockResolvedValue({ org_id: 'o1', name: 'Сеть', brand_name: 'T2', primary_color: '#2AABEE', logo_url: null, app_title: 'T2 Sales' });
  const getHeatmapPrecise = vi.fn().mockResolvedValue({ hours: [] });
  const getForecast = vi.fn().mockResolvedValue({ store_id: 's1', history_days: 20, items: [] });
  const getStaffingHints = vi.fn().mockResolvedValue({ items: [] });
  const runWhatIf = vi.fn().mockResolvedValue({ date: '2026-08-25', stores: [], summary: {}, moves_applied: [] });
  const applyWhatIf = vi.fn().mockResolvedValue({ ok: true, count: 1 });
  const getAnnouncements = vi.fn().mockResolvedValue([]);
  const getAnnouncementReads = vi.fn().mockResolvedValue({ read: [], unread: [] });
  const markAnnouncementRead = vi.fn().mockResolvedValue({ ok: true });
  const createAnnouncement = vi.fn().mockResolvedValue({ id: 1 });
  const getReportDay = vi.fn().mockResolvedValue({ ok: true, store_id: 's1', date: '2026-08-25', kind: 'final', content_type: 'image/svg+xml', svg: '<svg></svg>' });
  const getOrgsAdmin = vi.fn().mockResolvedValue([]);
  const saveOrg = vi.fn().mockResolvedValue({ id: 'o2', name: 'Новая' });
  const getAuditLog = vi.fn().mockResolvedValue({ items: [] });
  (window as any).apiClient = {
    getBranding,
    getHeatmapPrecise,
    getForecast,
    getStaffingHints,
    runWhatIf,
    applyWhatIf,
    getAnnouncements,
    getAnnouncementReads,
    markAnnouncementRead,
    createAnnouncement,
    getReportDay,
    getOrgsAdmin,
    saveOrg,
    getAuditLog
  };
  return { getBranding, getHeatmapPrecise, getForecast, getStaffingHints, runWhatIf, applyWhatIf, getAnnouncements, getAnnouncementReads, markAnnouncementRead, createAnnouncement, getReportDay, getOrgsAdmin, saveOrg, getAuditLog };
}

describe('Сети/аналитика-админ (миграция frontend/js/13-v14.js → src/pages/network-admin)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('applyBranding: применяет цвет и заголовок', async () => {
    setupGlobals();
    const { applyBranding } = await import('../src/pages/network-admin/index.js');
    await applyBranding();
    expect(document.title).toBe('T2 Sales');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#2AABEE');
  });

  it('loadHeatmap: без выбранной точки — просит выбрать', async () => {
    setupGlobals();
    (document.getElementById('hmStore') as HTMLElement).setAttribute('value', '');
    const { loadHeatmap } = await import('../src/pages/network-admin/index.js');
    await loadHeatmap();
    expect(document.getElementById('hmMeta')!.textContent).toBe('Выбери точку');
  });

  it('loadHeatmap: рендерит 13 часовых ячеек (9..21) с лучшим часом', async () => {
    const { getHeatmapPrecise } = setupGlobals();
    document.body.innerHTML = document.body.innerHTML.replace('<div id="hmStore"></div>', '<select id="hmStore"><option value="s1" selected></option></select>');
    getHeatmapPrecise.mockResolvedValue({ hours: [{ hour: 12, value: 5 }, { hour: 18, value: 9 }] });
    const { loadHeatmap } = await import('../src/pages/network-admin/index.js');
    await loadHeatmap();
    const html = document.getElementById('hmGrid')!.innerHTML;
    expect(html).toContain('18:00');
    expect(document.getElementById('hmMeta')!.innerHTML).toContain('лучший час 18:00');
  });

  it('loadForecast: пусто — сообщение про отсутствие истории', async () => {
    setupGlobals();
    const { loadForecast } = await import('../src/pages/network-admin/index.js');
    await loadForecast();
    expect(document.getElementById('fcList')!.textContent).toContain('нет истории для прогноза');
  });

  it('loadForecast: рендерит карточки прогноза по дням', async () => {
    const { getForecast } = setupGlobals();
    getForecast.mockResolvedValue({ store_id: 's1', history_days: 20, items: [{ date: '2026-08-26', predicted: { sim: 3, mnp: 1, pa: 0, combo: 0 } }] });
    const { loadForecast } = await import('../src/pages/network-admin/index.js');
    await loadForecast();
    expect(document.getElementById('fcList')!.innerHTML).toContain('2026-08-26');
  });

  it('loadStaffingHints: не-manager — секция скрыта', async () => {
    setupGlobals({ role: 'employee' });
    const { loadStaffingHints } = await import('../src/pages/network-admin/index.js');
    await loadStaffingHints();
    expect((document.getElementById('staffHintsSection') as HTMLElement).style.display).toBe('none');
  });

  it('loadStaffingHints: manager, есть хинты — рендерит с кнопкой переноса', async () => {
    const { getStaffingHints } = setupGlobals({ role: 'manager' });
    getStaffingHints.mockResolvedValue({ items: [{ severity: 'warn', store_id: 's1', store_name: 'Точка А', date: '2026-08-26', message: 'Мало людей' }] });
    const { loadStaffingHints } = await import('../src/pages/network-admin/index.js');
    await loadStaffingHints();
    expect(document.getElementById('staffHintsList')!.innerHTML).toContain("proposeMoveForStore('s1','2026-08-26')");
  });

  it('addWiMove/removeWiMove/clearWiMoves: накапливают и очищают список переносов', async () => {
    setupGlobals();
    (document.getElementById('wiEmp') as HTMLInputElement).value = '5';
    (document.getElementById('wiTo') as HTMLSelectElement).innerHTML = '<option value="s2" selected></option>';
    const { addWiMove, removeWiMove, clearWiMoves } = await import('../src/pages/network-admin/index.js');
    addWiMove();
    expect(document.getElementById('wiMovesList')!.innerHTML).toContain('#5:');
    removeWiMove(0);
    expect(document.getElementById('wiMovesList')!.innerHTML).toBe('');
    addWiMove();
    clearWiMoves();
    expect(document.getElementById('wiMovesList')!.innerHTML).toBe('');
  });

  it('runWhatIf: без переносов — просит добавить хотя бы один', async () => {
    setupGlobals();
    const { runWhatIf } = await import('../src/pages/network-admin/index.js');
    await runWhatIf();
    expect(document.getElementById('wiResult')!.textContent).toContain('Добавь хотя бы один перенос');
  });

  it('runWhatIf → saveWiScenarioA → runWhatIf снова → compareWiScenarios: полный цикл A/B', async () => {
    const { runWhatIf: apiRunWhatIf } = setupGlobals();
    (document.getElementById('wiEmp') as HTMLInputElement).value = '5';
    (document.getElementById('wiTo') as HTMLSelectElement).innerHTML = '<option value="s2" selected></option>';
    apiRunWhatIf.mockResolvedValue({ date: '2026-08-25', stores: [{ name: 'Точка А', delta_sim: -1, staff_before: 2, staff_after: 1 }], summary: { stores_lost: ['Точка А'] }, moves_applied: [{ employee_id: 5, skipped: false }] });
    const { runWhatIf, saveWiScenarioA } = await import('../src/pages/network-admin/index.js');
    await runWhatIf();
    expect(document.getElementById('wiResult')!.innerHTML).toContain('Точка А');
    saveWiScenarioA();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Сценарий A сохранён', 'ok');

    apiRunWhatIf.mockResolvedValue({ date: '2026-08-25', stores: [{ name: 'Точка Б', delta_sim: -3, staff_before: 2, staff_after: 1 }], summary: { stores_lost: ['Точка Б'] }, moves_applied: [{ employee_id: 5, skipped: false }] });
    await runWhatIf();
    expect(document.getElementById('wiCompareBox')!.innerHTML).toContain('Сравнение сценариев');
  });

  it('applyWhatIf: без пересчитанного сценария — toast err', async () => {
    const { applyWhatIf: apiApply } = setupGlobals();
    const { applyWhatIf } = await import('../src/pages/network-admin/index.js');
    await applyWhatIf();
    expect(apiApply).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Сначала пересчитай what-if', 'err');
  });

  it('applyWhatIf: после runWhatIf — применяет и обновляет график', async () => {
    const { runWhatIf: apiRunWhatIf, applyWhatIf: apiApply } = setupGlobals();
    (document.getElementById('wiEmp') as HTMLInputElement).value = '5';
    (document.getElementById('wiTo') as HTMLSelectElement).innerHTML = '<option value="s2" selected></option>';
    apiRunWhatIf.mockResolvedValue({ date: '2026-08-25', stores: [], summary: {}, moves_applied: [{ employee_id: 5, skipped: false }] });
    const { runWhatIf, applyWhatIf } = await import('../src/pages/network-admin/index.js');
    await runWhatIf();
    await applyWhatIf();
    expect(apiApply).toHaveBeenCalled();
    expect((globalThis as any).loadMonthSchedule).toHaveBeenCalled();
  });

  it('loadAnnouncements: обычный массив в ответе (не {items}) — рендерит', async () => {
    const { getAnnouncements } = setupGlobals();
    getAnnouncements.mockResolvedValue([{ id: 1, title: 'Важно', body: 'Текст', required: true, is_read: false, created_at: '2026-08-20T00:00:00Z' }]);
    const { loadAnnouncements } = await import('../src/pages/network-admin/index.js');
    await loadAnnouncements();
    const html = document.getElementById('anList')!.innerHTML;
    expect(html).toContain('Важно');
    expect(html).toContain('markAnnouncementRead(1)');
  });

  it('createAnnouncement: без заголовка/текста — toast err', async () => {
    const { createAnnouncement: apiCreate } = setupGlobals();
    document.body.innerHTML += '<input id="anTitle" value=""><textarea id="anBody"></textarea><input id="anReq" type="checkbox">';
    const { createAnnouncement } = await import('../src/pages/network-admin/index.js');
    await createAnnouncement();
    expect(apiCreate).not.toHaveBeenCalled();
  });

  it('loadReportSvg: без точки — просит выбрать', async () => {
    setupGlobals();
    (document.getElementById('riStore') as HTMLElement).innerHTML = '';
    const { loadReportSvg } = await import('../src/pages/network-admin/index.js');
    await loadReportSvg();
    expect(document.getElementById('riPreview')!.textContent).toContain('Выбери точку');
  });

  it('loadReportSvg: story-режим (svgs) — 3 кадра', async () => {
    const { getReportDay } = setupGlobals();
    getReportDay.mockResolvedValue({ ok: true, store_id: 's1', date: '2026-08-25', kind: 'story', content_type: 'image/svg+xml', svgs: { plan: '<svg>p</svg>', fact: '<svg>f</svg>', tomorrow: '<svg>t</svg>' } });
    const { loadReportSvg } = await import('../src/pages/network-admin/index.js');
    await loadReportSvg();
    const html = document.getElementById('riPreview')!.innerHTML;
    expect(html).toContain('План');
    expect(html).toContain('Факт');
    expect(html).toContain('Завтра');
  });

  it('loadOrgsAdmin → openEditOrg: рендерит список сетей и открывает форму редактирования из кэша', async () => {
    const { getOrgsAdmin } = setupGlobals({ role: 'admin' });
    getOrgsAdmin.mockResolvedValue([{ id: 'o1', name: 'Сеть 1', sector_id: 'north', dealer_name: 'ООО Ромашка' }]);
    const { loadOrgsAdmin, openEditOrg } = await import('../src/pages/network-admin/index.js');
    await loadOrgsAdmin();
    expect(document.getElementById('orgsList')!.innerHTML).toContain('дилер ООО Ромашка');
    openEditOrg('o1');
    expect(document.getElementById('modalTitle')!.textContent).toBe('Сеть 1');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('value="o1"');
  });

  it('saveOrg: без названия — toast err, API не вызывается', async () => {
    const { saveOrg: apiSave } = setupGlobals({ role: 'admin' });
    document.body.innerHTML += '<input id="no_id" value="new1"><input id="no_name" value="">';
    const { saveOrg } = await import('../src/pages/network-admin/index.js');
    await saveOrg('');
    expect(apiSave).not.toHaveBeenCalled();
  });

  it('saveOrg: существующая сеть — сохраняет, тостит "обновлена"', async () => {
    const { saveOrg: apiSave } = setupGlobals({ role: 'admin' });
    document.body.innerHTML += '<input id="no_name" value="Сеть 1"><input id="no_brand" value=""><input id="no_color" value="#2AABEE"><input id="no_sector" value="default"><input id="no_dealer" value=""><input id="no_chat" value=""><input id="no_sales_thread" value=""><input id="no_reports_thread" value="">';
    const { saveOrg } = await import('../src/pages/network-admin/index.js');
    await saveOrg('o1');
    expect(apiSave).toHaveBeenCalledWith(expect.anything(), 'o1', expect.objectContaining({ name: 'Сеть 1' }));
    expect((globalThis as any).toast).toHaveBeenCalledWith('Сеть обновлена', 'ok');
  });

  it('loadAuditLog: рендерит записи с человекочитаемым названием действия', async () => {
    const { getAuditLog } = setupGlobals();
    getAuditLog.mockResolvedValue({
      items: [
        { id: 1, org_id: 'o1', actor_employee_id: 1, actor_telegram_id: null, actor_name: 'Иван', actor_role: 'manager', target_org_id: 'o1', action: 'employee.role_change', target_type: 'employee', target_id: '5', before: { role: 'employee' }, after: { role: 'manager' }, request_id: null, created_at: '2026-08-25T10:00:00Z' }
      ]
    });
    const { loadAuditLog } = await import('../src/pages/network-admin/index.js');
    await loadAuditLog();
    const html = document.getElementById('auditList')!.innerHTML;
    expect(html).toContain('Смена роли');
    expect(html).toContain('Иван');
  });

  // ===== 21.x, «максимально функциональный» admin =====

  it('loadOrgsAdmin: desktop-таблица рендерит тот же состав, что #orgsList, сортируется по названию', async () => {
    const { getOrgsAdmin } = setupGlobals({ role: 'admin' });
    getOrgsAdmin.mockResolvedValue([
      { id: 'o2', name: 'Бета', sector_id: 'south', dealer_name: 'ООО Вторая' },
      { id: 'o1', name: 'Альфа', sector_id: 'north', dealer_name: 'ООО Ромашка' }
    ]);
    const { loadOrgsAdmin, sortOrgsTable } = await import('../src/pages/network-admin/index.js');
    await loadOrgsAdmin();
    const rows = Array.from(document.querySelectorAll('#orgsTableBody tr')).map((tr) => tr.textContent || '');
    expect(rows[0]).toContain('Альфа');
    expect(rows[1]).toContain('Бета');
    sortOrgsTable('name');
    const reversed = Array.from(document.querySelectorAll('#orgsTableBody tr')).map((tr) => tr.textContent || '');
    expect(reversed[0]).toContain('Бета');
  });

  it('orgs-таблица: строка помечена data-clickable и ведёт на openEditOrg по её id', async () => {
    const { getOrgsAdmin } = setupGlobals({ role: 'admin' });
    getOrgsAdmin.mockResolvedValue([{ id: 'o1', name: 'Сеть 1', sector_id: 'north', dealer_name: 'ООО Ромашка' }]);
    const { loadOrgsAdmin, openEditOrg } = await import('../src/pages/network-admin/index.js');
    await loadOrgsAdmin();
    const row = document.querySelector('#orgsTableBody tr') as HTMLElement;
    expect(row.hasAttribute('data-clickable')).toBe(true);
    expect(row.getAttribute('onclick')).toContain("openEditOrg('o1')");
    // jsdom не исполняет inline onclick="..." через синтетический
    // dispatchEvent (тот же класс ограничения, что уже был у остальных
    // .data-table страниц в этой сессии) — проверяем, что открывает
    // ИМЕННО та функция, на которую ссылается атрибут.
    openEditOrg('o1');
    expect(document.getElementById('modalTitle')!.textContent).toBe('Сеть 1');
  });

  it('loadAuditLog: desktop-таблица + фильтры вызывают getAuditLog с ожидаемыми аргументами', async () => {
    const { getAuditLog } = setupGlobals();
    getAuditLog.mockResolvedValue({
      items: [{ id: 1, org_id: 'o1', actor_employee_id: 1, actor_telegram_id: null, actor_name: 'Иван', actor_role: 'manager', target_org_id: 'o1', action: 'employee.role_change', target_type: 'employee', target_id: '5', before: { role: 'employee' }, after: { role: 'manager' }, request_id: null, created_at: '2026-08-25T10:00:00Z' }]
    });
    const { loadAuditLog, applyAuditFilters } = await import('../src/pages/network-admin/index.js');
    await loadAuditLog();
    expect(document.getElementById('auditTableBody')!.innerHTML).toContain('Смена роли');
    expect((document.getElementById('auditFilterAction') as HTMLSelectElement).options.length).toBeGreaterThan(1);

    (document.getElementById('auditFilterAction') as HTMLSelectElement).value = 'employee.role_change';
    (document.getElementById('auditFilterFrom') as HTMLInputElement).value = '2026-08-01';
    await applyAuditFilters();
    expect(getAuditLog).toHaveBeenLastCalledWith(expect.anything(), '', expect.objectContaining({ action: 'employee.role_change', from: '2026-08-01', limit: 50, offset: 0 }));
  });

  it('loadMoreAuditLog: инкрементит offset, дописывает результаты, скрывает кнопку при неполной странице', async () => {
    const { getAuditLog } = setupGlobals();
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: i, org_id: 'o1', actor_employee_id: 1, actor_telegram_id: null, actor_name: 'Иван', actor_role: 'manager', target_org_id: 'o1', action: 'sales.correction', target_type: 'sale', target_id: String(i), before: null, after: null, request_id: null, created_at: '2026-08-25T10:00:00Z' }));
    const page2 = [{ id: 100, org_id: 'o1', actor_employee_id: 1, actor_telegram_id: null, actor_name: 'Анна', actor_role: 'manager', target_org_id: 'o1', action: 'sales.correction', target_type: 'sale', target_id: '100', before: null, after: null, request_id: null, created_at: '2026-08-24T10:00:00Z' }];
    getAuditLog.mockResolvedValueOnce({ items: page1 }).mockResolvedValueOnce({ items: page2 });
    const { loadAuditLog, loadMoreAuditLog } = await import('../src/pages/network-admin/index.js');
    await loadAuditLog();
    expect((document.getElementById('auditLoadMore') as HTMLElement).style.display).toBe('');
    await loadMoreAuditLog();
    expect(getAuditLog).toHaveBeenLastCalledWith(expect.anything(), '', expect.objectContaining({ offset: 50 }));
    expect(document.querySelectorAll('#auditTableBody tr').length).toBe(51);
    expect((document.getElementById('auditLoadMore') as HTMLElement).style.display).toBe('none');
  });

  it('openAuditDiffModal: строка помечена data-clickable, открывает модал с полным before/after', async () => {
    const { getAuditLog } = setupGlobals();
    getAuditLog.mockResolvedValue({
      items: [{ id: 1, org_id: 'o1', actor_employee_id: 1, actor_telegram_id: null, actor_name: 'Иван', actor_role: 'manager', target_org_id: 'o1', action: 'employee.role_change', target_type: 'employee', target_id: '5', before: { role: 'employee' }, after: { role: 'manager' }, request_id: null, created_at: '2026-08-25T10:00:00Z' }]
    });
    const { loadAuditLog, openAuditDiffModal } = await import('../src/pages/network-admin/index.js');
    await loadAuditLog();
    const row = document.querySelector('#auditTableBody tr') as HTMLElement;
    expect(row.hasAttribute('data-clickable')).toBe(true);
    expect(row.getAttribute('onclick')).toBe('openAuditDiffModal(0)');
    openAuditDiffModal(0);
    expect(document.getElementById('modalBody')!.innerHTML).toContain('"role": "employee"');
    expect(document.getElementById('modalBody')!.innerHTML).toContain('"role": "manager"');
  });

  it('window.* мост — все 29 функций', async () => {
    setupGlobals();
    await import('../src/pages/network-admin/index.js');
    for (const name of [
      'applyBranding',
      'fillStoreSelects',
      'loadHeatmap',
      'loadForecast',
      'loadStaffingHints',
      'proposeMoveForStore',
      'addWiMove',
      'removeWiMove',
      'clearWiMoves',
      'runWhatIf',
      'saveWiScenarioA',
      'compareWiScenarios',
      'clearWiComparison',
      'applyWhatIf',
      'loadAnnouncements',
      'showAnnouncementReads',
      'markAnnouncementRead',
      'createAnnouncement',
      'loadReportSvg',
      'loadOrgsAdmin',
      'loadAuditLog',
      'openAddOrg',
      'openEditOrg',
      'saveOrg',
      'sortOrgsTable',
      'applyAuditFilters',
      'loadMoreAuditLog',
      'sortAuditTable',
      'openAuditDiffModal'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
