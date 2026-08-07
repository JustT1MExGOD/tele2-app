/**
 * Сети (organizations): branding/white-label + admin CRUD. Изоляция данных
 * по сети (кто что видит) живёт в middleware-auth.ts (resolveViewOrgId,
 * assertStoreInOrg) и в самих роутах — этот файл только про запись/чтение
 * самой записи organizations, не про то, кто имеет право её видеть.
 */
import { query } from '../db/index.js';

export type Org = {
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

export type NotifyTarget = { chatId?: string; threadId?: string };

/**
 * Чат + тема (Telegram message_thread_id) сети для конкретного назначения.
 * Группа сети может быть форумом с отдельными темами "продажи"/"отчёты"
 * (sales_thread_id/reports_thread_id на organizations) — если тема не
 * настроена, threadId просто не передаётся, сообщение уходит в General.
 */
export async function getOrgNotifyTarget(
  orgId: string,
  purpose: 'sales' | 'reports'
): Promise<NotifyTarget> {
  const col = purpose === 'sales' ? 'sales_thread_id' : 'reports_thread_id';
  try {
    const res = await query(`SELECT chat_id, ${col} as thread_id FROM organizations WHERE id = $1`, [orgId]);
    return { chatId: res.rows[0]?.chat_id || undefined, threadId: res.rows[0]?.thread_id || undefined };
  } catch (_) {
    return {};
  }
}

/** То же самое, но по точке — резолвит сеть точки и её чат/тему. */
export async function getStoreNotifyTarget(
  storeId: string,
  purpose: 'sales' | 'reports'
): Promise<NotifyTarget> {
  const col = purpose === 'sales' ? 'sales_thread_id' : 'reports_thread_id';
  try {
    const res = await query(
      `SELECT o.chat_id, o.${col} as thread_id FROM stores s
       LEFT JOIN organizations o ON o.id = COALESCE(s.org_id, 'default')
       WHERE s.id = $1`,
      [storeId]
    );
    return { chatId: res.rows[0]?.chat_id || undefined, threadId: res.rows[0]?.thread_id || undefined };
  } catch (_) {
    return {};
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

/** Все сети — для переключателя сети в UI (admin) И для admin-экрана
 * «Сети». Намеренно без фильтра is_active — admin должен видеть и
 * выключенные сети. renderOrgSwitcher() читает только id/name, лишние
 * поля ему не мешают. */
export async function listOrgs(): Promise<
  {
    id: string;
    name: string;
    brand_name: string | null;
    primary_color: string | null;
    sector_id: string | null;
    chat_id: string | null;
    sales_thread_id: string | null;
    reports_thread_id: string | null;
    is_active: boolean;
  }[]
> {
  try {
    const res = await query(
      `SELECT id, name, brand_name, primary_color, sector_id, chat_id,
              sales_thread_id, reports_thread_id, COALESCE(is_active,true) as is_active
       FROM organizations ORDER BY name`
    );
    return res.rows;
  } catch (_) {
    return [];
  }
}

/** Сеть по id для admin-экранов — без фильтра is_active (в отличие от
 * getOrg(), который фильтрует его намеренно: /branding не должен отдавать
 * оформление выключенной сети гостю; admin, наоборот, должен видеть и
 * редактировать выключенные сети). */
export async function getOrgAdmin(orgId: string): Promise<Org | null> {
  try {
    const res = await query(
      `SELECT id, name, brand_name, primary_color, logo_url, sector_id, chat_id,
              sales_thread_id, reports_thread_id, COALESCE(is_active,true) as is_active
       FROM organizations WHERE id = $1`,
      [orgId]
    );
    return res.rows[0] || null;
  } catch (_) {
    return null;
  }
}

/** Активные сети — для пикера при регистрации гостя (без авторизации,
 * без chat_id/sector_id). Не переиспользует listOrgs() — та намеренно
 * не фильтрует is_active, admin должен видеть и неактивные сети тоже. */
export async function listActiveOrgsPublic(): Promise<
  { id: string; name: string; brand_name: string | null; primary_color: string | null; logo_url: string | null }[]
> {
  try {
    const res = await query(
      `SELECT id, name, brand_name, primary_color, logo_url
       FROM organizations WHERE COALESCE(is_active, true) = true ORDER BY name`
    );
    return res.rows;
  } catch (_) {
    return [];
  }
}

export async function upsertOrg(body: Partial<Org> & { id: string }) {
  // Секторов пока нет отдельного CRUD-экрана (sql/sectors-networks.sql,
  // сейчас один 'default') — печатаешь новое имя сектора в форме сети,
  // он заводится тут же по имени = id. Обязательно ДО апсерта самой
  // организации: organizations.sector_id — FK на sectors(id).
  if (body.sector_id) {
    const sectorId = String(body.sector_id).trim();
    if (sectorId) {
      await query(`INSERT INTO sectors (id, name) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING`, [sectorId]);
    }
  }

  // brand_name/primary_color/logo_url: COALESCE на $3/$4/$5 напрямую (не
  // EXCLUDED — тот на INSERT-ветке уже получил бы дефолт и никогда не был
  // бы null) — на новой сети даёт разумный дефолт цвета, на редактировании
  // с пропущенным полем сохраняет то, что уже было, а не тихо стирает.
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

  // chat_id/thread_id/sector_id/is_active — правим только если явно
  // переданы: сеть можно создать раньше, чем узнают chat_id из /chatid
  // бота, и дописать поле позже, не затирая остальное молчаливым null.
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of ['sector_id', 'chat_id', 'sales_thread_id', 'reports_thread_id', 'is_active'] as const) {
    if (body[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(key === 'is_active' ? !!body[key] : body[key] || null);
    }
  }
  if (sets.length) {
    vals.push(body.id);
    await query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  }

  return getOrgAdmin(body.id);
}
