/**
 * 20.9.0 (Authentication Boundary) — provider-agnostic "как человек
 * подтвердил, кто он". Identity — тот шов, через который подключаются
 * дополнительные provider'ы, не трогая остальной код.
 *
 * 'phone' (не-Telegram вход, телефон+пароль) — второй provider, ради
 * которого этот шов и задумывался (см. docs/ADR/005-authentication-boundary.md).
 * Причина: Telegram в стране бизнеса доступен только через VPN, плюс есть
 * сотрудники, вообще не пользующиеся Telegram — см. providers/phone.ts.
 *
 * Сознательно НЕ трогает БД/API/бизнес-логику — см. README §22, 20.9.0.
 */
export type IdentityProvider = 'telegram' | 'phone';

export interface Identity {
  provider: IdentityProvider;
  /** Внешний id у провайдера — для Telegram numeric user.id из initData,
   * для phone — employee_id (сессия уже резолвит его перед этим шагом). */
  providerId: string;
}
