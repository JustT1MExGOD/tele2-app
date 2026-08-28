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

/** core/orgs/dealers.ts::getDealersTree() — экран «Дилеры/Секторы» (21.x),
 * первый настоящий CRUD поверх того, что раньше заводилось только неявно
 * по имени из формы сети. */
// id::int — dealers.id — bigint GENERATED ALWAYS AS IDENTITY (0015), node-
// postgres иначе отдаёт bigint строкой, не числом (тот же класс проблемы,
// что уже ловили на bot_sent_messages.message_id, 20.43.0); реальный
// диапазон id дилеров умещается в int32 с огромным запасом.
export async function listAllDealers(): Promise<{ id: number; name: string }[]> {
  const res = await query(`SELECT id::int, name FROM dealers ORDER BY name`);
  return res.rows;
}

export async function renameDealer(id: number, name: string): Promise<void> {
  await query(`UPDATE dealers SET name = $1 WHERE id = $2`, [name, id]);
}

/** sectors.name изначально всегда равно id (organizations.ts::upsertSector) —
 * dealer_name здесь только для группировки в дереве, реальное переименование
 * сектора — renameSector() ниже, первый раз в жизни таблицы отличает name от id. */
export async function listAllSectorsWithDealer(): Promise<{ id: string; name: string; dealer_id: number | null; dealer_name: string | null }[]> {
  const res = await query(
    `SELECT s.id, s.name, s.dealer_id::int as dealer_id, d.name as dealer_name
     FROM sectors s
     LEFT JOIN dealers d ON d.id = s.dealer_id
     ORDER BY s.name`
  );
  return res.rows;
}

export async function renameSector(id: string, name: string): Promise<void> {
  await query(`UPDATE sectors SET name = $1 WHERE id = $2`, [name, id]);
}
