/**
 * Branding/white-label по org_id — НЕ мультитенантность с изоляцией данных.
 *
 * org_id есть в схеме (employees, stores) с 14.x, но реальную видимость
 * данных им нигде не ограничивают: sales, planы, алерты, кабинет
 * супервайзера читают всю сеть без фильтра по org. Здесь org_id влияет
 * только на тему/лого/название — и то мягко, с фолбэком на дефолт при
 * любой ошибке (одна БД = одна реальная организация сейчас, второй
 * никогда не было, так что фолбэки ни разу не били по данным).
 *
 * Настоящая изоляция — сознательно отложенный эпик 17.0 («Платформа»),
 * не техдолг, который случайно не доделали. Включать её раньше 17.0
 * может быть просто и незаметно опасно: код, который ни разу не
 * проверял org_id, начнёт его проверять, и любое молчаливое
 * предположение "одна БД = одна сеть" превратится в утечку между
 * будущими клиентами.
 */
import { query } from '../db/index.js';

export type Org = {
  id: string;
  name: string;
  brand_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
};

const DEFAULT: Org = {
  id: 'default',
  name: 'T2 Sales',
  brand_name: 'T2',
  primary_color: '#2AABEE',
  logo_url: null
};

export async function getOrg(orgId = 'default'): Promise<Org> {
  try {
    const res = await query(
      `SELECT id, name, brand_name, primary_color, logo_url
       FROM organizations WHERE id = $1 AND COALESCE(is_active,true) = true`,
      [orgId]
    );
    if (res.rows[0]) return res.rows[0];
  } catch (_) {}
  return { ...DEFAULT, id: orgId || 'default' };
}

export async function orgIdForEmployee(employeeId: number): Promise<string> {
  try {
    const res = await query(`SELECT org_id FROM employees WHERE id = $1`, [employeeId]);
    return res.rows[0]?.org_id || 'default';
  } catch (_) {
    return 'default';
  }
}

export async function listStoresForOrg(orgId: string) {
  try {
    const res = await query(
      `SELECT * FROM stores WHERE COALESCE(org_id,'default') = $1 ORDER BY name`,
      [orgId]
    );
    return res.rows;
  } catch (_) {
    return [];
  }
}

/** Чат сети, к которой принадлежит точка. Фолбэк — глобальный CHAT_ID (env), если у сети чат не задан. */
export async function getStoreChatId(storeId: string): Promise<string | undefined> {
  try {
    const res = await query(
      `SELECT o.chat_id FROM stores s
       LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
       WHERE s.id = $1`,
      [storeId]
    );
    return res.rows[0]?.chat_id || undefined;
  } catch (_) {
    return undefined;
  }
}

/** Чат сети по её id. Фолбэк — глобальный CHAT_ID (env), если у сети чат не задан. */
export async function getOrgChatId(orgId: string): Promise<string | undefined> {
  try {
    const res = await query(`SELECT chat_id FROM organizations WHERE id = $1`, [orgId]);
    return res.rows[0]?.chat_id || undefined;
  } catch (_) {
    return undefined;
  }
}

/** Все сети (id + chat_id), у которых явно настроен свой чат. */
export async function listOrgsWithChat(): Promise<{ id: string; chat_id: string }[]> {
  try {
    const res = await query(
      `SELECT id, chat_id FROM organizations WHERE chat_id IS NOT NULL AND chat_id != ''`
    );
    return res.rows;
  } catch (_) {
    return [];
  }
}

export async function upsertOrg(body: Partial<Org> & { id: string }) {
  await query(
    `INSERT INTO organizations (id, name, brand_name, primary_color, logo_url)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       brand_name = EXCLUDED.brand_name,
       primary_color = EXCLUDED.primary_color,
       logo_url = EXCLUDED.logo_url`,
    [
      body.id,
      body.name || body.id,
      body.brand_name || null,
      body.primary_color || '#2AABEE',
      body.logo_url || null
    ]
  );
  return getOrg(body.id);
}
