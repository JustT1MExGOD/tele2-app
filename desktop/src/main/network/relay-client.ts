/**
 * RELAY transport — intercepts network requests for the canonical
 * origin within the dedicated `persist:t2-sales` session and forwards
 * them through the T2 Edge Relay, while every other request (external
 * scripts, Electron's own internal requests) passes through untouched.
 *
 * Wire protocol matches relay/src/index.ts exactly: metadata via
 * `x-t2-method`/`x-t2-path`/`x-t2-had-origin` headers on a `POST
 * /forward`, original body as the actual POST body (binary-safe, no
 * JSON/base64 envelope), response mirrors the upstream's real
 * status/headers/body directly.
 *
 * §CSRF-over-RELAY bug (acceptance-hardening pass) — the outbound call
 * to the relay used to go through `session.fetch()`. Two real,
 * independent bugs were found this way, both confirmed with a real
 * Electron process against a real relay (not just curl/unit tests):
 *
 * 1. A `Response` returned from a `session.protocol.handle('https', …)`
 *    handler does NOT cause Chromium to apply that Response's
 *    `Set-Cookie` headers to the cookie store for the ORIGINAL
 *    intercepted request's origin. `session.cookies.get()` showed
 *    `t2_session`/`t2_csrf` stored with `domain: "127.0.0.1"` (the
 *    RELAY's own host, from the internal `session.fetch(relayUrl, …)`
 *    call — a real, separate network request whose OWN Set-Cookie
 *    Chromium DOES apply, but scoped to where THAT request went, not to
 *    the canonical origin) — while `document.cookie` for the real page
 *    (`tele2-app-production.up.railway.app`) was completely empty.
 *    Authenticated GETs kept working anyway (the internal relay fetch
 *    auto-attached its own 127.0.0.1-scoped cookies on every subsequent
 *    relayed call, accidentally) — which is exactly why login/GET looked
 *    fine while the CSRF double-submit check failed:
 *    `readCsrfCookie()` (api-client.ts) reads `document.cookie` for the
 *    canonical origin, found nothing, sent no `X-CSRF-Token` at all.
 *
 * 2. Independently, `session.fetch()`'s Response.headers comma-coalesces
 *    multiple `Set-Cookie` response headers into ONE array entry from
 *    `getSetCookie()` (e.g. `"t2_session=…; …SameSite=Lax,
 *    t2_csrf=…; …SameSite=Lax"` as a SINGLE string) instead of two
 *    distinct values — a real login response sets both `t2_session` and
 *    `t2_csrf` together, so a naive per-value parser would misparse the
 *    comma inside as part of the first cookie's SameSite attribute and
 *    silently drop the second cookie entirely.
 *
 * Fix for both: the relay call no longer goes through `session.fetch()`
 * at all — it uses Node's own `http`/`https` module directly (the exact
 * same proven-correct pattern relay/src/forward.ts already uses for ITS
 * own upstream call), whose `IncomingMessage.headers['set-cookie']` is
 * already a real, distinct `string[]` — no coalescing, nothing to
 * misparse. Every parsed cookie is then explicitly written via
 * `session.cookies.set({ url: canonicalOrigin + path, … })`, the one
 * reliable way to land it on the canonical origin regardless of what
 * host the relay itself is. `rejectUnauthorized` is never touched here
 * (Node's https default — real TLS verification — applies unchanged).
 */
import type { Session, CookiesSetDetails } from 'electron';
import https from 'node:https';
import http from 'node:http';

/** Same request-header allowlist as relay/src/headers.ts's
 * REQUEST_HEADER_ALLOWLIST — kept as a separate literal here rather than
 * importing across the desktop/relay package boundary (they're
 * independent deployable units), but must stay in sync; the relay
 * enforces its own copy of this allowlist server-side regardless, so a
 * drift here is a tidiness issue, not a security one.
 *
 * `x-step-up-token` added during the RC verification pass alongside the
 * matching relay/src/headers.ts fix — without it, this client-side
 * allowlist dropped a legitimate step-up ticket before the request ever
 * reached the relay, so every step-up-gated privileged action failed
 * closed through RELAY even with the relay-side allowlist already
 * fixed. */
export const FORWARDED_HEADER_ALLOWLIST = ['cookie', 'content-type', 'x-csrf-token', 'x-step-up-token', 'accept', 'accept-language'];

export interface RelayClientOptions {
  session: Session;
  canonicalOrigin: string;
  relayUrl: string;
}

/**
 * §CSRF-over-RELAY bug, third and final piece — confirmed empirically
 * (real Electron process, real relay, debug-logged on every single
 * intercepted request): `request.headers.get('cookie')` is ALWAYS
 * `null` inside a `session.protocol.handle('https', …)` handler, for
 * every request, even long after a real session cookie was confirmed
 * present in the session's cookie store for that exact origin.
 * Chromium's automatic cookie-attachment layer runs BELOW where
 * `protocol.handle` intercepts — the handler is fully responsible for
 * its own request, and cookies are simply never populated into it. This
 * is why authenticated GETs "worked" before this fix only by accident
 * (see the module doc comment) and why nothing else in
 * FORWARDED_HEADER_ALLOWLIST could ever have masked this — `cookie` was
 * never there to allowlist through in the first place.
 *
 * Fix: read matching cookies directly from the session's cookie store
 * via `session.cookies.get({ url })` (Electron's own API, which already
 * evaluates path/secure/expiry matching correctly) and build the Cookie
 * header explicitly — the same responsibility a real browser's network
 * stack normally carries, now carried here instead.
 */
async function buildCookieHeader(session: Session, url: string): Promise<string | null> {
  const cookies = await session.cookies.get({ url });
  if (cookies.length === 0) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function pickHeaders(source: Headers, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const v = source.get(name);
    if (v !== null) out[name] = v;
  }
  return out;
}

interface NodeRelayResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Hard cap on a buffered relay response body — §security review after
 * the CSRF-over-RELAY fix: unlike the previous `session.fetch()`-based
 * transport (which returned a streaming `ReadableStream` `Response.body`,
 * never fully materialized in memory), this Node-http(s)-based transport
 * accumulates the whole response into one `Buffer` before returning —
 * necessary because Set-Cookie parsing/cookie-store writes must complete
 * before the Response is constructed. Left uncapped, an oversized (or
 * malfunctioning) relay/upstream response would be buffered without
 * bound. 64 MiB comfortably covers this app's real large-response case
 * (CSV exports) with headroom, while still bounding worst-case memory
 * use per in-flight request. */
const MAX_RELAY_RESPONSE_BYTES = 64 * 1024 * 1024;

/** Real Node http(s) request to the relay's `/forward` endpoint —
 * deliberately not `session.fetch()`, see the module doc comment above.
 * `relayUrl` is fixed, server-side-configured desktop config (never
 * client/request-influenced — see main/config.ts) — this function never
 * reads a destination from anywhere else. TLS verification is Node's
 * https default (`rejectUnauthorized: true`), never overridden.
 *
 * `signal`, if provided and already-aborted or later aborted, destroys
 * the in-flight request/socket — §security review: the intercepted
 * Electron `Request` carries its own `AbortSignal` (page navigated away,
 * fetch() was cancelled, …); without forwarding it, the relay round-trip
 * would run to completion regardless, wasting relay/backend work for a
 * response nobody will ever read. */
export function requestRelay(url: URL, method: string, headers: Record<string, string>, body: Buffer | null, timeoutMs = 30_000, signal?: AbortSignal, maxResponseBytes = MAX_RELAY_RESPONSE_BYTES): Promise<NodeRelayResponse> {
  const mod = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = mod.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > maxResponseBytes) {
          settle(() => reject(new Error(`relay response exceeded ${maxResponseBytes} bytes`)));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => settle(() => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) })));
      res.on('error', (e) => settle(() => reject(e)));
    });
    req.once('timeout', () => req.destroy(new Error('relay request timed out')));
    req.once('error', (e) => settle(() => reject(e)));

    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('client request aborted'));
      } else {
        const onAbort = () => req.destroy(new Error('client request aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
        req.once('close', () => signal.removeEventListener('abort', onAbort));
      }
    }

    if (body && body.length > 0) req.end(body);
    else req.end();
  });
}

/**
 * Parses one raw `Set-Cookie` header value (already a single, distinct
 * value — Node's http parser never comma-joins these) into the parts
 * `session.cookies.set()` needs. Minimal, hand-written (no new
 * dependency) — only the attributes this app's backend actually ever
 * sends (`auth/csrf.ts::setCsrfCookie`, `api/routes/auth/session.ts::
 * setSessionCookie`: httpOnly/secure/sameSite/path/maxAge, never
 * Domain/Expires) need to round-trip correctly; unrecognized attributes
 * are ignored rather than rejected, since a future backend-side addition
 * should degrade gracefully here, not break cookie parsing entirely.
 */
export function parseSetCookie(raw: string): { name: string; value: string; path?: string; secure: boolean; httpOnly: boolean; sameSite: CookiesSetDetails['sameSite']; expirationDate?: number } | null {
  const parts = raw.split(';').map((p) => p.trim());
  const first = parts[0];
  const eq = first.indexOf('=');
  if (eq === -1) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  let path: string | undefined;
  let secure = false;
  let httpOnly = false;
  let sameSite: CookiesSetDetails['sameSite'] = 'unspecified';
  let expirationDate: number | undefined;

  for (const attr of parts.slice(1)) {
    const [rawKey, ...rest] = attr.split('=');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'path') path = val;
    else if (key === 'secure') secure = true;
    else if (key === 'httponly') httpOnly = true;
    else if (key === 'samesite') {
      const v = val.toLowerCase();
      sameSite = v === 'strict' ? 'strict' : v === 'none' ? 'no_restriction' : 'lax';
    } else if (key === 'max-age') {
      const seconds = Number(val);
      if (Number.isFinite(seconds)) expirationDate = Date.now() / 1000 + seconds;
    } else if (key === 'expires' && expirationDate === undefined) {
      const ms = Date.parse(val);
      if (Number.isFinite(ms)) expirationDate = ms / 1000;
    }
    // Domain is deliberately never read from the upstream Set-Cookie —
    // every cookie this app ever sets is host-only (the backend never
    // sends a Domain attribute), and the cookie must always land on the
    // canonical origin regardless of what host the relay itself is.
  }

  return { name, value, path, secure, httpOnly, sameSite, expirationDate };
}

/** Explicitly writes every Set-Cookie from the relay's response into the
 * session's cookie store scoped to the CANONICAL origin — see the
 * module doc comment for why this is necessary (protocol.handle's
 * returned Response does not do this on its own). */
async function applyRelayCookiesToCanonicalOrigin(session: Session, canonicalOrigin: string, setCookies: string[] | undefined): Promise<void> {
  if (!setCookies || setCookies.length === 0) return;
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw);
    if (!parsed) continue;
    const details: CookiesSetDetails = {
      url: canonicalOrigin + (parsed.path ?? '/'),
      name: parsed.name,
      value: parsed.value,
      secure: parsed.secure,
      httpOnly: parsed.httpOnly,
      sameSite: parsed.sameSite,
      path: parsed.path
    };
    if (parsed.expirationDate !== undefined) details.expirationDate = parsed.expirationDate;
    await session.cookies.set(details);
  }
}

/** Builds the Headers object for the synthesized Response, from Node's
 * raw response headers — Set-Cookie excluded (handled separately above;
 * a real Fetch Response never exposes Set-Cookie to page JS anyway, a
 * forbidden response header name, so excluding it here also matches
 * real browser behavior, not just RELAY's). */
/**
 * §security review, post-CSRF-fix — `buildResponseHeaders` used to copy
 * every header the relay hop sent except Set-Cookie, unlike
 * relay/src/headers.ts's own explicit RESPONSE_HEADER_ALLOWLIST on the
 * backend-to-relay hop. In practice the relay's own allowlist already
 * keeps its BUSINESS headers narrow, but the relay↔desktop HTTP hop
 * itself (Fastify's own wire response — Node's http/https client parses
 * whatever Fastify actually sent) still carries real hop-by-hop headers
 * (`Connection`, `Transfer-Encoding`, `Content-Length`, `Keep-Alive`)
 * that describe THAT hop's framing, not the application response —
 * copying them into the synthesized Response the renderer receives is
 * exactly the "classic request-smuggling vector" the relay's own code
 * comment already warns about for its own hop; the desktop hop needs
 * the same discipline, not just the server. `Content-Length` in
 * particular would already be stale here regardless (the real length is
 * whatever `new Uint8Array(relayResponse.body)` actually is, computed by
 * the JS runtime, not copied). RFC 7230 §6.1's hop-by-hop header list,
 * plus the two already-excluded elsewhere for the same reason.
 */
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'set-cookie' // handled separately via applyRelayCookiesToCanonicalOrigin
]);

function buildResponseHeaders(nodeHeaders: http.IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined || HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const v of value) out.append(key, v);
    } else {
      out.append(key, value);
    }
  }
  return out;
}

export function installRelayProtocolHandler(options: RelayClientOptions): void {
  const { session, canonicalOrigin, relayUrl } = options;
  const canonicalOriginParsed = new URL(canonicalOrigin).origin;
  const relayForwardUrl = new URL('/forward', relayUrl);

  session.protocol.handle('https', async (request) => {
    const requestUrl = new URL(request.url);

    if (requestUrl.origin !== canonicalOriginParsed) {
      // Not our origin (e.g. the external telegram.org script, or
      // Electron's own internal requests) — pass through on the SAME
      // session via ses.fetch's bypass option, never bare net.fetch()
      // (which risks re-entering this same scheme-wide handler).
      return session.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? null : Buffer.from(await request.arrayBuffer());
    const forwardedHeaders = pickHeaders(request.headers, FORWARDED_HEADER_ALLOWLIST);
    const cookieHeader = await buildCookieHeader(session, request.url);
    if (cookieHeader) forwardedHeaders['cookie'] = cookieHeader;
    else delete forwardedHeaders['cookie'];
    forwardedHeaders['x-t2-method'] = request.method;
    forwardedHeaders['x-t2-path'] = requestUrl.pathname + requestUrl.search;
    forwardedHeaders['x-t2-had-origin'] = String(request.headers.has('origin'));

    // The outer call to the relay is ALWAYS POST /forward, regardless of
    // the original request's method — that travels in the x-t2-method
    // header (set above), matching relay/src/index.ts's wire protocol.
    // (A real bug in an earlier draft of this rewrite passed
    // request.method here instead — worked by coincidence for POST
    // requests, 404'd the relay's /forward route for every GET.)
    const relayResponse = await requestRelay(relayForwardUrl, 'POST', forwardedHeaders, body, 30_000, request.signal);

    await applyRelayCookiesToCanonicalOrigin(session, canonicalOriginParsed, relayResponse.headers['set-cookie']);
    const responseHeaders = buildResponseHeaders(relayResponse.headers);
    return new Response(new Uint8Array(relayResponse.body), { status: relayResponse.status, headers: responseHeaders });
  });
}

export function uninstallRelayProtocolHandler(session: Session): void {
  session.protocol.unhandle('https');
}
