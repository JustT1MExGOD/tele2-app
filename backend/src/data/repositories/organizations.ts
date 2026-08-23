/**
 * Data Access Layer (20.8.0, Full DAL) — SQL по таблицам `organizations` и
 * `sectors`. Функции без try/catch (в отличие от services/tenant.ts,
 * который их вызывает) — тот же приём, что stores.ts: репозиторий
 * пробрасывает ошибку, catch-и-подставь-дефолт остаётся на вызывающем
 * сервисе, поведение снаружи не меняется.
 */
import { query } from '../db/index.js';

export interface OrgRow {
  id: string;
  name: string;
  brand_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
  sector_id?: string | null;
  chat_id?: string | null;
  sales_thread_id?: string | null;
  reports_thread_id?: string | null;
  is_active?: boolean;
}

export interface OrgPatch {
  id: string;
  name?: string;
  brand_name?: string | null;
  primary_color?: string | null;
  logo_url?: string | null;
  sector_id?: string | null;
  chat_id?: string | null;
  sales_thread_id?: string | null;
  reports_thread_id?: string | null;
  is_active?: boolean;
}

const OPTIONAL_UPDATE_FIELDS = ['sector_id', 'chat_id', 'sales_thread_id', 'reports_thread_id', 'is_active'] as const;

/** services/plans.ts::materializeStoreDailyPlans — id всех сетей (пул считается отдельно на каждую). */
export async function listIds(): Promise<string[]> {
  const res = await query(`SELECT id FROM organizations`);
  return res.rows.map((r: any) => r.id);
}

/** getOrg() — только активные сети (публичная брендированная точка входа). */
export async function findActiveById(orgId: string): Promise<OrgRow | null> {
  const res = await query(
    `SELECT id, name, brand_name, primary_color, logo_url
     FROM organizations WHERE id = $1 AND COALESCE(is_active,true) = true`,
    [orgId]
  );
  return res.rows[0] || null;
}

/** getOrgAdmin() — без фильтра is_active, admin должен видеть и выключенные сети. */
export async function findByIdAdmin(orgId: string): Promise<OrgRow | null> {
  const res = await query(
    `SELECT id, name, brand_name, primary_color, logo_url, sector_id, chat_id,
            sales_thread_id, reports_thread_id, COALESCE(is_active,true) as is_active
     FROM organizations WHERE id = $1`,
    [orgId]
  );
  return res.rows[0] || null;
}

export async function getChatId(orgId: string): Promise<string | null> {
  const res = await query(`SELECT chat_id FROM organizations WHERE id = $1`, [orgId]);
  return res.rows[0]?.chat_id || null;
}

export async function getNotifyTarget(orgId: string, threadCol: 'sales_thread_id' | 'reports_thread_id'): Promise<{ chat_id: string | null; thread_id: string | null } | null> {
  const res = await query(`SELECT chat_id, ${threadCol} as thread_id FROM organizations WHERE id = $1`, [orgId]);
  return res.rows[0] || null;
}

export async function listWithChat(): Promise<{ id: string; chat_id: string }[]> {
  const res = await query(`SELECT id, chat_id FROM organizations WHERE chat_id IS NOT NULL AND chat_id != ''`);
  return res.rows;
}

/** listOrgs() — все сети, без фильтра is_active (admin-переключатель/экран «Сети»). */
export async function listAll(): Promise<OrgRow[]> {
  const res = await query(
    `SELECT id, name, brand_name, primary_color, sector_id, chat_id,
            sales_thread_id, reports_thread_id, COALESCE(is_active,true) as is_active
     FROM organizations ORDER BY name`
  );
  return res.rows;
}

/** listActiveOrgsPublic() — пикер при регистрации гостя, без auth. */
export async function listActivePublic(): Promise<OrgRow[]> {
  const res = await query(
    `SELECT id, name, brand_name, primary_color, logo_url
     FROM organizations WHERE COALESCE(is_active, true) = true ORDER BY name`
  );
  return res.rows;
}

export async function upsertSector(sectorId: string): Promise<void> {
  await query(`INSERT INTO sectors (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [sectorId]);
}

/** upsertOrg() — INSERT..ON CONFLICT DO UPDATE базовых полей + опциональный второй UPDATE
 * на chat/thread/sector/is_active (правятся только явно переданные поля). */
export async function upsert(body: OrgPatch): Promise<void> {
  await query(
    `INSERT INTO organizations (id, name, brand_name, primary_color, logo_url, sector_id)
     VALUES ($1, $2, $3, COALESCE($4,'#2AABEE'), $5, COALESCE($6,'default'))
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       brand_name = COALESCE($3, organizations.brand_name),
       primary_color = COALESCE($4, organizations.primary_color),
       logo_url = COALESCE($5, organizations.logo_url)`,
    [
      body.id,
      body.name || body.id,
      body.brand_name || null,
      body.primary_color || null,
      body.logo_url || null,
      body.sector_id || null
    ]
  );

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of OPTIONAL_UPDATE_FIELDS) {
    if (body[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(key === 'is_active' ? !!body[key] : body[key] || null);
    }
  }
  if (sets.length) {
    vals.push(body.id);
    await query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  }
}
