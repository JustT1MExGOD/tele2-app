/** Реэкспорт — routes-v8 может импортировать отсюда или из middleware-auth.js */
export {
  type AuthUser,
  type AppUser,
  type Role,
  type AccessStatus,
  loadUser,
  resolveUser,
  authPlugin,
  requireAuth,
  requireActive,
  requireManager,
  requireManagerOrSupervisor,
  requireSupervisor,
  isManager,
  getUserStoreIds
} from './middleware-auth.js';
