/**
 * 21.x («максимально функциональный» admin) — jsdom render test for
 * src/pages/dealers (новый экран «Дилеры/Секторы»). openSectorPickerModal —
 * стабится как window.*-функция (реальная реализация живёт в
 * src/pages/team, тот же приём, что уже используется для других
 * cross-file window-bridged функций в этой кодовой базе — не
 * импортируется напрямую в тестах другой страницы).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function setupGlobals() {
  document.body.innerHTML = `
    <div id="dealersUnassignedSection" style="display:none">
      <div id="dealersUnassignedList"></div>
    </div>
    <div id="dealersTree"></div>
    <div id="overlay"></div>
    <div id="modalTitle"></div>
    <div id="modalBody"></div>
  `;
  vi.stubGlobal('esc', (s: unknown) => String(s ?? ''));
  vi.stubGlobal('authHeaders', () => ({}));
  vi.stubGlobal('toast', vi.fn());
  vi.stubGlobal('closeModal', vi.fn());

  const getDealersTree = vi.fn().mockResolvedValue({ dealers: [], unassigned_sectors: [], unassigned_supervisors: [] });
  const renameDealer = vi.fn().mockResolvedValue({ ok: true });
  const renameSector = vi.fn().mockResolvedValue({ ok: true });
  const assignSupervisorSector = vi.fn().mockResolvedValue({ ok: true, sector_id: 'sector-1' });
  (window as any).apiClient = { getDealersTree, renameDealer, renameSector, assignSupervisorSector };

  const openSectorPickerModal = vi.fn();
  (window as any).openSectorPickerModal = openSectorPickerModal;

  return { getDealersTree, renameDealer, renameSector, assignSupervisorSector, openSectorPickerModal };
}

describe('Дилеры/Секторы (src/pages/dealers)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('loadDealersAdmin: пусто — сообщение "Дилеров пока нет"', async () => {
    setupGlobals();
    const { loadDealersAdmin } = await import('../src/pages/dealers/index.js');
    await loadDealersAdmin();
    expect(document.getElementById('dealersTree')!.textContent).toContain('Дилеров пока нет');
    expect((document.getElementById('dealersUnassignedSection') as HTMLElement).style.display).toBe('none');
  });

  it('loadDealersAdmin: рендерит дерево дилер → секторы → сети/супервайзеры', async () => {
    const { getDealersTree } = setupGlobals();
    getDealersTree.mockResolvedValue({
      dealers: [
        {
          id: 1,
          name: 'ООО Ромашка',
          sectors: [
            { id: 'sector-1', name: 'Север', orgs: [{ id: 'o1', name: 'Точка А' }], supervisors: [{ id: 5, full_name: 'Иван Петров' }] },
            { id: 'sector-2', name: 'Юг', orgs: [], supervisors: [] }
          ]
        }
      ],
      unassigned_sectors: [{ id: 'sector-9', name: 'sector-9', orgs: [], supervisors: [] }],
      unassigned_supervisors: []
    });
    const { loadDealersAdmin } = await import('../src/pages/dealers/index.js');
    await loadDealersAdmin();
    const html = document.getElementById('dealersTree')!.innerHTML;
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Север');
    expect(html).toContain('Точка А');
    expect(html).toContain('Иван Петров');
    expect(html).toContain('не назначен'); // sector-2, без супервайзеров
    expect(html).toContain('Без дилера');
    expect(html).toContain('sector-9');
  });

  it('loadDealersAdmin: непривязанные супервайзеры показаны отдельным блоком', async () => {
    const { getDealersTree } = setupGlobals();
    getDealersTree.mockResolvedValue({
      dealers: [],
      unassigned_sectors: [],
      unassigned_supervisors: [{ id: 7, full_name: 'Анна Смирнова' }]
    });
    const { loadDealersAdmin } = await import('../src/pages/dealers/index.js');
    await loadDealersAdmin();
    expect((document.getElementById('dealersUnassignedSection') as HTMLElement).style.display).toBe('');
    const html = document.getElementById('dealersUnassignedList')!.innerHTML;
    expect(html).toContain('Анна Смирнова');
    expect(html).toContain('openAssignSectorForSupervisor(7');
  });

  it('openAssignSectorForSupervisor: открывает общий пикер сектора, выбор вызывает assignSupervisorSector и перезагружает дерево', async () => {
    const { assignSupervisorSector, openSectorPickerModal, getDealersTree } = setupGlobals();
    const { openAssignSectorForSupervisor } = await import('../src/pages/dealers/index.js');
    await openAssignSectorForSupervisor(7, 'Анна Смирнова');
    expect(openSectorPickerModal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Сектор для Анна Смирнова' }));
    // allowSkip не передан — назначение сектора уже существующему
    // супервайзеру должно завершиться реальным выбором, не "пропустить".
    const opts = openSectorPickerModal.mock.calls[0][0];
    expect(opts.allowSkip).toBeUndefined();
    await opts.onPick('sector-1');
    expect(assignSupervisorSector).toHaveBeenCalledWith(expect.anything(), 7, 'sector-1');
    // onPick сам вызывает loadDealersAdmin() после успешного назначения —
    // дерево должно перерисоваться сразу, не только после ручной перезагрузки.
    expect(getDealersTree).toHaveBeenCalledTimes(1);
  });

  it('submitRenameDealer/submitRenameSector: переименовывают и перезагружают дерево', async () => {
    const { renameDealer, renameSector, getDealersTree } = setupGlobals();
    const { openRenameDealerModal, submitRenameDealer, openRenameSectorModal, submitRenameSector } = await import('../src/pages/dealers/index.js');

    openRenameDealerModal(1, 'Старое имя');
    (document.getElementById('dealerRenameInput') as HTMLInputElement).value = 'Новое имя';
    await submitRenameDealer(1);
    expect(renameDealer).toHaveBeenCalledWith(expect.anything(), 1, 'Новое имя');

    openRenameSectorModal('sector-1', 'Старый сектор');
    (document.getElementById('sectorRenameInput') as HTMLInputElement).value = 'Новый сектор';
    await submitRenameSector('sector-1');
    expect(renameSector).toHaveBeenCalledWith(expect.anything(), 'sector-1', 'Новый сектор');
    expect(getDealersTree).toHaveBeenCalled();
  });

  it('submitRenameDealer: пустое имя — toast err, API не вызывается', async () => {
    const { renameDealer } = setupGlobals();
    const { openRenameDealerModal, submitRenameDealer } = await import('../src/pages/dealers/index.js');
    openRenameDealerModal(1, 'Имя');
    (document.getElementById('dealerRenameInput') as HTMLInputElement).value = '';
    await submitRenameDealer(1);
    expect(renameDealer).not.toHaveBeenCalled();
    expect((globalThis as any).toast).toHaveBeenCalledWith('Укажите название', 'err');
  });

  it('window.* мост — все 6 функций', async () => {
    setupGlobals();
    await import('../src/pages/dealers/index.js');
    for (const name of [
      'loadDealersAdmin',
      'openAssignSectorForSupervisor',
      'openRenameDealerModal',
      'submitRenameDealer',
      'openRenameSectorModal',
      'submitRenameSector'
    ]) {
      expect(typeof (window as any)[name]).toBe('function');
    }
  });
});
