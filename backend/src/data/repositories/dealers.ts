/**
 * Data Access Layer (21.0) — дилеры (компания-владелец сектора). Только
 * ownership-запись, тот же лёгкий приём, что organizations.ts::upsertSector —
 * заводится по имени из формы редактирования сети, без отдельного CRUD.
 */
import { query } from '../db/index.js';

/** Заводит дилера по имени, если такого ещё нет (UNIQUE на name) —
 * повторный ввод того же названия не плодит дубли, возвращает тот же id. */
export async function upsertDealerByName(name: string): Promise<{ id: number; name: string }> {
  const res = await query(
    `INSERT INTO dealers (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name`,
    [name]
  );
  return res.rows[0];
}

export async function setSectorDealer(sectorId: string, dealerId: number): Promise<void> {
  await query(`UPDATE sectors SET dealer_id = $1 WHERE id = $2`, [dealerId, sectorId]);
}

/** organizations.ts::listAll/findActiveById — имя дилера сектора этой сети,
 * для отображения в форме редактирования сети (не отдельный экран). */
export async function findDealerNameForSector(sectorId: string): Promise<string | null> {
  const res = await query(
    `SELECT d.name FROM sectors s JOIN dealers d ON d.id = s.dealer_id WHERE s.id = $1`,
    [sectorId]
  );
  return res.rows[0]?.name ?? null;
}
