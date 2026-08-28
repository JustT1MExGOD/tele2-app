/**
 * Дерево Дилер → Сектор → (Сети / Супервайзеры), 21.x — владелец продукта
 * попросил admin-раздел "максимально функциональный". Раньше дилер/сектор
 * заводились только неявно свободным текстом на форме сети
 * (dealers.ts::upsertDealerByName) и нигде не было видно ни списком, ни
 * "кто/что в этом секторе" — чистая композиция уже существующих плоских
 * выборок, ни одного нового прямого SQL здесь.
 */
import * as dealersRepo from '../../data/repositories/dealers.js';
import * as orgsRepo from '../../data/repositories/organizations.js';
import * as supervisorSectorsRepo from '../../data/repositories/supervisor-sectors.js';
import type { DealersTreeResponse, DealerNode, SectorNode, DealerOrgRef, DealerSupervisorRef } from '../../shared/api-types.js';

export async function getDealersTree(): Promise<DealersTreeResponse> {
  const [dealers, sectors, orgs, supervisors] = await Promise.all([
    dealersRepo.listAllDealers(),
    dealersRepo.listAllSectorsWithDealer(),
    orgsRepo.listAll(),
    supervisorSectorsRepo.listAllWithSupervisorNames()
  ]);

  const orgsBySector = new Map<string, DealerOrgRef[]>();
  for (const o of orgs) {
    if (!o.sector_id) continue;
    if (!orgsBySector.has(o.sector_id)) orgsBySector.set(o.sector_id, []);
    orgsBySector.get(o.sector_id)!.push({ id: o.id, name: o.name });
  }

  const supervisorsBySector = new Map<string, DealerSupervisorRef[]>();
  const unassignedSupervisors: DealerSupervisorRef[] = [];
  for (const s of supervisors) {
    const ref: DealerSupervisorRef = { id: s.supervisor_id, full_name: s.full_name };
    if (!s.sector_id) {
      unassignedSupervisors.push(ref);
      continue;
    }
    if (!supervisorsBySector.has(s.sector_id)) supervisorsBySector.set(s.sector_id, []);
    supervisorsBySector.get(s.sector_id)!.push(ref);
  }

  function toSectorNode(s: { id: string; name: string }): SectorNode {
    return {
      id: s.id,
      name: s.name,
      orgs: orgsBySector.get(s.id) || [],
      supervisors: supervisorsBySector.get(s.id) || []
    };
  }

  const sectorsByDealer = new Map<number, SectorNode[]>();
  const unassignedSectors: SectorNode[] = [];
  for (const s of sectors) {
    const node = toSectorNode(s);
    if (s.dealer_id == null) {
      unassignedSectors.push(node);
      continue;
    }
    if (!sectorsByDealer.has(s.dealer_id)) sectorsByDealer.set(s.dealer_id, []);
    sectorsByDealer.get(s.dealer_id)!.push(node);
  }

  const dealerNodes: DealerNode[] = dealers.map((d) => ({
    id: d.id,
    name: d.name,
    sectors: sectorsByDealer.get(d.id) || []
  }));

  return {
    dealers: dealerNodes,
    unassigned_sectors: unassignedSectors,
    unassigned_supervisors: unassignedSupervisors
  };
}

export async function renameDealer(id: number, name: string): Promise<void> {
  await dealersRepo.renameDealer(id, name);
}

export async function renameSector(id: string, name: string): Promise<void> {
  await dealersRepo.renameSector(id, name);
}
