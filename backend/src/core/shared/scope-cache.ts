/**
 * Supervisor Scope Cache (19.25.0) — кэш результата
 * resolveSupervisorStores() (services/supervisor-analytics.ts) для
 * role='supervisor': JOIN supervisor_sectors → organizations → stores
 * гонялся заново на каждую загрузку Command Center/кабинета супервайзера.
 *
 * In-memory Map, не Redis — прод это 1 реплика Railway (bot на
 * long-polling физически не может жить на двух инстансах одного
 * BOT_TOKEN), поэтому проблемы рассинхрона между инстансами не
 * существует и Redis не добавил бы корректности, только инфраструктуру.
 * Единственное "fail-safe"-поведение, применимое к in-memory кэшу —
 * кэш-мисс (пустая Map после рестарта процесса) прозрачно ведёт себя как
 * отсутствие кэша: обычный SQL-запрос, без ошибки.
 */

interface CacheEntry {
  stores: string[];
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CacheEntry>();
let hits = 0;
let misses = 0;

export function getCached(supervisorId: number): string[] | undefined {
  const entry = cache.get(supervisorId);
  if (!entry || entry.expiresAt < Date.now()) {
    misses++;
    return undefined;
  }
  hits++;
  return entry.stores;
}

export function setCached(supervisorId: number, stores: string[]): void {
  cache.set(supervisorId, { stores, expiresAt: Date.now() + TTL_MS });
}

/** Точечная инвалидация — сектор конкретного супервайзера изменился
 * (PUT /supervisor/:id/sector, PATCH /employees/:id/role). */
export function invalidate(supervisorId: number): void {
  cache.delete(supervisorId);
}

/** Полный сброс — используется там, где точечная инвалидация обошлась бы
 * дороже, чем просто пересчитать всё заново (organizations.sector_id
 * поменялся, PUT /admin/org/:id — затрагивает неизвестное заранее число
 * супервайзеров и старого, и нового сектора). Операция редкая. */
export function invalidateAll(): void {
  cache.clear();
}

export function getStats() {
  const total = hits + misses;
  return {
    hits,
    misses,
    size: cache.size,
    hitRate: total ? hits / total : 0
  };
}
