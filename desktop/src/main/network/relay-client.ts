/**
 * RELAY transport — intercepts network requests for the canonical
 * origin within the dedicated `persist:t2-sales` session and forwards
 * them through the T2 Edge Relay, while every other request (external
 * scripts, Electron's own internal requests) passes through untouched.
 *
 * This is the mechanism flagged as a technical risk in the implementation
 * plan — it needs real verification (Phase 8's acceptance checklist,
 * especially cookies/CSRF/WebAuthn) before being trusted, not assumed
 * correct from the API docs alone. If it fails that verification, the
 * documented fallback is a `session.setProxy()`-based local proxy scoped
 * to the same session (see docs/adr/desktop-network-transport.md).
 *
 * Wire protocol matches relay/src/index.ts exactly: metadata via
 * `x-t2-method`/`x-t2-path`/`x-t2-had-origin` headers on a `POST
 * /forward`, original body as the actual POST body (binary-safe, no
 * JSON/base64 envelope), response mirrors the upstream's real
 * status/headers/body directly.
 */
import type { Session } from 'electron';

/** Same request-header allowlist as relay/src/headers.ts's
 * REQUEST_HEADER_ALLOWLIST — kept as a separate literal here rather than
 * importing across the desktop/relay package boundary (they're
 * independent deployable units), but must stay in sync; the relay
 * enforces its own copy of this allowlist server-side regardless, so a
 * drift here is a tidiness issue, not a security one.
 *
 * `x-step-up-token` added during the RC verification pass alongside the
 * matching relay/src/headers.ts fix — found via a real local integration
 * run: without it, this client-side allowlist dropped a legitimate
 * step-up ticket before the request ever reached the relay, so every
 * step-up-gated privileged action failed closed through RELAY even with
 * the relay-side allowlist already fixed. */
export const FORWARDED_HEADER_ALLOWLIST = ['cookie', 'content-type', 'x-csrf-token', 'x-step-up-token', 'accept', 'accept-language'];

export interface RelayClientOptions {
  session: Session;
  canonicalOrigin: string;
  relayUrl: string;
}

function pickHeaders(source: Headers, names: string[]): Headers {
  const out = new Headers();
  for (const name of names) {
    const v = source.get(name);
    if (v !== null) out.set(name, v);
  }
  return out;
}

/** Rebuilds a Response's Set-Cookie headers with getSetCookie()-preserved
 * distinctness — a naive `new Headers(response.headers)` copy would
 * comma-join multiple Set-Cookie values, corrupting them (same trap
 * relay/src/forward.ts::toWebHeaders() guards against on the server
 * side). */
function cloneResponseHeadersPreservingSetCookie(source: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of source.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue; // handled below
    out.append(key, value);
  }
  for (const cookie of source.getSetCookie()) {
    out.append('set-cookie', cookie);
  }
  return out;
}

export function installRelayProtocolHandler(options: RelayClientOptions): void {
  const { session, canonicalOrigin, relayUrl } = options;
  const canonicalOriginParsed = new URL(canonicalOrigin).origin;

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
    forwardedHeaders.set('x-t2-method', request.method);
    forwardedHeaders.set('x-t2-path', requestUrl.pathname + requestUrl.search);
    forwardedHeaders.set('x-t2-had-origin', String(request.headers.has('origin')));

    const relayResponse = await session.fetch(new URL('/forward', relayUrl).toString(), {
      method: 'POST',
      headers: forwardedHeaders,
      body,
      bypassCustomProtocolHandlers: true
    });

    const responseHeaders = cloneResponseHeadersPreservingSetCookie(relayResponse.headers);
    return new Response(relayResponse.body, { status: relayResponse.status, headers: responseHeaders });
  });
}

export function uninstallRelayProtocolHandler(session: Session): void {
  session.protocol.unhandle('https');
}
