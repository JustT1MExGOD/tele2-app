/**
 * The one function that matters: takes a wrapped request from the
 * desktop client and forwards it to the single configured upstream
 * origin — never anywhere else. No field from the client is ever
 * interpreted as a hostname/port/URL/scheme.
 *
 * Uses Node's native `https.request()` (not the global `fetch`) so the
 * DNS-rebinding-safe custom `lookup` (see ssrf-guard.ts) is guaranteed to
 * apply on every connection — Node's built-in `fetch` is undici-backed,
 * and threading a custom per-connection DNS lookup through undici's
 * dispatcher API is not a well-documented, version-stable path. For
 * security-critical transport code, the deterministic native API is the
 * safer choice, not the newer convenience one.
 */
import https from 'node:https';
import type http from 'node:http';
import { buildUpstreamRequestHeaders } from './headers.js';
import { safeLookup } from './ssrf-guard.js';

export class InvalidRelayPathError extends Error {}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Strict origin-form path validation (§ plan review, round 4): must be
 * pathname + optional query string, starting with exactly one `/`, never
 * a scheme, host, or protocol-relative reference, never containing CR/LF
 * (header/response-splitting defense), never a fragment (fragments are
 * a browser-only concept and are never sent to a server in the first
 * place, but reject explicitly rather than silently stripping — an
 * unexpected `#` in what claims to be a server-bound path is itself
 * suspicious input).
 *
 * Rejects: `https://host/path`, `http://host/path`, `//host/path`, any
 * other URL-like or malformed absolute form.
 */
export function validateOriginFormPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new InvalidRelayPathError('path must start with exactly one "/" (origin-form only)');
  }
  if (/[\r\n]/.test(path)) {
    throw new InvalidRelayPathError('path must not contain CR/LF');
  }
  if (path.includes('#')) {
    throw new InvalidRelayPathError('path must not contain a fragment');
  }
  // Reject anything that looks like it embeds a scheme/authority
  // (defensive — a leading "/" already rules out most of this, but
  // catches maliciously-encoded forms some URL parsers treat as
  // protocol-relative, e.g. a backslash immediately after the leading
  // slash, which browsers/some parsers normalize to "//").
  if (/^\/[\\/]/.test(path)) {
    throw new InvalidRelayPathError('path must not resemble a protocol-relative form');
  }
  return path;
}

export interface ForwardRequestInput {
  method: string;
  path: string;
  hadOriginHeader: boolean;
  clientHeaders: Headers;
  body: Buffer | null;
}

export interface ForwardResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

/**
 * The outbound HTTPS agent with the DNS-rebinding-safe lookup (see
 * ssrf-guard.ts) baked in — every connection this agent makes is
 * re-validated, not just checked once at startup. `rejectUnauthorized`
 * stays at its default `true` — never disabled, per §21 of the brief
 * (TLS required, no `rejectUnauthorized:false`/
 * `NODE_TLS_REJECT_UNAUTHORIZED=0`).
 *
 * `extraTrustedCa` is test-only plumbing (§ verification pass round 2):
 * Node's `https.Agent` `ca` option *adds* a certificate to the trusted
 * set for that agent instance, it does not disable verification or
 * replace the system trust store — omitted (the default, used in
 * production always), this agent behaves exactly as before. Tests pass
 * a local fixture CA so they can run a real, real-TLS-verified request
 * against an ephemeral local HTTPS server instead of the public
 * internet, without weakening what production actually does.
 */
export function createUpstreamAgent(extraTrustedCa?: string | Buffer): https.Agent {
  return new https.Agent({ lookup: safeLookup, keepAlive: true, ca: extraTrustedCa });
}

function requestViaAgent(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer | null,
  agent: https.Agent,
  timeoutMs: number
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, headers, agent, timeout: timeoutMs, rejectUnauthorized: true },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      }
    );
    req.once('timeout', () => {
      req.destroy(new Error('upstream request timed out'));
    });
    req.once('error', reject);
    if (body && body.length > 0) req.end(body);
    else req.end();
  });
}

/** Node's raw `IncomingHttpHeaders` can repeat `set-cookie` as a real
 * array already (Node's http parser special-cases it, same as browsers
 * do) — converted here into a WHATWG `Headers`-shaped structure using
 * `append()` per value so `Headers.getSetCookie()` stays correct
 * downstream, rather than collapsing them with a naive `Headers`
 * constructor (which would comma-join, corrupting Set-Cookie). */
export function toWebHeaders(nodeHeaders: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }
  return headers;
}

export async function forwardToUpstream(
  input: ForwardRequestInput,
  upstreamOrigin: string,
  agent: https.Agent,
  timeoutMs = 30_000
): Promise<ForwardResponse> {
  if (!ALLOWED_METHODS.has(input.method)) {
    throw new InvalidRelayPathError(`method not allowed: ${input.method}`);
  }
  const validatedPath = validateOriginFormPath(input.path);

  const upstreamUrl = new URL(validatedPath, upstreamOrigin);
  const expectedOrigin = new URL(upstreamOrigin).origin;
  // Defense in depth: re-assert the constructed URL's origin exactly
  // matches the configured upstream, even though path validation above
  // should already make any deviation impossible — never trust your own
  // validation as the only line of defense.
  if (upstreamUrl.origin !== expectedOrigin) {
    throw new InvalidRelayPathError('constructed upstream URL origin does not match configured upstream');
  }

  const headers = buildUpstreamRequestHeaders({
    clientHeaders: input.clientHeaders,
    hadOriginHeader: input.hadOriginHeader,
    canonicalOrigin: expectedOrigin
  });
  if (input.body && input.body.length > 0) {
    headers['content-length'] = String(input.body.length);
  }

  const result = await requestViaAgent(upstreamUrl, input.method, headers, input.body, agent, timeoutMs);
  return { status: result.status, headers: toWebHeaders(result.headers), body: result.body };
}
