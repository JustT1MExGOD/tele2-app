/**
 * Two-way POSITIVE header allowlist (not a deny-list) — built from what
 * backend/src actually sends/needs (grepped `reply.header(`/`redirect(`
 * across the backend, not guessed). See docs/adr/desktop-network-transport.md
 * for the full reasoning.
 */

/** Request headers the relay forwards to the upstream, taken from the
 * desktop client's wrapped request. Everything else is dropped.
 *
 * `x-step-up-token` added during the RC verification pass: confirmed via
 * a real local integration run that step-up-gated privileged endpoints
 * (e.g. POST /auth/admin/reset-password/:id, backend/src/auth/step-up.ts
 * reading `request.headers['x-step-up-token']`) always failed closed
 * through RELAY — not a security weakening (fail-closed is the safe
 * direction), but a genuine functional gap: a legitimately fresh MFA
 * step-up ticket was silently stripped before reaching the backend. */
export const REQUEST_HEADER_ALLOWLIST = ['cookie', 'content-type', 'x-csrf-token', 'x-step-up-token', 'accept', 'accept-language'];

/** Response headers the relay forwards back to the desktop client, taken
 * from the upstream's real response. `set-cookie` is handled separately
 * (see forward.ts) because it needs multi-value-preserving treatment, not
 * simple header copying. */
export const RESPONSE_HEADER_ALLOWLIST = [
  'content-type',
  'content-disposition', // real, load-bearing: the three CSV export routes set this
  'cache-control', // real: avatars set private,max-age=300; everything else defaults no-store
  'etag',
  'last-modified',
  'vary',
  'expires',
  'accept-ranges',
  'content-range'
];

/**
 * `User-Agent` is transport metadata only — never treated as an
 * authentication/authorization/device-trust/rate-limit-identity signal
 * anywhere in this service or the backend. This fixed string exists
 * purely for operational visibility in upstream logs.
 */
export const RELAY_USER_AGENT = 't2sales-desktop-relay/20.55.0';

export function pickAllowedHeaders(
  source: Headers | Record<string, string | string[] | undefined>,
  allowlist: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  const get = (name: string): string | null => {
    if (source instanceof Headers) return source.get(name);
    const v = source[name] ?? source[name.toLowerCase()];
    if (v === undefined) return null;
    return Array.isArray(v) ? v.join(', ') : v;
  };
  for (const name of allowlist) {
    const value = get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/**
 * Builds the headers the relay sends to the upstream: the allowlisted
 * subset of what the client sent, PLUS headers the relay controls
 * entirely and never takes from the client:
 * - `Host`: caller sets this from the validated upstream origin, not here.
 * - `Origin`: presence-preserving, reconstructed only from the relay's
 *   own validated canonical-origin config — the client supplies only a
 *   boolean (`hadOriginHeader`), never a string the relay could echo.
 * - `Sec-Fetch-Site: same-origin` — always, unconditionally. Every
 *   relayed request is, by construction (strict origin-form path, no
 *   client-supplied destination), a request to the app's own canonical
 *   origin — the relay is authoritative here, not passing along an
 *   unverified client claim. This is what lets
 *   backend/src/auth/csrf.ts::requireCsrf() take its strong branch
 *   (`secFetchSite !== 'cross-site'` short-circuits past the weaker
 *   Origin-comparison fallback) instead of silently falling through to
 *   it because the relay's outbound Node client sends no Sec-Fetch-* by
 *   default.
 * - `User-Agent`: the relay's own fixed string (see above), never the
 *   client's.
 * - `Forwarded`/`X-Forwarded-*`/`X-Real-IP`/`Proxy-Authorization`: never
 *   set — this relay does not claim to be a transparent proxy.
 * - `Connection`/`Transfer-Encoding`/`Content-Length`: never copied —
 *   hop-by-hop, recomputed by whatever HTTP client actually sends the
 *   request (copying them verbatim is a classic request-smuggling
 *   vector).
 */
export function buildUpstreamRequestHeaders(params: {
  clientHeaders: Headers;
  hadOriginHeader: boolean;
  canonicalOrigin: string;
}): Record<string, string> {
  const headers = pickAllowedHeaders(params.clientHeaders, REQUEST_HEADER_ALLOWLIST);
  headers['sec-fetch-site'] = 'same-origin';
  headers['user-agent'] = RELAY_USER_AGENT;
  if (params.hadOriginHeader) {
    headers['origin'] = params.canonicalOrigin;
  }
  return headers;
}

/** Builds the headers the relay sends back to the desktop client, from
 * the upstream's real response (excluding Set-Cookie, handled by the
 * caller via Headers.getSetCookie() for multi-value correctness). */
export function buildClientResponseHeaders(upstreamHeaders: Headers): Record<string, string> {
  return pickAllowedHeaders(upstreamHeaders, RESPONSE_HEADER_ALLOWLIST);
}
