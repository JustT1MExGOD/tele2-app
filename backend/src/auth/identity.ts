/**
 * 20.9.0 (Authentication Boundary) — provider-agnostic "как человек
 * подтвердил, кто он". Единственный provider сегодня — Telegram
 * (src/auth/providers/telegram.ts); Identity — это ровно тот шов, через
 * который позже подключатся Web/Mobile/SSO, не трогая всё остальное.
 *
 * Сознательно НЕ трогает БД/API/бизнес-логику — см. README §22, 20.9.0.
 */
export type IdentityProvider = 'telegram';

export interface Identity {
  provider: IdentityProvider;
  /** Внешний id у провайдера — для Telegram это numeric user.id из initData. */
  providerId: string;
}
