/**
 * Admin Control Center — "Устройства Miranda" (Этап A плана, §3/§8 Stage 3).
 * Две независимые секции: (1) очередь подтверждения устройств
 * (approve требует свежего step-up, revoke — нет, см. api/routes/miranda/
 * devices.ts), (2) выдача гранта на временное переключение корпоративного
 * аккаунта (§3.5 — права на переключение это данные, не роль). Поиск
 * сотрудника-админа для гранта — тот же /admin/search, что уже использует
 * вкладка "Сотрудники" (нет и не планируется bulk-листинга сотрудников).
 */
import { requestStepUpTicket } from './shared/dialogs.js';
import type { MirandaPendingBindingRow, MirandaCorporateAccountListItem } from '../../../../src/shared/api-types.js';

let grantAdminSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let selectedGrantAdminId: number | null = null;

export function renderMirandaDevicesTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="section">
      <div class="section-title">Устройства Miranda — очередь подтверждения</div>
      <div id="mirandaPendingList"></div>
    </div>
    <div class="section">
      <div class="section-title">Корпоративные аккаунты — привязка к устройству</div>
      <div class="row-sub" style="padding:0 16px 8px">
        Аккаунты точки/кассы помечаются как «только одно устройство» —
        подтвердить второе одновременно активное устройство для такого
        аккаунта нельзя, пока не отозвать прежнее. Личные аккаунты
        сотрудника можно не ограничивать — он может работать с нескольких
        компьютеров.
      </div>
      <div id="mirandaAccountsList"></div>
    </div>
    <div class="section">
      <div class="section-title">Переключение аккаунтов — выдача гранта</div>
      <div style="padding:0 16px 8px;display:flex;flex-direction:column;gap:8px">
        <div>
          <input type="text" id="mirandaGrantAdminSearch" placeholder="Админ, которому выдать грант — поиск по имени" style="width:100%;box-sizing:border-box">
          <div id="mirandaGrantAdminResults"></div>
          <div id="mirandaGrantAdminSelected" class="row-sub" style="padding:4px 0"></div>
        </div>
        <select id="mirandaGrantAccountSelect" style="width:100%;box-sizing:border-box"></select>
        <button type="button" class="btn-main" id="mirandaGrantBtn" style="align-self:flex-start">Выдать грант</button>
      </div>
      <div class="section-title">Доступные вам аккаунты для переключения</div>
      <div id="mirandaAvailableList"></div>
    </div>
  `;

  document.getElementById('mirandaPendingList')?.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-miranda-approve],[data-miranda-revoke]');
    if (!btn) return;
    if (btn.dataset.mirandaApprove !== undefined) onApprove(Number(btn.dataset.mirandaApprove));
    if (btn.dataset.mirandaRevoke !== undefined) onRevoke(Number(btn.dataset.mirandaRevoke));
  });

  const searchInput = document.getElementById('mirandaGrantAdminSearch') as HTMLInputElement | null;
  searchInput?.addEventListener('input', () => {
    if (grantAdminSearchDebounce) clearTimeout(grantAdminSearchDebounce);
    grantAdminSearchDebounce = setTimeout(() => runGrantAdminSearch(searchInput.value), 250);
  });
  document.getElementById('mirandaGrantAdminResults')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-grant-admin-id]');
    if (!row?.dataset.grantAdminId) return;
    selectedGrantAdminId = Number(row.dataset.grantAdminId);
    document.getElementById('mirandaGrantAdminResults')!.innerHTML = '';
    document.getElementById('mirandaGrantAdminSelected')!.textContent = `Выбран: ${row.dataset.grantAdminName || ''} (#${selectedGrantAdminId})`;
    if (searchInput) searchInput.value = '';
  });

  document.getElementById('mirandaGrantBtn')?.addEventListener('click', onGrant);

  document.getElementById('mirandaAccountsList')?.addEventListener('change', (e) => {
    const checkbox = e.target as HTMLInputElement | null;
    if (!checkbox?.dataset.mirandaDeviceExclusive) return;
    onToggleDeviceExclusive(Number(checkbox.dataset.mirandaDeviceExclusive), checkbox.checked);
  });

  loadPending();
  loadCorporateAccounts();
  loadAvailableAccounts();
}

async function loadPending(): Promise<void> {
  const box = document.getElementById('mirandaPendingList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminListMirandaDevices(authHeaders());
    renderPendingList(box, res.items);
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить очередь устройств</div>';
  }
}

function renderPendingList(box: HTMLElement, items: MirandaPendingBindingRow[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">Нет устройств, ожидающих подтверждения</div>';
    return;
  }
  box.innerHTML = items
    .map(
      (i) => `
      <div class="row" style="cursor:default">
        <div class="row-body">
          <div class="row-title">${esc(i.employee_full_name)} · ${esc(i.platform)}${i.device_label ? ' · ' + esc(i.device_label) : ''}</div>
          <div class="row-sub">${esc(i.store_id || 'без точки')} · заявка от ${esc(new Date(i.created_at).toLocaleString('ru-RU'))}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn-main" data-miranda-approve="${i.binding_id}">Подтвердить</button>
          <button type="button" class="btn-ghost" data-miranda-revoke="${i.binding_id}">Отклонить</button>
        </div>
      </div>`
    )
    .join('');
}

async function onApprove(bindingId: number): Promise<void> {
  const ticket = await requestStepUpTicket();
  if (!ticket) return;
  try {
    await window.apiClient.adminApproveMirandaDevice(authHeaders(true), bindingId, ticket);
    toast('Устройство подтверждено', 'ok');
    loadPending();
  } catch (e) {
    const code = (e as { code?: string } | undefined)?.code;
    toast(
      code === 'device_exclusive_conflict'
        ? 'Этот аккаунт уже привязан к другому устройству — сначала отозвать прежнюю привязку'
        : 'Не удалось подтвердить устройство',
      'err'
    );
  }
}

async function onRevoke(bindingId: number): Promise<void> {
  try {
    await window.apiClient.adminRevokeMirandaDevice(authHeaders(), bindingId);
    toast('Привязка отклонена', 'ok');
    loadPending();
  } catch (e) {
    toast('Не удалось отклонить привязку', 'err');
  }
}

async function runGrantAdminSearch(term: string): Promise<void> {
  const box = document.getElementById('mirandaGrantAdminResults');
  if (!box) return;
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    box.innerHTML = '';
    return;
  }
  try {
    const res = await window.apiClient.adminSearch(authHeaders(), trimmed, orgQueryParam());
    if (!res.employees.length) {
      box.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    box.innerHTML = res.employees
      .map(
        (emp) => `
        <button class="row" type="button" data-grant-admin-id="${emp.id}" data-grant-admin-name="${esc(emp.full_name)}">
          <div class="row-body">
            <div class="row-title">${esc(emp.full_name)}</div>
            <div class="row-sub">${esc(emp.role)}</div>
          </div>
        </button>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Ошибка поиска</div>';
  }
}

async function loadCorporateAccounts(): Promise<void> {
  const select = document.getElementById('mirandaGrantAccountSelect') as HTMLSelectElement | null;
  const list = document.getElementById('mirandaAccountsList');
  if (list) list.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminListMirandaCorporateAccounts(authHeaders());
    if (select) renderAccountOptions(select, res.items);
    if (list) renderAccountsList(list, res.items);
  } catch (e) {
    console.error(e);
    if (select) select.innerHTML = '<option value="">Не удалось загрузить аккаунты</option>';
    if (list) list.innerHTML = '<div class="empty">Не удалось загрузить аккаунты</div>';
  }
}

function renderAccountsList(box: HTMLElement, items: MirandaCorporateAccountListItem[]): void {
  if (!items.length) {
    box.innerHTML = '<div class="empty">Корпоративных аккаунтов пока нет</div>';
    return;
  }
  box.innerHTML = items
    .map((a) => {
      const label = a.display_label || `${a.employee_full_name} · ${a.store_id || 'без точки'}`;
      return `
      <div class="row" style="cursor:default">
        <div class="row-body">
          <div class="row-title">${esc(label)}</div>
          <div class="row-sub">${esc(a.store_id || 'без точки')}</div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          <input type="checkbox" data-miranda-device-exclusive="${a.corporate_account_id}" ${a.device_exclusive ? 'checked' : ''}>
          только одно устройство
        </label>
      </div>`;
    })
    .join('');
}

async function onToggleDeviceExclusive(corporateAccountId: number, deviceExclusive: boolean): Promise<void> {
  try {
    await window.apiClient.adminSetMirandaAccountDeviceExclusive(authHeaders(), corporateAccountId, deviceExclusive);
    toast(deviceExclusive ? 'Аккаунт теперь привязывается только к одному устройству' : 'Ограничение снято', 'ok');
  } catch (e) {
    toast('Не удалось изменить настройку', 'err');
    loadCorporateAccounts();
  }
}

function renderAccountOptions(select: HTMLSelectElement, items: MirandaCorporateAccountListItem[]): void {
  if (!items.length) {
    select.innerHTML = '<option value="">Корпоративных аккаунтов пока нет</option>';
    return;
  }
  select.innerHTML = items
    .map((a) => {
      const label = a.display_label || `${a.employee_full_name} · ${a.store_id || 'без точки'}`;
      return `<option value="${a.corporate_account_id}">${esc(label)}</option>`;
    })
    .join('');
}

async function onGrant(): Promise<void> {
  const select = document.getElementById('mirandaGrantAccountSelect') as HTMLSelectElement | null;
  const corporateAccountId = Number(select?.value || '');
  if (!selectedGrantAdminId) {
    toast('Выберите администратора', 'err');
    return;
  }
  if (!corporateAccountId) {
    toast('Выберите корпоративный аккаунт', 'err');
    return;
  }
  try {
    await window.apiClient.adminGrantMirandaAccount(authHeaders(), selectedGrantAdminId, corporateAccountId);
    toast('Грант выдан', 'ok');
    loadAvailableAccounts();
  } catch (e) {
    toast('Не удалось выдать грант', 'err');
  }
}

async function loadAvailableAccounts(): Promise<void> {
  const box = document.getElementById('mirandaAvailableList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminListMirandaAvailableAccounts(authHeaders());
    if (!res.items.length) {
      box.innerHTML = '<div class="empty">Вам не выдано ни одного гранта на переключение</div>';
      return;
    }
    box.innerHTML = res.items
      .map(
        (a) => `
        <div class="row" style="cursor:default">
          <div class="row-body">
            <div class="row-title">${esc(a.display_label || a.employee_full_name)}</div>
            <div class="row-sub">${esc(a.store_id || 'без точки')}${a.is_default_for_device ? ' · по умолчанию на этом устройстве' : ''}</div>
          </div>
        </div>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    box.innerHTML = '<div class="empty">Не удалось загрузить список</div>';
  }
}
