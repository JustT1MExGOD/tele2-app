/**
 * Redacting logger for the desktop main process. §38 of the brief:
 * never log Cookie/Set-Cookie/Authorization/CSRF tokens/passwords/MFA
 * codes/TOTP secrets/WebAuthn assertion data/relay tickets/reset tokens/
 * API secrets. Safe to log: timestamp, network mode, endpoint id,
 * latency, error category, HTTP status, request path (already stripped
 * of query strings containing secrets — see redactPath), app version.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'x-csrf-token',
  'x-step-up-token',
  'proxy-authorization'
]);

/** Strips query strings entirely — cheaper and safer than trying to
 * allowlist which query params are safe; paths logged by this app never
 * need query detail to be useful for diagnostics. */
export function redactPath(path: string): string {
  const qIndex = path.indexOf('?');
  return qIndex === -1 ? path : path.slice(0, qIndex) + '?[redacted]';
}

export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[redacted]' : Array.isArray(value) ? value.join(',') : value;
  }
  return out;
}

export interface LogFields {
  [key: string]: string | number | boolean | undefined;
}

function line(level: 'info' | 'warn' | 'error', msg: string, fields?: LogFields): void {
  const entry = { time: new Date().toISOString(), level, msg, ...fields };
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, fields?: LogFields) => line('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => line('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => line('error', msg, fields)
};
