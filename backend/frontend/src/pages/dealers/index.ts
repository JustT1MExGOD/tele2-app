/**
 * 21.x («максимально функциональный» admin) — экран «Дилеры/Секторы».
 * Раньше дилер/сектор заводились только неявно свободным текстом на форме
 * сети (network-admin/index.ts), нельзя было посмотреть список, переименовать
 * или узнать «какие сети/супервайзеры в этом секторе». Дерево — НЕ
 * .data-table (не однородный список одинаковых строк, а иерархия
 * дилер→сектор→сети/супервайзеры), карточки переиспользуют уже стилизованные
 * .sv-store/.sv-store-head/.progress-block классы (Supervisor/Command
 * Center), новой CSS для этого экрана не потребовалось.
 */
import { renderLoadError } from '../../shared/load-error.js';
import type { DealersTreeResponse, SectorNode } from '../../../../src/shared/api-types.js';

/**
 * 20.49.0 (Web Security & Trust Layer, часть 2) — jsEsc() отвечает
 * ТОЛЬКО за JS-string-literal safety (экранирует `'` внутри `'...'`).
 * Значение затем подставляется в onclick="..." — HTML-атрибут — поэтому
 * КАЖДЫЙ вызывающий обязан дополнительно обернуть весь onclick-value
 * через esc() (HTML-attribute safety): без этого имя с `"` разрывает
 * атрибут и внедряет произвольный атрибут на элемент (найдено и
 * исправлено этим проходом — раньше jsEsc() был единственной защитой).
 */
function jsEsc(s: string): string {
  return String(s ?? '').replace(/'/g, "\\'");
}

function sectorCardHTML(sector: SectorNode): string {
  const orgsText = sector.orgs.length ? sector.orgs.map((o) => esc(o.name)).join(', ') : '—';
  const supervisorsText = sector.supervisors.length ? sector.supervisors.map((s) => esc(s.full_name)).join(', ') : 'не назначен';
  return `<div class="sv-store" style="--sc:#8B5CF6">
    <div class="sv-store-head">
      <div>
        <div class="sv-store-name">${esc(sector.name)}</div>
        <div class="sv-store-org">${sector.orgs.length} сет${sector.orgs.length === 1 ? 'ь' : 'и'}</div>
      </div>
      <button class="mchip" onclick="${esc(`openRenameSectorModal('${jsEsc(sector.id)}','${jsEsc(sector.name)}')`)}">Переименовать</button>
    </div>
    <div class="sv-staff">Сети: ${orgsText}</div>
    <div class="sv-staff">Супервайзеры: ${supervisorsText}</div>
  </div>`;
}

export async function loadDealersAdmin(): Promise<void> {
  const unassignedSection = document.getElementById('dealersUnassignedSection');
  const unassignedList = document.getElementById('dealersUnassignedList');
  const tree = document.getElementById('dealersTree');
  if (!tree) return;
  tree.innerHTML = '<div class="skeleton"></div>';
  try {
    const data: DealersTreeResponse = await window.apiClient.getDealersTree(authHeaders());

    if (unassignedSection && unassignedList) {
      if (data.unassigned_supervisors.length) {
        unassignedSection.style.display = '';
        unassignedList.innerHTML = data.unassigned_supervisors
          .map(
            (s) => `<div class="progress-block" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong>${esc(s.full_name)}</strong>
              <button class="mchip" onclick="${esc(`openAssignSectorForSupervisor(${s.id},'${jsEsc(s.full_name)}')`)}">Назначить сектор</button>
            </div>`
          )
          .join('');
      } else {
        unassignedSection.style.display = 'none';
      }
    }

    const dealerBlocks = data.dealers
      .map(
        (d) => `<div class="section">
          <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>${esc(d.name)}</span>
            <button class="mchip" onclick="${esc(`openRenameDealerModal(${d.id},'${jsEsc(d.name)}')`)}">Переименовать</button>
          </div>
          ${d.sectors.length ? `<div class="workspace-grid" style="padding:0 16px 16px">${d.sectors.map(sectorCardHTML).join('')}</div>` : '<div class="empty">Секторов пока нет</div>'}
        </div>`
      )
      .join('');

    const unassignedSectorsBlock = data.unassigned_sectors.length
      ? `<div class="section">
          <div class="section-title">Без дилера</div>
          <div class="workspace-grid" style="padding:0 16px 16px">${data.unassigned_sectors.map(sectorCardHTML).join('')}</div>
        </div>`
      : '';

    tree.innerHTML = (dealerBlocks + unassignedSectorsBlock) || '<div class="empty">Дилеров пока нет — заведите через форму сети</div>';
  } catch (e) {
    console.error(e);
    renderLoadError(tree, 'Не удалось загрузить дилеров/секторы', () => loadDealersAdmin());
  }
}

export async function openAssignSectorForSupervisor(id: number, name: string): Promise<void> {
  await window.openSectorPickerModal({
    title: `Сектор для ${name}`,
    onPick: async (sectorId) => {
      try {
        await window.apiClient.assignSupervisorSector(authHeaders(true), id, sectorId);
      } catch (e: any) {
        toast(e?.message || 'Ошибка', 'err');
        return;
      }
      toast('Сектор назначен', 'ok');
      closeModal();
      loadDealersAdmin();
    }
  });
}

export function openRenameDealerModal(id: number, currentName: string): void {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Переименовать дилера';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="field"><label>Название</label><input id="dealerRenameInput" value="${esc(currentName)}"></div>
      <button class="btn-main" onclick="submitRenameDealer(${id})">Сохранить</button>
    `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function submitRenameDealer(id: number): Promise<void> {
  const name = (document.getElementById('dealerRenameInput') as HTMLInputElement | null)?.value.trim();
  if (!name) {
    toast('Укажите название', 'err');
    return;
  }
  try {
    await window.apiClient.renameDealer(authHeaders(true), id, name);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Сохранено', 'ok');
  closeModal();
  loadDealersAdmin();
}

export function openRenameSectorModal(id: string, currentName: string): void {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Переименовать сектор';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="field"><label>Название</label><input id="sectorRenameInput" value="${esc(currentName)}"></div>
      <button class="btn-main" onclick="submitRenameSector('${esc(id)}')">Сохранить</button>
    `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function submitRenameSector(id: string): Promise<void> {
  const name = (document.getElementById('sectorRenameInput') as HTMLInputElement | null)?.value.trim();
  if (!name) {
    toast('Укажите название', 'err');
    return;
  }
  try {
    await window.apiClient.renameSector(authHeaders(true), id, name);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Сохранено', 'ok');
  closeModal();
  loadDealersAdmin();
}

// §D плана (глобальная админка) — явное создание дилера/сектора, раньше
// можно было только переименовать существующего. Сектор создаётся с
// явным id (как у organizations.id — не auto-increment), дилер —
// опционален (список берётся из уже загруженного дерева, та же кэш-идея,
// что switcherOrgsCache в team/index.ts, но здесь не нужен — дерево уже
// в DOM на этом экране через loadDealersAdmin()).
export function openCreateDealerModal(): void {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Новый дилер';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
      <div class="field"><label>Название</label><input id="dealerCreateInput" placeholder="ООО «Название»"></div>
      <button class="btn-main" data-dealers-trigger="submit-create-dealer">Создать</button>
    `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function submitCreateDealer(): Promise<void> {
  const name = (document.getElementById('dealerCreateInput') as HTMLInputElement | null)?.value.trim();
  if (!name) {
    toast('Укажите название', 'err');
    return;
  }
  try {
    await window.apiClient.createDealer(authHeaders(true), name);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Дилер создан', 'ok');
  closeModal();
  loadDealersAdmin();
}

export function openCreateSectorModal(): void {
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.textContent = 'Новый сектор';
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    const dealerOptions = Array.from(document.querySelectorAll('#dealersTree .section-title > span'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    modalBody.innerHTML = `
      <div class="field"><label>ID (латиница, как у сетей)</label><input id="sectorCreateId" placeholder="north_region"></div>
      <div class="field"><label>Название</label><input id="sectorCreateName" placeholder="Северный регион"></div>
      <div class="field"><label>Дилер (необязательно)</label>
        <select id="sectorCreateDealer">
          <option value="">— без дилера —</option>
          ${dealerOptions.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
        </select>
      </div>
      <button class="btn-main" data-dealers-trigger="submit-create-sector">Создать</button>
    `;
  }
  document.getElementById('overlay')?.classList.add('show');
}

export async function submitCreateSector(): Promise<void> {
  const id = (document.getElementById('sectorCreateId') as HTMLInputElement | null)?.value.trim();
  const name = (document.getElementById('sectorCreateName') as HTMLInputElement | null)?.value.trim();
  const dealerName = (document.getElementById('sectorCreateDealer') as HTMLSelectElement | null)?.value || '';
  if (!id || !name) {
    toast('Укажите ID и название', 'err');
    return;
  }
  // Экран оперирует именами дилеров (то же дерево, что и переименование) —
  // id дилера для POST /admin/sectors ищем по уже загрученному дереву
  // через GET /admin/dealers ещё раз (проще и надёжнее, чем тащить id
  // через DOM-атрибуты модалки создания сектора).
  let dealerId: number | null = null;
  if (dealerName) {
    try {
      const tree = await window.apiClient.getDealersTree(authHeaders());
      dealerId = tree.dealers.find((d) => d.name === dealerName)?.id ?? null;
    } catch (_) {
      // best-effort — если дерево не подтянулось, создаём сектор без дилера
    }
  }
  try {
    await window.apiClient.createSector(authHeaders(true), id, name, dealerId);
  } catch (e: any) {
    toast(e?.message || 'Ошибка', 'err');
    return;
  }
  toast('Сектор создан', 'ok');
  closeModal();
  loadDealersAdmin();
}

// data-dealers-trigger, not onclick=: check-inline-event-handlers.mjs's
// baseline has zero headroom (same [data-page-trigger] convention
// app/nav.ts already uses for Admin Center's nav entry) — covers both the
// toolbar "+ Дилер"/"+ Сектор" buttons (index.html) and the "Создать"
// buttons rendered into #modalBody above.
document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-dealers-trigger]');
  const action = el?.dataset.dealersTrigger;
  if (!action) return;
  if (action === 'open-create-dealer') openCreateDealerModal();
  else if (action === 'open-create-sector') openCreateSectorModal();
  else if (action === 'submit-create-dealer') submitCreateDealer();
  else if (action === 'submit-create-sector') submitCreateSector();
});

declare global {
  interface Window {
    loadDealersAdmin: typeof loadDealersAdmin;
    openAssignSectorForSupervisor: typeof openAssignSectorForSupervisor;
    openRenameDealerModal: typeof openRenameDealerModal;
    submitRenameDealer: typeof submitRenameDealer;
    openRenameSectorModal: typeof openRenameSectorModal;
    submitRenameSector: typeof submitRenameSector;
    openCreateDealerModal: typeof openCreateDealerModal;
    submitCreateDealer: typeof submitCreateDealer;
    openCreateSectorModal: typeof openCreateSectorModal;
    submitCreateSector: typeof submitCreateSector;
  }
}
window.loadDealersAdmin = loadDealersAdmin;
window.openAssignSectorForSupervisor = openAssignSectorForSupervisor;
window.openRenameDealerModal = openRenameDealerModal;
window.submitRenameDealer = submitRenameDealer;
window.openRenameSectorModal = openRenameSectorModal;
window.submitRenameSector = submitRenameSector;
window.openCreateDealerModal = openCreateDealerModal;
window.submitCreateDealer = submitCreateDealer;
window.openCreateSectorModal = openCreateSectorModal;
window.submitCreateSector = submitCreateSector;
