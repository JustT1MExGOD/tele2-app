/**
 * 21.x (Frontend rewrite continuation, batch of 13) — replacing
 * frontend/js/06-team-bfq.js file-for-file: команда (список/роли/CRUD
 * сотрудников и точек), карточка сотрудника, каскадный Дилер → Сектор → Сеть
 * переключатель для admin (21.1). BFQ/планы и поддержка/тикеты уже вынесены
 * в отдельные файлы (06b-plans-bfq.js, src/pages/support) — не эта миграция.
 *
 * switcherOrgsCache stays a private module variable — only ever read/written
 * within this same file's functions. window.__stores stays a real window
 * property — written here (cache-invalidation on org switch / new store),
 * read AND written by frontend/js/13-v14.js, still legacy/unmigrated.
 */
import type { OrgAdminItem, OrgsListResponse, EmployeeListItem, SaleRow, ScheduleRow, CreateStoreRequest } from '../../../../src/shared/api-types.js';

declare global {
  interface Window {
    __stores?: any[] | null;
  }
}

let switcherOrgsCache: OrgAdminItem[] = [];

// 20.42, первая настоящая .data-table (docs/DESKTOP-DESIGN.md Part G) —
// сортировка чисто клиентская поверх уже загруженных данных, без нового
// запроса; lastTeamList/lastTeamMap хранят последний ответ loadTeam(),
// чтобы sortTeamTable() могла перерисовать только таблицу.
let teamSort: { key: string; dir: 1 | -1 } = { key: 'name', dir: 1 };
let lastTeamList: EmployeeListItem[] = [];
let lastTeamMap: Record<string, { sim: number; phones: number; combo: number; active: boolean }> = {};

function switcherHierarchy(): Map<string, Map<string, OrgAdminItem[]>> {
  // dealerLabel -> sectorId -> orgs[] — группировка чисто клиентская, GET
  // /orgs уже отдаёт dealer_name/sector_id на каждой сети, отдельный
  // эндпоинт не нужен.
  const byDealer = new Map<string, Map<string, OrgAdminItem[]>>();
  for (const o of switcherOrgsCache) {
    const dealerLabel = o.dealer_name || 'Без дилера';
    const sectorId = o.sector_id || 'default';
    if (!byDealer.has(dealerLabel)) byDealer.set(dealerLabel, new Map());
    const bySector = byDealer.get(dealerLabel)!;
    if (!bySector.has(sectorId)) bySector.set(sectorId, []);
    bySector.get(sectorId)!.push(o);
  }
  return byDealer;
}

export async function renderOrgSwitcher(): Promise<void> {
  const sw = document.getElementById('orgSwitcher') as HTMLElement & { dataset: DOMStringMap } | null;
  if (!sw) return;
  if (me?.role !== 'admin') {
    sw.style.display = 'none';
    return;
  }
  sw.style.display = 'block';
  if (sw.dataset.loaded) return;
  try {
    const orgs: OrgsListResponse = await window.apiClient.getOrgsAdmin(authHeaders());
    switcherOrgsCache = Array.isArray(orgs) ? orgs : [];
    const current = adminViewOrgId || me.org_id;
    const currentOrg = switcherOrgsCache.find((o) => o.id === current);
    const dealerLabel = currentOrg?.dealer_name || 'Без дилера';
    const sectorId = currentOrg?.sector_id || 'default';
    sw.innerHTML = `
          <div class="field"><label>Дилер</label><select id="swDealer" onchange="switchAdminDealer(this.value)"></select></div>
          <div class="field"><label>Сектор</label><select id="swSector" onchange="switchAdminSector(this.value)"></select></div>
          <div class="field"><label>Сеть</label><select id="swOrg" onchange="switchAdminOrg(this.value)"></select></div>
        `;
    renderSwitcherDealers(dealerLabel);
    renderSwitcherSectors(dealerLabel, sectorId);
    renderSwitcherOrgs(dealerLabel, sectorId, current);
    sw.dataset.loaded = '1';
  } catch (_) {}
}

function renderSwitcherDealers(selectedDealer: string): void {
  const el = document.getElementById('swDealer');
  if (!el) return;
  const dealers = [...switcherHierarchy().keys()].sort();
  el.innerHTML = dealers.map((d) => `<option value="${esc(d)}"${d === selectedDealer ? ' selected' : ''}>${esc(d)}</option>`).join('');
}

function renderSwitcherSectors(dealerLabel: string, selectedSector: string): void {
  const el = document.getElementById('swSector');
  if (!el) return;
  const bySector = switcherHierarchy().get(dealerLabel) || new Map<string, OrgAdminItem[]>();
  const sectors = [...bySector.keys()].sort();
  el.innerHTML = sectors.map((s) => `<option value="${esc(s)}"${s === selectedSector ? ' selected' : ''}>${esc(s)}</option>`).join('');
}

function renderSwitcherOrgs(dealerLabel: string, sectorId: string, selectedOrgId?: string | null): void {
  const el = document.getElementById('swOrg');
  if (!el) return;
  const orgs = (switcherHierarchy().get(dealerLabel) || new Map<string, OrgAdminItem[]>()).get(sectorId) || [];
  el.innerHTML = orgs.map((o) => `<option value="${o.id}"${o.id === selectedOrgId ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
}

// Смена дилера/сектора сама сужает нижние select'ы и сходится на первой
// доступной сети в новой ветке — тот же принцип, что «выбор всё равно одна
// сеть», просто через два промежуточных клика вместо поиска в длинном
// плоском списке.
export function switchAdminDealer(dealerLabel: string): void {
  const bySector = switcherHierarchy().get(dealerLabel) || new Map<string, OrgAdminItem[]>();
  const firstSector = [...bySector.keys()].sort()[0] || 'default';
  renderSwitcherSectors(dealerLabel, firstSector);
  const firstOrg = (bySector.get(firstSector) || [])[0];
  renderSwitcherOrgs(dealerLabel, firstSector, firstOrg?.id);
  if (firstOrg) switchAdminOrg(firstOrg.id);
}

export function switchAdminSector(sectorId: string): void {
  const dealerLabel = (document.getElementById('swDealer') as HTMLSelectElement | null)?.value || '';
  const orgs = (switcherHierarchy().get(dealerLabel) || new Map<string, OrgAdminItem[]>()).get(sectorId) || [];
  renderSwitcherOrgs(dealerLabel, sectorId, orgs[0]?.id);
  if (orgs[0]) switchAdminOrg(orgs[0].id);
}

export function switchAdminOrg(orgId: string): void {
  adminViewOrgId = orgId;
  // Пикеры точек кэшируют список на window.__stores/stores — без сброса
  // после смены сети admin продолжил бы видеть точки прошлой сети.
  window.__stores = null;
  stores = [];
  loadTeam();
}

export async function loadTeam(): Promise<void> {
  const box = document.getElementById('teamList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  const tools = document.getElementById('managerTools');
  if (tools) (tools as HTMLElement).style.display = canManage() ? 'block' : 'none';
  // Тикеты поддержки на бэке намеренно только admin (эскалация к
  // разработчику/платформе, не менеджерский инбокс сети) — кнопка раньше
  // показывалась всем manager/senior и падала на 403.
  const ticketsBtn = document.getElementById('btnSupportTickets');
  if (ticketsBtn) (ticketsBtn as HTMLElement).style.display = canAdmin() ? '' : 'none';
  const netBtn = document.getElementById('btnNetworks');
  if (netBtn) (netBtn as HTMLElement).style.display = canAdmin() ? '' : 'none';
  const auditBtn = document.getElementById('btnAudit');
  if (auditBtn) (auditBtn as HTMLElement).style.display = canAdmin() ? '' : 'none';
  renderOrgSwitcher();
  try {
    const orgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const [emps, sales]: [EmployeeListItem[], SaleRow[]] = await Promise.all([
      window.apiClient.getEmployees(authHeaders(), orgParam),
      window.apiClient.getSales(authHeaders(), todayMoscow(), orgQueryParam())
    ]);
    employees = emps;
    const map: Record<string, { sim: number; phones: number; combo: number; active: boolean }> = {};
    (Array.isArray(sales) ? sales : []).forEach((s) => {
      if (!map[s.employee_id]) map[s.employee_id] = { sim: 0, phones: 0, combo: 0, active: false };
      map[s.employee_id].sim += +(s as any).sim || 0;
      map[s.employee_id].phones += +(s as any).phones || 0;
      map[s.employee_id].combo += +(s as any).combo || 0;
      map[s.employee_id].active = true;
    });
    const list: EmployeeListItem[] = Array.isArray(employees) ? employees : [];
    const myAssignable = canManage() ? assignableRoles(me?.role || '') : [];
    box.innerHTML =
      list
        .map((e) => {
          const st = map[e.id] || { sim: 0, phones: 0, combo: 0, active: false };
          const roleBadge =
            e.role && e.role !== 'employee' && e.role !== 'trainee'
              ? ' · <svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" > <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /> </svg>'
              : '';
          const initial = (e.full_name || '?').trim().charAt(0).toUpperCase();
          // Роли ниже моей и отличные от текущей роли сотрудника — нет
          // смысла предлагать ту же самую.
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
        })
        .join('') || '<div class="empty">🍉 В команде пока никого нет</div>';
    list.forEach((e) => applyAvatarImg('ta-' + e.id, e.id));
    lastTeamList = list;
    lastTeamMap = map;
    renderTeamTable(lastTeamList, lastTeamMap);
  } catch {
    box.innerHTML = '<div class="empty">🍉 Не получилось загрузить команду, зайди чуть позже</div>';
  }
}

// ===== Desktop data-table (20.42) — тот же list/map, что #teamList выше,
// без своей фильтрации и без своего запроса. =====
function renderTeamTable(list: EmployeeListItem[], map: Record<string, { sim: number; phones: number; combo: number; active: boolean }>): void {
  const tbody = document.getElementById('teamTableBody');
  if (!tbody) return;
  const sorted = [...list].sort((a, b) => {
    let cmp = 0;
    switch (teamSort.key) {
      case 'name':
        cmp = (a.full_name || '').localeCompare(b.full_name || '', 'ru');
        break;
      case 'role':
        cmp = roleLabel(a.role || '').localeCompare(roleLabel(b.role || ''), 'ru');
        break;
      case 'sim':
        cmp = (map[a.id]?.sim || 0) - (map[b.id]?.sim || 0);
        break;
      case 'combo':
        cmp = (map[a.id]?.combo || 0) - (map[b.id]?.combo || 0);
        break;
      case 'phones':
        cmp = (map[a.id]?.phones || 0) - (map[b.id]?.phones || 0);
        break;
    }
    return cmp * teamSort.dir;
  });
  const myAssignable = canManage() ? assignableRoles(me?.role || '') : [];
  tbody.innerHTML = sorted.length
    ? sorted
        .map((e) => {
          const st = map[e.id] || { sim: 0, phones: 0, combo: 0, active: false };
          const initial = (e.full_name || '?').trim().charAt(0).toUpperCase();
          const roleBtns = myAssignable.filter((r) => r !== e.role);
          const actionsCell = canManage()
            ? `<td class="actions">
                ${roleBtns.map((r) => `<button class="mchip" onclick="event.stopPropagation();setRole(${e.id},'${r}')">${roleLabel(r)}</button>`).join('')}
                <button class="mchip" style="color:var(--danger)" onclick="event.stopPropagation();removeEmployee(${e.id})">Удалить</button>
              </td>`
            : '<td class="actions"></td>';
          return `
            <tr onclick="openTeamRow(event, ${e.id})">
              <td><div class="dt-name"><div class="team-avatar${st.active ? ' active' : ''}" id="tta-${e.id}">${initial}</div><span>${esc(e.full_name)}</span></div></td>
              <td>${esc(roleLabel(e.role))}</td>
              <td>${st.sim}</td>
              <td>${st.combo}</td>
              <td>${st.phones}</td>
              <td>${st.active ? 'Активен сегодня' : '—'}</td>
              ${actionsCell}
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="empty">🍉 В команде пока никого нет</td></tr>';
  sorted.forEach((e) => applyAvatarImg('tta-' + e.id, e.id));
  document.querySelectorAll('#teamTable thead th[data-sort-key]').forEach((th) => {
    const key = (th as HTMLElement).dataset.sortKey;
    th.setAttribute('aria-sort', key === teamSort.key ? (teamSort.dir === 1 ? 'ascending' : 'descending') : 'none');
  });
}

export function sortTeamTable(key: string): void {
  teamSort = teamSort.key === key ? { key, dir: teamSort.dir === 1 ? -1 : 1 } : { key, dir: 1 };
  renderTeamTable(lastTeamList, lastTeamMap);
}

// Клик где угодно внутри ячейки действий (не только по самой .mchip) не
// должен переходить по строке — closest('td.actions'), не точечный
// stopPropagation на каждой кнопке.
export function openTeamRow(event: MouseEvent, id: number): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest('td.actions')) return;
  if (typeof canViewAnalytics === 'function' && canViewAnalytics()) {
    window.openEmployeeProfile(id);
  } else {
    openEmployeeCard(id);
  }
}

// ===== Employee card =====
export async function openEmployeeCard(id: number): Promise<void> {
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  if (modalTitle) modalTitle.textContent = 'Сотрудник';
  if (modalBody) modalBody.innerHTML = '<div class="empty">Загрузка…</div>';
  document.getElementById('overlay')?.classList.add('show');

  try {
    // Карточка сотрудника открывается и при просмотре чужой сети
    // (переключатель у admin) — без org_id все три запроса тихо
    // резолвились в СВОЮ сеть admin'а, а не в ту, что он смотрит.
    const orgParam = me?.role === 'admin' && adminViewOrgId ? '?org_id=' + encodeURIComponent(adminViewOrgId) : '';
    const [emps, sales, schedules]: [EmployeeListItem[], SaleRow[], ScheduleRow[]] = await Promise.all([
      window.apiClient.getEmployees(authHeaders(), orgParam),
      window.apiClient.getSales(authHeaders(), todayMoscow(), orgQueryParam()),
      window.apiClient.getSchedules(authHeaders(), todayMoscow(), orgQueryParam())
    ]);
    const emp = (emps || []).find((e) => String(e.id) === String(id));
    const sale = (sales || []).find((s) => String(s.employee_id) === String(id));
    const sch = (schedules || []).find((s) => String(s.employee_id) === String(id));

    const saleMetrics = ['sim', 'mnp', 'pa', 'combo', 'phones', 'accessories', 'wink', 'shpd'];
    // manager/admin может отменить ошибочно внесённую метрику за сегодня —
    // sales аддитивные, отдельной "продажи" для удаления нет, поэтому это
    // обнуление конкретного показателя, не всей записи за день.
    const nonZero = sale ? saleMetrics.filter((key) => Number((sale as any)[key]) > 0) : [];
    const correctionBlock =
      canManage() && sale && nonZero.length
        ? `<div class="block-label">Исправить ошибочный ввод</div>
             <div class="progress-block" style="display:flex;flex-direction:column;gap:8px">
               ${nonZero
                 .map(
                   (key) => `
                 <div style="display:flex;justify-content:space-between;align-items:center">
                   <span style="font-size:14px">${metricLabel(key)}: <b>${Number((sale as any)[key])}</b></span>
                   <button class="mchip" style="color:var(--danger)" onclick="zeroSaleMetric(${sale.id},'${key}',${id})">Удалить</button>
                 </div>`
                 )
                 .join('')}
             </div>`
        : '';

    if (modalTitle) modalTitle.textContent = emp?.full_name || 'Сотрудник';
    if (modalBody) {
      modalBody.innerHTML = `
          ${
            typeof canViewAnalytics === 'function' && canViewAnalytics()
              ? `<button class="btn-ghost" style="width:100%;margin-bottom:12px" onclick="closeModal();openEmployeeProfile(${id})">Профиль →</button>`
              : ''
          }
          <div class="field">
            <label>Смена сегодня</label>
            <div style="font-size:15px;font-weight:600">
              ${sch ? `${sch.store_name || sch.store_id} · ${sch.shift_text || ''} (${sch.hours || ''}ч)` : 'Выходной / нет в графике'}
            </div>
          </div>
          <div class="block-label">Продажи сегодня</div>
          <div class="progress-block">
            ${saleMetrics.map((key) => progressHTML(metricLabel(key), (sale as any)?.[key], 0)).join('')}
          </div>
          ${correctionBlock}
          <button class="btn-main" onclick="openAddSale(${id})">Добавить продажу</button>
        `;
    }
  } catch (e) {
    const modalBody2 = document.getElementById('modalBody');
    if (modalBody2) modalBody2.innerHTML = '<div class="empty">Ошибка</div>';
  }
}

export async function zeroSaleMetric(saleId: number, metric: string, employeeId: number): Promise<void> {
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

export async function setRole(id: number, role: string): Promise<void> {
  if (!canManage()) return;
  try {
    await window.apiClient.setEmployeeRole(authHeaders(true), id, role);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Роль: ' + roleLabel(role), 'ok');
  loadTeam();
}

export async function removeEmployee(id: number): Promise<void> {
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

export function openAddEmployee(): void {
  if (!canManage()) return;
  const roles = assignableRoles(me?.role || '');
  const options = (roles.length ? roles : ['employee']).map((r) => `<option value="${r}"${r === 'employee' ? ' selected' : ''}>${roleLabel(r)}</option>`).join('');
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Новый сотрудник';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
        <div class="field"><label>ФИО</label><input id="ne_name" placeholder="Иванов Иван Иванович"></div>
        <div class="field"><label>Роль</label>
          <select id="ne_role">${options}</select>
        </div>
        <button class="btn-main" onclick="saveNewEmployee()">Создать</button>
      `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function saveNewEmployee(): Promise<void> {
  const full_name = (document.getElementById('ne_name') as HTMLInputElement | null)?.value.trim() || '';
  const role = (document.getElementById('ne_role') as HTMLSelectElement | null)?.value || '';
  if (!full_name) {
    toast('Укажите ФИО', 'err');
    return;
  }
  const body: { full_name: string; role: string; org_id?: string } = { full_name, role };
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

export function openAddStore(): void {
  if (!canManage()) return;
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Новая точка';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
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
  }
  document.querySelector('.sheet-modal')?.classList.add('modal-md');
  document.getElementById('overlay')?.classList.add('show');
}

export function toggle24hStore(): void {
  const on = (document.getElementById('ns_24h') as HTMLInputElement | null)?.checked || false;
  const wt = document.getElementById('ns_work_time') as HTMLInputElement | null;
  const hrs = document.getElementById('ns_hours') as HTMLInputElement | null;
  if (wt) {
    wt.value = on ? 'круглосуточно' : '10-21';
    wt.disabled = on;
  }
  if (hrs) {
    hrs.value = String(on ? 24 : 11);
    hrs.disabled = on;
  }
}

export async function saveNewStore(): Promise<void> {
  const id = (document.getElementById('ns_id') as HTMLInputElement | null)?.value.trim() || '';
  const name = (document.getElementById('ns_name') as HTMLInputElement | null)?.value.trim() || '';
  const code = (document.getElementById('ns_code') as HTMLInputElement | null)?.value.trim() || '';
  const color = (document.getElementById('ns_color') as HTMLInputElement | null)?.value.trim() || '';
  const work_time = (document.getElementById('ns_work_time') as HTMLInputElement | null)?.value.trim() || '';
  const hours = Number((document.getElementById('ns_hours') as HTMLInputElement | null)?.value) || 11;
  const close_time = (document.getElementById('ns_close_time') as HTMLInputElement | null)?.value.trim() || '';
  if (!id || !name) {
    toast('ID и название обязательны', 'err');
    return;
  }
  const body: CreateStoreRequest = {
    id,
    name,
    code,
    color,
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

declare global {
  interface Window {
    renderOrgSwitcher: typeof renderOrgSwitcher;
    switchAdminDealer: typeof switchAdminDealer;
    switchAdminSector: typeof switchAdminSector;
    switchAdminOrg: typeof switchAdminOrg;
    loadTeam: typeof loadTeam;
    openEmployeeCard: typeof openEmployeeCard;
    zeroSaleMetric: typeof zeroSaleMetric;
    setRole: typeof setRole;
    removeEmployee: typeof removeEmployee;
    openAddEmployee: typeof openAddEmployee;
    saveNewEmployee: typeof saveNewEmployee;
    openAddStore: typeof openAddStore;
    toggle24hStore: typeof toggle24hStore;
    saveNewStore: typeof saveNewStore;
    sortTeamTable: typeof sortTeamTable;
    openTeamRow: typeof openTeamRow;
  }
}
window.renderOrgSwitcher = renderOrgSwitcher;
window.switchAdminDealer = switchAdminDealer;
window.switchAdminSector = switchAdminSector;
window.switchAdminOrg = switchAdminOrg;
window.loadTeam = loadTeam;
window.openEmployeeCard = openEmployeeCard;
window.zeroSaleMetric = zeroSaleMetric;
window.setRole = setRole;
window.removeEmployee = removeEmployee;
window.openAddEmployee = openAddEmployee;
window.saveNewEmployee = saveNewEmployee;
window.openAddStore = openAddStore;
window.toggle24hStore = toggle24hStore;
window.saveNewStore = saveNewStore;
window.sortTeamTable = sortTeamTable;
window.openTeamRow = openTeamRow;
