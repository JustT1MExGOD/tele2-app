/**
 * Сети (organizations): branding/white-label + admin CRUD. Изоляция данных
 * по сети (кто что видит) живёт в middleware-auth.ts (resolveViewOrgId,
 * assertStoreInOrg) и в самих роутах — этот файл только про запись/чтение
 * самой записи organizations, не про то, кто имеет право её видеть.
 *
 * 20.8.0 (Full DAL): SQL сам по себе переехал в repositories/organizations.ts,
 * repositories/stores.ts и repositories/employees.ts — этот файл остаётся
 * тонким сервисным слоем (те же сигнатуры, тот же try/catch-и-дефолт для
 * вызывающего кода, просто композиция репозиториев вместо query()).
 */
import * as orgsRepo from '../../data/repositories/organizations.js';
import * as storesRepo from '../../data/repositories/stores.js';
import * as employeesRepo from '../../data/repositories/employees.js';

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
    const row = await orgsRepo.findActiveById(orgId);
    if (row) return row;
  } catch (_) {}
  return { ...DEFAULT, id: orgId || 'default' };
}

export async function orgIdForEmployee(employeeId: number): Promise<string> {
  try {
    const orgId = await employeesRepo.getOrgId(employeeId);
    return orgId || 'default';
  } catch (_) {
    return 'default';
  }
}

export async function listStoresForOrg(orgId: string) {
  try {
    return await storesRepo.listWithDisplayName(orgId);
  } catch (_) {
    return [];
  }
}

/** Чат сети, к которой принадлежит точка. Фолбэк — глобальный CHAT_ID (env), если у сети чат не задан. */
export async function getStoreChatId(storeId: string): Promise<string | undefined> {
  try {
    const chatId = await storesRepo.getChatId(storeId);
    return chatId || undefined;
  } catch (_) {
    return undefined;
  }
}

/** Чат сети по её id. Фолбэк — глобальный CHAT_ID (env), если у сети чат не задан. */
export async function getOrgChatId(orgId: string): Promise<string | undefined> {
  try {
    const chatId = await orgsRepo.getChatId(orgId);
    return chatId || undefined;
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
    const row = await orgsRepo.getNotifyTarget(orgId, col);
    return { chatId: row?.chat_id || undefined, threadId: row?.thread_id || undefined };
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
    const row = await storesRepo.getNotifyTarget(storeId, col);
    return { chatId: row?.chat_id || undefined, threadId: row?.thread_id || undefined };
  } catch (_) {
    return {};
  }
}

/** Все сети (id + chat_id), у которых явно настроен свой чат. */
export async function listOrgsWithChat(): Promise<{ id: string; chat_id: string }[]> {
  try {
    return await orgsRepo.listWithChat();
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
    return (await orgsRepo.listAll()) as any;
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
    return await orgsRepo.findByIdAdmin(orgId);
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
    return await orgsRepo.listActivePublic();
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
      await orgsRepo.upsertSector(sectorId);
    }
  }

  await orgsRepo.upsert(body as orgsRepo.OrgPatch);

  return getOrgAdmin(body.id);
}
