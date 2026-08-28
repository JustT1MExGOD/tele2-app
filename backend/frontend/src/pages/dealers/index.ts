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
import type { DealersTreeResponse, SectorNode } from '../../../../src/shared/api-types.js';

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
      <button class="mchip" onclick="openRenameSectorModal('${esc(sector.id)}','${jsEsc(sector.name)}')">Переименовать</button>
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
              <button class="mchip" onclick="openAssignSectorForSupervisor(${s.id},'${jsEsc(s.full_name)}')">Назначить сектор</button>
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
            <button class="mchip" onclick="openRenameDealerModal(${d.id},'${jsEsc(d.name)}')">Переименовать</button>
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
    tree.innerHTML = '<div class="empty">Не удалось загрузить дилеров/секторы</div>';
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

declare global {
  interface Window {
    loadDealersAdmin: typeof loadDealersAdmin;
    openAssignSectorForSupervisor: typeof openAssignSectorForSupervisor;
    openRenameDealerModal: typeof openRenameDealerModal;
    submitRenameDealer: typeof submitRenameDealer;
    openRenameSectorModal: typeof openRenameSectorModal;
    submitRenameSector: typeof submitRenameSector;
  }
}
window.loadDealersAdmin = loadDealersAdmin;
window.openAssignSectorForSupervisor = openAssignSectorForSupervisor;
window.openRenameDealerModal = openRenameDealerModal;
window.submitRenameDealer = submitRenameDealer;
window.openRenameSectorModal = openRenameSectorModal;
window.submitRenameSector = submitRenameSector;
