/**
 * Мультитенант + white-label branding (с fallback без таблицы organizations)
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
    if (res.rows.length) return res.rows;
  } catch (_) {}
  try {
    const res = await query(`SELECT * FROM stores ORDER BY name`);
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
