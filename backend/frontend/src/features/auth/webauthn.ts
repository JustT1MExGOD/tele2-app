/**
 * WebAuthn/passkey browser ceremony (20.85.0) — thin wrapper over
 * @simplewebauthn/browser's startRegistration/startAuthentication. The
 * backend hands back PublicKeyCredential*Options JSON; the authenticator
 * (platform passkey / security key) produces a credential we serialize back
 * for the server-side verify step.
 *
 * The browser API is loaded lazily so a device without WebAuthn (older
 * browsers, some WebViews) doesn't crash at import time — webauthnAvailable()
 * is the gate; callers show the TOTP/recovery fallback when it's false.
 */
import { authHeaders } from '../../shared/api/http-headers.js';
import {
  webauthnLoginOptions,
  webauthnRegisterOptions,
  webauthnRegisterVerify,
  loginMfa
} from './api.js';

type SwbModule = typeof import('@simplewebauthn/browser');
let swbPromise: Promise<SwbModule | null> | null = null;
function swb(): Promise<SwbModule | null> {
  if (!swbPromise) {
    swbPromise = import('@simplewebauthn/browser').then(
      (m) => m,
      () => null
    );
  }
  return swbPromise;
}

export async function webauthnAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !(window as any).PublicKeyCredential) return false;
  const mod = await swb();
  return !!mod?.browserWebauthnSupport?.();
}

/**
 * Login-time second factor: fetch assertion options for the pending-login
 * token, run navigator.credentials.get() via @simplewebauthn/browser, then
 * submit the assertion to /auth/login/mfa with method 'webauthn'.
 */
export async function loginWithWebauthn(mfaToken: string): Promise<void> {
  const mod = await swb();
  if (!mod) throw new Error('WebAuthn недоступен в этом окружении');
  const options = await webauthnLoginOptions(authHeaders(true), mfaToken);
  const assertion = await mod.startAuthentication({ optionsJSON: options as any });
  await loginMfa(authHeaders(true), {
    mfa_token: mfaToken,
    method: 'webauthn',
    response: assertion as unknown
  });
}

/**
 * Enrollment: fetch registration options, run navigator.credentials.create(),
 * then submit the attestation to /auth/mfa/webauthn/register/verify.
 */
export async function enrollWebauthn(deviceName?: string): Promise<void> {
  const mod = await swb();
  if (!mod) throw new Error('WebAuthn недоступен в этом окружении');
  const options = await webauthnRegisterOptions(authHeaders(true));
  const attestation = await mod.startRegistration({ optionsJSON: options as any });
  await webauthnRegisterVerify(authHeaders(true), { response: attestation as unknown, device_name: deviceName });
}
