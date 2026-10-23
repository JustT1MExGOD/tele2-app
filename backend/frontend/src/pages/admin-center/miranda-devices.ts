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
import type { MirandaPendingBindingRow, MirandaCorporateAccountListItem, MirandaContactGroup } from '../../../../src/shared/api-types.js';

let grantAdminSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let selectedGrantAdminId: number | null = null;
let createAccountSearchDebounce: ReturnType<typeof setTimeout> | null = null;
let selectedCreateEmployeeId: number | null = null;
// Аккаунт, выбранный в списке «Корпоративные аккаунты» — целевой для
// «+»-кнопок в секции «Группы контактов» (членство группы пишется именно
// на corporateAccountId, не employee_id). Сбрасывается на null при
// перезагрузке списка аккаунтов, если строки больше нет.
let selectedGroupAccountId: number | null = null;
let lastAccountsList: MirandaCorporateAccountListItem[] = [];

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
      <div style="padding:0 16px 12px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:16px">
          <label style="display:flex;align-items:center;gap:6px">
            <input type="radio" name="mirandaCreateAccountKind" id="mirandaCreateAccountKindPersonal" value="personal" checked>
            Личный аккаунт
          </label>
          <label style="display:flex;align-items:center;gap:6px">
            <input type="radio" name="mirandaCreateAccountKind" id="mirandaCreateAccountKindPoint" value="point">
            Аккаунт точки
          </label>
        </div>
        <div id="mirandaCreateAccountPersonalFields">
          <div>
            <input type="text" id="mirandaCreateAccountSearch" placeholder="Сотрудник для нового аккаунта — поиск по имени" style="width:100%;box-sizing:border-box">
            <div id="mirandaCreateAccountResults"></div>
            <div id="mirandaCreateAccountSelected" class="row-sub" style="padding:4px 0"></div>
          </div>
          <input type="text" id="mirandaCreateAccountLabel" placeholder="Название аккаунта (необязательно)" style="width:100%;box-sizing:border-box;margin-top:8px">
        </div>
        <div id="mirandaCreateAccountPointFields" style="display:none;flex-direction:column;gap:8px">
          <input type="text" id="mirandaCreateAccountPhone" placeholder="Телефон точки (например, +79991234567)" style="width:100%;box-sizing:border-box">
          <input type="password" id="mirandaCreateAccountPassword" placeholder="Пароль (минимум 8 символов)" style="width:100%;box-sizing:border-box">
          <input type="text" id="mirandaCreateAccountName" placeholder="Название аккаунта (например, «Касса Космонавтов 20А»)" style="width:100%;box-sizing:border-box">
        </div>
        <input type="text" id="mirandaCreateAccountStoreId" placeholder="ID точки (необязательно)" style="width:100%;box-sizing:border-box">
        <button type="button" class="btn-main" id="mirandaCreateAccountBtn" style="align-self:flex-start">Создать аккаунт</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;padding:0 16px 8px">
        <input type="checkbox" id="mirandaShowInactive">
        Показывать деактивированные
      </label>
      <div id="mirandaAccountsList"></div>
    </div>
    <div class="section">
      <div class="section-title">Группы контактов Miranda</div>
      <div class="row-sub" style="padding:0 16px 8px">
        Общие для всего дилера: группировка дерева контактов в приложении Miranda.
        Членство назначается корпоративному аккаунту (не employee_id напрямую) —
        выберите аккаунт из списка выше и нажмите «+» рядом с группой.
      </div>
      <div style="padding:0 16px 12px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="mirandaNewGroupName" placeholder="Название новой группы" style="flex:1;min-width:220px;box-sizing:border-box">
        <button type="button" class="btn-main" id="mirandaCreateGroupBtn">Создать группу</button>
      </div>
      <div id="mirandaGroupsList"></div>
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

  const createSearchInput = document.getElementById('mirandaCreateAccountSearch') as HTMLInputElement | null;
  createSearchInput?.addEventListener('input', () => {
    if (createAccountSearchDebounce) clearTimeout(createAccountSearchDebounce);
    createAccountSearchDebounce = setTimeout(() => runCreateAccountSearch(createSearchInput.value), 250);
  });
  document.getElementById('mirandaCreateAccountResults')?.addEventListener('click', (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-create-employee-id]');
    if (!row?.dataset.createEmployeeId) return;
    selectedCreateEmployeeId = Number(row.dataset.createEmployeeId);
    document.getElementById('mirandaCreateAccountResults')!.innerHTML = '';
    document.getElementById('mirandaCreateAccountSelected')!.textContent = `Выбран: ${row.dataset.createEmployeeName || ''} (#${selectedCreateEmployeeId})`;
    if (createSearchInput) createSearchInput.value = '';
  });
  document.getElementById('mirandaCreateAccountBtn')?.addEventListener('click', onCreateAccount);

  document.querySelectorAll<HTMLInputElement>('input[name="mirandaCreateAccountKind"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isPoint = (document.getElementById('mirandaCreateAccountKindPoint') as HTMLInputElement | null)?.checked;
      document.getElementById('mirandaCreateAccountPersonalFields')!.style.display = isPoint ? 'none' : '';
      document.getElementById('mirandaCreateAccountPointFields')!.style.display = isPoint ? 'flex' : 'none';
    });
  });

  document.getElementById('mirandaAccountsList')?.addEventListener('change', (e) => {
    const checkbox = e.target as HTMLInputElement | null;
    if (!checkbox?.dataset.mirandaDeviceExclusive) return;
    onToggleDeviceExclusive(Number(checkbox.dataset.mirandaDeviceExclusive), checkbox.checked);
  });

  document.getElementById('mirandaAccountsList')?.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-miranda-deactivate],[data-miranda-reactivate],[data-miranda-rename],[data-miranda-select]');
    if (!btn) return;
    if (btn.dataset.mirandaDeactivate !== undefined) onDeactivateAccount(Number(btn.dataset.mirandaDeactivate));
    if (btn.dataset.mirandaReactivate !== undefined) onReactivateAccount(Number(btn.dataset.mirandaReactivate));
    if (btn.dataset.mirandaRename !== undefined) onRenameAccount(Number(btn.dataset.mirandaRename), btn.dataset.mirandaRenameCurrent || null);
    if (btn.dataset.mirandaSelect !== undefined) onSelectGroupAccount(Number(btn.dataset.mirandaSelect));
  });

  document.getElementById('mirandaShowInactive')?.addEventListener('change', () => loadCorporateAccounts());

  document.getElementById('mirandaCreateGroupBtn')?.addEventListener('click', onCreateGroup);
  document.getElementById('mirandaGroupsList')?.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-group-rename],[data-group-delete],[data-group-add-member],[data-group-remove-member]');
    if (!btn) return;
    if (btn.dataset.groupRename !== undefined) onRenameGroup(Number(btn.dataset.groupRename), btn.dataset.groupNameCurrent || '');
    if (btn.dataset.groupDelete !== undefined) onDeleteGroup(Number(btn.dataset.groupDelete), btn.dataset.groupNameCurrent || '');
    if (btn.dataset.groupAddMember !== undefined) onAddGroupMember(Number(btn.dataset.groupAddMember));
    if (btn.dataset.groupRemoveMember !== undefined) onRemoveGroupMember(Number(btn.dataset.groupRemoveMember), Number(btn.dataset.memberId));
  });

  loadPending();
  loadCorporateAccounts();
  loadAvailableAccounts();
  loadContactGroups();
}

async function loadPending(): Promise<void> {
  const box = document.getElementById('mirandaPendingList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminListMirandaDevices(authHeaders(), orgQueryParam());
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
  const includeInactive = (document.getElementById('mirandaShowInactive') as HTMLInputElement | null)?.checked || false;
  if (list) list.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminListMirandaCorporateAccounts(authHeaders(), includeInactive, orgQueryParam());
    lastAccountsList = res.items;
    // Сброс выбора, если ранее выбранный аккаунт больше не отображается
    // (деактивирован и скрыт фильтром "Показывать деактивированные").
    if (selectedGroupAccountId && !res.items.some((a) => a.corporate_account_id === selectedGroupAccountId)) {
      selectedGroupAccountId = null;
    }
    // грант на переключение имеет смысл только на активный аккаунт —
    // деактивированные остаются в списке выше для возможной реактивации,
    // но не засоряют выпадающий список здесь.
    if (select) renderAccountOptions(select, res.items.filter((a) => a.is_active));
    if (list) renderAccountsList(list, res.items);
  } catch (e) {
    console.error(e);
    if (select) select.innerHTML = '<option value="">Не удалось загрузить аккаунты</option>';
    if (list) list.innerHTML = '<div class="empty">Не удалось загрузить аккаунты</div>';
  }
}

async function runCreateAccountSearch(term: string): Promise<void> {
  const box = document.getElementById('mirandaCreateAccountResults');
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
        <button class="row" type="button" data-create-employee-id="${emp.id}" data-create-employee-name="${esc(emp.full_name)}">
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

async function onCreateAccount(): Promise<void> {
  const storeIdInput = document.getElementById('mirandaCreateAccountStoreId') as HTMLInputElement | null;
  const storeId = storeIdInput?.value.trim() || null;
  const isPoint = (document.getElementById('mirandaCreateAccountKindPoint') as HTMLInputElement | null)?.checked;

  if (isPoint) {
    const phoneInput = document.getElementById('mirandaCreateAccountPhone') as HTMLInputElement | null;
    const passwordInput = document.getElementById('mirandaCreateAccountPassword') as HTMLInputElement | null;
    const nameInput = document.getElementById('mirandaCreateAccountName') as HTMLInputElement | null;
    const phone = phoneInput?.value.trim() || '';
    const password = passwordInput?.value || '';
    const accountName = nameInput?.value.trim() || '';
    if (!phone || !password || !accountName) {
      toast('Заполните телефон, пароль и название аккаунта', 'err');
      return;
    }
    try {
      await window.apiClient.adminCreateMirandaPointAccount(authHeaders(true), phone, password, accountName, storeId);
      toast('Аккаунт точки создан', 'ok');
      if (phoneInput) phoneInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (nameInput) nameInput.value = '';
      if (storeIdInput) storeIdInput.value = '';
      loadCorporateAccounts();
    } catch (e) {
      const code = (e as { code?: string } | undefined)?.code;
      toast(code === 'phone_conflict' ? 'Аккаунт с таким телефоном уже существует в вашей сети' : 'Не удалось создать аккаунт', 'err');
    }
    return;
  }

  if (!selectedCreateEmployeeId) {
    toast('Выберите сотрудника', 'err');
    return;
  }
  const labelInput = document.getElementById('mirandaCreateAccountLabel') as HTMLInputElement | null;
  const displayLabel = labelInput?.value.trim() || null;
  try {
    await window.apiClient.adminCreateMirandaAccount(authHeaders(true), selectedCreateEmployeeId, storeId, displayLabel);
    toast('Корпоративный аккаунт создан', 'ok');
    selectedCreateEmployeeId = null;
    document.getElementById('mirandaCreateAccountSelected')!.textContent = '';
    if (storeIdInput) storeIdInput.value = '';
    if (labelInput) labelInput.value = '';
    loadCorporateAccounts();
  } catch (e) {
    const code = (e as { code?: string } | undefined)?.code;
    toast(code === 'conflict' ? 'Такой аккаунт уже существует (этот сотрудник + точка)' : 'Не удалось создать аккаунт', 'err');
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
          <div class="row-title">${esc(label)}${a.is_active ? '' : ' · деактивирован'}</div>
          <div class="row-sub">${esc(a.store_id || 'без точки')}</div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          <input type="checkbox" data-miranda-device-exclusive="${a.corporate_account_id}" ${a.device_exclusive ? 'checked' : ''} ${a.is_active ? '' : 'disabled'}>
          только одно устройство
        </label>
        <button type="button" class="mchip" data-miranda-select="${a.corporate_account_id}" ${a.corporate_account_id === selectedGroupAccountId ? 'disabled' : ''}>${a.corporate_account_id === selectedGroupAccountId ? 'Выбран для групп' : 'В группу'}</button>
        <button type="button" class="mchip" data-miranda-rename="${a.corporate_account_id}" data-miranda-rename-current="${esc(a.display_label || '')}">Переименовать</button>
        ${a.is_active
          ? `<button type="button" class="mchip" data-miranda-deactivate="${a.corporate_account_id}">Деактивировать</button>`
          : `<button type="button" class="mchip" data-miranda-reactivate="${a.corporate_account_id}">Восстановить</button>`}
      </div>`;
    })
    .join('');
}

async function onToggleDeviceExclusive(corporateAccountId: number, deviceExclusive: boolean): Promise<void> {
  try {
    await window.apiClient.adminSetMirandaAccountDeviceExclusive(authHeaders(true), corporateAccountId, deviceExclusive);
    toast(deviceExclusive ? 'Аккаунт теперь привязывается только к одному устройству' : 'Ограничение снято', 'ok');
  } catch (e) {
    toast('Не удалось изменить настройку', 'err');
    loadCorporateAccounts();
  }
}

async function onDeactivateAccount(corporateAccountId: number): Promise<void> {
  try {
    await window.apiClient.adminDeactivateMirandaAccount(authHeaders(true), corporateAccountId);
    toast('Аккаунт деактивирован', 'ok');
    loadCorporateAccounts();
  } catch (e) {
    toast('Не удалось деактивировать аккаунт', 'err');
  }
}

async function onReactivateAccount(corporateAccountId: number): Promise<void> {
  try {
    await window.apiClient.adminReactivateMirandaAccount(authHeaders(true), corporateAccountId);
    toast('Аккаунт восстановлен', 'ok');
    loadCorporateAccounts();
  } catch (e) {
    toast('Не удалось восстановить аккаунт', 'err');
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
    await window.apiClient.adminGrantMirandaAccount(authHeaders(true), selectedGrantAdminId, corporateAccountId);
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

// ---------- Группы контактов (общие для дилера) ----------

function onSelectGroupAccount(corporateAccountId: number): void {
  selectedGroupAccountId = selectedGroupAccountId === corporateAccountId ? null : corporateAccountId;
  const list = document.getElementById('mirandaAccountsList');
  if (list) renderAccountsList(list, lastAccountsList);
  renderContactGroups();
}

async function loadContactGroups(): Promise<void> {
  const box = document.getElementById('mirandaGroupsList');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const res = await window.apiClient.adminListMirandaGroups(authHeaders(), orgQueryParam());
    cachedGroups = res.items;
    renderContactGroups();
  } catch (e) {
    console.error(e);
    cachedGroups = [];
    box.innerHTML = '<div class="empty">Не удалось загрузить группы</div>';
  }
}

let cachedGroups: MirandaContactGroup[] = [];

function renderContactGroups(): void {
  const box = document.getElementById('mirandaGroupsList');
  if (!box) return;
  if (!cachedGroups.length) {
    box.innerHTML = '<div class="empty">Групп пока нет — создайте первую выше</div>';
    return;
  }
  const accountById = new Map(lastAccountsList.map((a) => [a.corporate_account_id, a]));
  box.innerHTML = cachedGroups
    .map((g) => {
      const members = g.member_corporate_account_ids
        .map((id) => accountById.get(id))
        .filter((a): a is MirandaCorporateAccountListItem => !!a);
      const memberChips = members
        .map(
          (a) => `<span class="mchip" style="display:inline-flex;align-items:center;gap:4px">${esc(a.display_label || a.employee_full_name)}
            <button type="button" class="mchip" data-group-remove-member="${g.id}" data-member-id="${a.corporate_account_id}" title="Убрать из группы">×</button>
          </span>`
        )
        .join(' ');
      return `
      <div class="row" style="cursor:default">
        <div class="row-body">
          <div class="row-title">${esc(g.name)}${g.parent_group_id ? ' · вложенная' : ''}</div>
          <div class="row-sub">${esc(g.org_id)} · ${members.length ? members.length + ' контакт(ов)' : 'пустая'}</div>
          ${memberChips ? `<div style="padding-top:6px;display:flex;flex-wrap:wrap;gap:6px">${memberChips}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="mchip" data-group-add-member="${g.id}" ${selectedGroupAccountId ? '' : 'disabled'} title="${selectedGroupAccountId ? 'Добавить выбранный аккаунт' : 'Сначала выберите аккаунт кнопкой «В группу» выше'}">+ аккаунт</button>
          <button type="button" class="mchip" data-group-rename="${g.id}" data-group-name-current="${esc(g.name)}">Переименовать</button>
          <button type="button" class="mchip" data-group-delete="${g.id}" data-group-name-current="${esc(g.name)}">Удалить</button>
        </div>
      </div>`;
    })
    .join('');
}

async function onCreateGroup(): Promise<void> {
  const input = document.getElementById('mirandaNewGroupName') as HTMLInputElement | null;
  const name = input?.value.trim() || '';
  if (!name) {
    toast('Введите название группы', 'err');
    return;
  }
  try {
    await window.apiClient.adminCreateMirandaGroup(authHeaders(true), name, null);
    toast('Группа создана', 'ok');
    if (input) input.value = '';
    loadContactGroups();
  } catch (e) {
    const code = (e as { code?: string } | undefined)?.code;
    toast(code === 'conflict' ? 'Группа с таким названием уже существует' : 'Не удалось создать группу', 'err');
  }
}

async function onRenameGroup(groupId: number, currentName: string): Promise<void> {
  const name = window.prompt('Новое название группы', currentName)?.trim();
  if (!name || name === currentName) return;
  try {
    await window.apiClient.adminRenameMirandaGroup(authHeaders(true), groupId, name);
    toast('Группа переименована', 'ok');
    loadContactGroups();
  } catch (e) {
    const code = (e as { code?: string } | undefined)?.code;
    toast(code === 'conflict' ? 'Группа с таким названием уже существует' : 'Не удалось переименовать группу', 'err');
  }
}

async function onDeleteGroup(groupId: number, groupName: string): Promise<void> {
  if (!window.confirm(`Удалить группу «${groupName}»? Контакты останутся в списке вне групп.`)) return;
  try {
    await window.apiClient.adminDeleteMirandaGroup(authHeaders(true), groupId);
    toast('Группа удалена', 'ok');
    loadContactGroups();
  } catch (e) {
    toast('Не удалось удалить группу', 'err');
  }
}

async function onAddGroupMember(groupId: number): Promise<void> {
  if (!selectedGroupAccountId) {
    toast('Сначала выберите корпоративный аккаунт кнопкой «В группу» в списке выше', 'err');
    return;
  }
  try {
    await window.apiClient.adminAddMirandaGroupMember(authHeaders(true), groupId, selectedGroupAccountId);
    toast('Аккаунт добавлен в группу', 'ok');
    loadContactGroups();
  } catch (e) {
    toast('Не удалось добавить аккаунт в группу', 'err');
  }
}

async function onRemoveGroupMember(groupId: number, corporateAccountId: number): Promise<void> {
  try {
    await window.apiClient.adminRemoveMirandaGroupMember(authHeaders(true), groupId, corporateAccountId);
    toast('Аккаунт убран из группы', 'ok');
    loadContactGroups();
  } catch (e) {
    toast('Не удалось убрать аккаунт из группы', 'err');
  }
}

async function onRenameAccount(corporateAccountId: number, currentLabel: string | null): Promise<void> {
  const input = window.prompt('Новое имя контакта (пустое — вернуть стандартное имя)', currentLabel || '');
  if (input === null) return;
  const displayLabel = input.trim() || null;
  try {
    await window.apiClient.adminRenameMirandaAccount(authHeaders(true), corporateAccountId, displayLabel);
    toast(displayLabel ? 'Имя контакта обновлено' : 'Возвращено стандартное имя', 'ok');
    loadCorporateAccounts();
  } catch (e) {
    toast('Не удалось переименовать аккаунт', 'err');
  }
}
