/**
 * Data Access Layer, пилотный слайс (19.22.0). Единственный модуль, которому
 * разрешено знать SQL таблицы `stores` — routes-stores.ts обязаны ходить
 * только сюда (см. scripts/check-no-direct-sql.mjs). orgId — первый
 * обязательный параметр каждой функции: без него функцию физически нельзя
 * вызвать, поэтому "забыть проверить сеть" здесь структурно невозможно, а
 * не вопрос дисциплины конкретного SELECT (тот класс багов, что уже трижды
 * чинился вручную в этой сессии — 19.11.0, 19.16.0, 19.17.0).
 */
import { query } from '../db/index.js';

export interface StoreRecord {
  id: string;
  code: string;
  name: string;
  short_name: string;
  address: string | null;
  display_name: string | null;
  hours: number;
  work_time: string | null;
  close_time_weekday: string;
  close_time_sunday: string | null;
  micro_report_times: string[] | null;
  skip_sunday_micro_times: string[] | null;
  is_active: boolean;
  created_at: string;
  color: string | null;
  plan_share: string | number;
  org_id: string | null;
  region_id: string | null;
  lat: number | null;
  lng: number | null;
}

export interface NewStoreInput {
  id: string;
  code?: string;
  name: string;
  short_name?: string;
  work_time?: string;
  hours?: number;
  color?: string;
  micro_report_times?: string[];
  skip_sunday_micro_times?: string[] | null;
  close_time_weekday?: string;
  close_time_sunday?: string;
}

export type StorePatch = Partial<{
  name: string;
  code: string;
  short_name: string;
  address: string | null;
  display_name: string | null;
  work_time: string;
  hours: number;
  color: string;
  is_active: boolean;
  micro_report_times: string[];
  skip_sunday_micro_times: string[];
  close_time_weekday: string;
  close_time_sunday: string;
}>;

const PATCHABLE_FIELDS = [
  'name', 'code', 'short_name', 'address', 'display_name', 'work_time',
  'hours', 'color', 'is_active', 'micro_report_times',
  'skip_sunday_micro_times', 'close_time_weekday', 'close_time_sunday'
] as const;

export async function findById(orgId: string, storeId: string): Promise<StoreRecord | null> {
  const res = await query(
    `SELECT * FROM stores WHERE id = $1 AND COALESCE(org_id, 'default') = $2`,
    [storeId, orgId]
  );
  return res.rows[0] || null;
}

export async function list(orgId: string): Promise<StoreRecord[]> {
  const res = await query(
    `SELECT * FROM stores WHERE COALESCE(org_id, 'default') = $1 ORDER BY hours`,
    [orgId]
  );
  return res.rows;
}

/** services/alerts.ts::runSmartAlertsTick — cron по ВСЕМ сетям разом, без org-фильтра. */
/** services/network-digest.ts — id активных точек своей сети. */
export async function listActiveIdsForOrg(orgId: string): Promise<string[]> {
  const res = await query(
    `SELECT id FROM stores WHERE COALESCE(org_id,'default') = $1 AND COALESCE(is_active,true) = true`,
    [orgId]
  );
  return res.rows.map((r: any) => String(r.id));
}

export async function listAllActive(): Promise<{ id: string; name: string; code: string }[]> {
  const res = await query(`SELECT id, name, code FROM stores WHERE COALESCE(is_active,true)=true`);
  return res.rows;
}

/** services/plans.ts::computeStoreDailyPlans — все точки сети (без фильтра is_active — старое поведение). */
export async function listBasicForOrg(orgId: string): Promise<{ id: string; name: string; code: string }[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name, code FROM stores s WHERE COALESCE(org_id, 'default') = $1 ORDER BY s.name`,
    [orgId]
  );
  return res.rows;
}

/** GET /cash/table — короткая проекция активных точек сети для шапки таблицы. */
export async function listActiveBasic(orgId: string): Promise<{ id: string; name: string; code: string }[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name, code FROM stores s
     WHERE COALESCE(is_active, true) = true AND COALESCE(org_id, 'default') = $1
     ORDER BY hours NULLS LAST, s.name`,
    [orgId]
  );
  return res.rows;
}

/** services/tenant.ts::listStoresForOrg — тот же список, что list(), но с
 * display_name-оверрайдом и сортировкой по имени (для UI-пикеров, не для
 * графика). Разные ORDER BY / проекция — оставлено двумя функциями, не
 * слито в одну, чтобы не менять поведение существующих вызывающих. */
export async function listWithDisplayName(orgId: string): Promise<(StoreRecord & { name: string })[]> {
  const res = await query(
    `SELECT *, COALESCE(display_name, name) AS name FROM stores s WHERE COALESCE(org_id,'default') = $1 ORDER BY s.name`,
    [orgId]
  );
  return res.rows;
}

/** GET /supervisor/stores, ветка admin — намеренно без org-фильтра: admin
 * уже имеет установленный, задокументированный global view в этом
 * проекте (GET /orgs, дилеры/секторы). Раньше эта же функция без
 * разбора звалась и для manager (routes-v8.ts, до 20.8.0) — исправлено
 * security-аудитом 20.52.0, см. listActiveForPickerInOrg() ниже. */
export async function listAllActiveForPicker(): Promise<Pick<StoreRecord, 'id' | 'name' | 'code' | 'color' | 'plan_share'>[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name, code, color, plan_share FROM stores s
     WHERE is_active = true OR is_active IS NULL ORDER BY s.name`
  );
  return res.rows;
}

/** Тот же пикер, но org-scoped — для manager (не admin) в GET /supervisor/stores:
 * найдено security-аудитом 20.52.0, что manager одной сети видел точки
 * ВСЕХ сетей через listAllActiveForPicker() выше. */
export async function listActiveForPickerInOrg(orgId: string): Promise<Pick<StoreRecord, 'id' | 'name' | 'code' | 'color' | 'plan_share'>[]> {
  const res = await query(
    `SELECT id, COALESCE(display_name, name) as name, code, color, plan_share FROM stores s
     WHERE (is_active = true OR is_active IS NULL) AND COALESCE(org_id, 'default') = $1
     ORDER BY s.name`,
    [orgId]
  );
  return res.rows;
}

/** Чат сети, к которой принадлежит точка (services/tenant.ts::getStoreChatId). */
/** GET /forecast/:storeId — имя точки для AI-объяснения прогноза, без org-фильтра (сам эндпоинт уже org-scoped через requireStoreInOrg). */
export async function findDisplayName(storeId: string): Promise<string | null> {
  const res = await query(`SELECT COALESCE(display_name, name) as name FROM stores WHERE id = $1`, [storeId]);
  return res.rows[0]?.name ?? null;
}

export async function getChatId(storeId: string): Promise<string | null> {
  const res = await query(
    `SELECT o.chat_id FROM stores s
     LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
     WHERE s.id = $1`,
    [storeId]
  );
  return res.rows[0]?.chat_id || null;
}

/** Чат + тема сети точки (services/tenant.ts::getStoreNotifyTarget). */
export async function getNotifyTarget(
  storeId: string, threadCol: 'sales_thread_id' | 'reports_thread_id'
): Promise<{ chat_id: string | null; thread_id: string | null } | null> {
  const res = await query(
    `SELECT o.chat_id, o.${threadCol} as thread_id FROM stores s
     LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
     WHERE s.id = $1`,
    [storeId]
  );
  return res.rows[0] || null;
}

/** Существует ли точка с этим id именно в этой сети — замена ручного SELECT,
 * который раньше был у assertStoreInOrg() (middleware-auth.ts). */
export async function belongsToOrg(orgId: string, storeId: string): Promise<boolean> {
  const res = await query(`SELECT COALESCE(org_id, 'default') as org_id FROM stores WHERE id = $1`, [storeId]);
  return !!res.rows[0] && res.rows[0].org_id === orgId;
}

/**
 * Заводит точку целиком — INSERT в stores + placeholder-план в store_plans.
 * Одна бизнес-операция «завести точку», не две отдельные — так же вела себя
 * старая инлайн-версия в POST /stores (routes-employees.ts), включая
 * молчаливый .catch() на второй вставке.
 */
export async function create(orgId: string, data: NewStoreInput): Promise<StoreRecord> {
  const res = await query(
    `INSERT INTO stores (
       id, code, name, short_name, work_time, hours, color, is_active, org_id,
       micro_report_times, skip_sunday_micro_times, close_time_weekday, close_time_sunday
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      data.id,
      data.code || data.id,
      data.name,
      data.short_name || data.name.slice(0, 8),
      data.work_time || '10-21',
      Number(data.hours) || 11,
      data.color || '#6d9eeb',
      orgId,
      data.micro_report_times || ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
      data.skip_sunday_micro_times || null,
      data.close_time_weekday || '21:00',
      data.close_time_sunday || data.close_time_weekday || '21:00'
    ]
  );

  await query(
    `INSERT INTO store_plans (store_id, plan_date, sim, mnp, pa, combo, phones)
     VALUES ($1, NULL, 0, 0, 0, 0, 0)
     ON CONFLICT DO NOTHING`,
    [data.id]
  ).catch(() => null);

  return res.rows[0];
}

/** null — точки с этим id либо нет вообще, либо она не в этой сети (не
 * различаем: за пределами репозитория оба случая должны выглядеть как 404). */
export async function update(orgId: string, storeId: string, patch: StorePatch): Promise<StoreRecord | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of PATCHABLE_FIELDS) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return findById(orgId, storeId);
  vals.push(storeId, orgId);
  const res = await query(
    `UPDATE stores SET ${sets.join(', ')}
     WHERE id = $${i++} AND COALESCE(org_id, 'default') = $${i}
     RETURNING *`,
    vals
  );
  return res.rows[0] || null;
}

/** false — точки нет или она не в этой сети; и в том, и в другом случае
 * ничего не удалено. */
export async function softDelete(orgId: string, storeId: string): Promise<boolean> {
  const res = await query(
    `UPDATE stores SET is_active = false WHERE id = $1 AND COALESCE(org_id, 'default') = $2 RETURNING id`,
    [storeId, orgId]
  );
  if (!res.rows[0]) return false;

  // Та же логика, что при увольнении сотрудника (17.14.0): будущие смены —
  // не история, а обещание, что кто-то выйдет работать именно сюда.
  await query(
    `DELETE FROM schedules WHERE store_id = $1 AND work_date::date >= (now() AT TIME ZONE 'Europe/Moscow')::date`,
    [storeId]
  ).catch((e: any) => console.error('cleanup future schedules on store delete:', e?.message || e));

  return true;
}
