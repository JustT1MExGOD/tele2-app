/**
 * Centralized production config validation (20.54.0, P1-H). Complements
 * — does not replace — the existing individual guards in index.ts
 * (ALLOW_INSECURE_AUTH, BOT_TOKEN, encryption config): this closes a
 * concrete gap those didn't cover.
 *
 * MINI_APP_URL is the canonical origin auth/csrf.ts uses for the
 * Origin-header CSRF check and auth/mfa/webauthn.ts uses for the
 * WebAuthn RP ID/origin — but it was never required at startup. When
 * unset, auth/csrf.ts::expectedOrigin() returns '' and the Origin-check
 * branch there is gated on `expected &&`, so an empty value SILENTLY
 * disables that layer instead of failing closed (the double-submit
 * token check still runs independently, so this was never a full CSRF
 * bypass — but a defense-in-depth layer degrading silently on missing
 * config is exactly what production config validation exists to catch
 * before it ships, not after).
 */
export class ConfigValidationError extends Error {}

export function validateProductionConfig(): void {
  const raw = process.env.MINI_APP_URL;
  if (!raw) {
    throw new ConfigValidationError(
      'MINI_APP_URL is required in production — auth/csrf.ts (Origin-header check) and ' +
      'auth/mfa/webauthn.ts (RP ID/origin) both depend on it, and silently degrade without it'
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigValidationError('MINI_APP_URL must be a valid absolute URL');
  }
  if (url.protocol !== 'https:') {
    throw new ConfigValidationError('MINI_APP_URL must use https:// in production');
  }
}
