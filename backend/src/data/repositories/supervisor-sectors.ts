/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблице `supervisor_sectors`
 * (назначение супервайзера на сектор целиком, не на отдельные точки).
 */
import { query } from '../db/index.js';

/** DELETE + INSERT ON CONFLICT DO NOTHING — переназначение сектора супервайзеру
 * целиком (используется и PUT /supervisor/:id/sector, и транзакцией смены роли
 * в routes-v8.ts — отсюда инъекция q). */
export async function replaceForSupervisor(
  supervisorId: number, sectorId: string, q: typeof query = query
): Promise<void> {
  await q(`DELETE FROM supervisor_sectors WHERE supervisor_id = $1`, [supervisorId]);
  await q(
    `INSERT INTO supervisor_sectors (supervisor_id, sector_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [supervisorId, sectorId]
  );
}

/** middleware-auth.ts::getUserStoreIds — id точек всех сетей сектора супервайзера. */
export async function listStoreIdsForSupervisor(supervisorId: number): Promise<string[]> {
  const res = await query(
    `SELECT s.id as store_id
     FROM supervisor_sectors ss
     JOIN organizations o ON o.sector_id = ss.sector_id
     JOIN stores s ON COALESCE(s.org_id, 'default') = o.id
     WHERE ss.supervisor_id = $1`,
    [supervisorId]
  );
  return res.rows.map((r: any) => r.store_id);
}

/** core/orgs/dealers.ts::getDealersTree() — все супервайзеры сети с их
 * текущим сектором (или null, если строки в supervisor_sectors ещё нет —
 * ровно то, что раньше нигде не было видно, только молчаливо ломалось). */
// e.id::int — employees.id тоже bigint (0001_baseline.sql) — тот же
// класс проблемы, что уже ловили на dealers.id/bot_sent_messages.message_id:
// node-postgres иначе отдаёт bigint строкой. Держим DealerSupervisorRef.id
// честно number для этого нового ответа, не наследуем существующую
// where-inconsistency остального employees-домена (вне объёма этой правки).
export async function listAllWithSupervisorNames(): Promise<
  { supervisor_id: number; full_name: string; sector_id: string | null }[]
> {
  const res = await query(
    `SELECT e.id::int as supervisor_id, e.full_name, ss.sector_id
     FROM employees e
     LEFT JOIN supervisor_sectors ss ON ss.supervisor_id = e.id
     WHERE e.role = 'supervisor' AND e.is_active = true
     ORDER BY e.full_name`
  );
  return res.rows;
}

/** GET /supervisor/stores, ветка supervisor — та же выборка, но с полной проекцией для UI. */
export async function listStoresForSupervisor(
  supervisorId: number
): Promise<{ id: string; name: string; code: string; color: string | null; plan_share: string | number }[]> {
  const res = await query(
    `SELECT st.id, COALESCE(st.display_name, st.name) as name, st.code, st.color, st.plan_share
     FROM supervisor_sectors ss
     JOIN organizations o ON o.sector_id = ss.sector_id
     JOIN stores st ON COALESCE(st.org_id, 'default') = o.id
     WHERE ss.supervisor_id = $1
     ORDER BY st.name`,
    [supervisorId]
  );
  return res.rows;
}
