/**
 * T2 Edge Relay — a separate deployment unit (§16 of the brief), not
 * merged into the main backend. Single job: forward one wrapped request
 * at a time to the one configured upstream origin. See forward.ts for
 * why, headers.ts for the header allowlist, ssrf-guard.ts for the
 * DNS-rebinding-safe outbound connection.
 *
 * Wire protocol (desktop ↔ relay), deliberately raw-byte, not a JSON+
 * base64 envelope — binary-safe by construction (§ plan review): the
 * desktop's original request metadata travels as headers
 * (`x-t2-method`, `x-t2-path`, `x-t2-had-origin`) on a single `POST
 * /forward`, and the ORIGINAL request body travels as this request's
 * actual body, untouched. The relay's response mirrors the upstream's
 * real status/headers/body directly as its own — no envelope needed on
 * the way back either.
 */
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { loadRelayConfig } from './config.js';
import { createUpstreamAgent, forwardToUpstream, InvalidRelayPathError } from './forward.js';
import { buildClientResponseHeaders } from './headers.js';
import { ConcurrencyLimiter, PerIpThrottle } from './limits.js';

const METADATA_HEADERS = new Set(['x-t2-method', 'x-t2-path', 'x-t2-had-origin']);

export async function buildRelay() {
  const config = loadRelayConfig();
  const agent = createUpstreamAgent();
  const concurrency = new ConcurrencyLimiter(config.maxConcurrentRequests);
  const perIp = new PerIpThrottle(config.perIpRequestsPerMinute);

  const app = Fastify({
    // Railway (or whatever hosts this) terminates TLS at its edge, same
    // topology as the main backend — trustProxy set to the actual hop
    // count, never blindly `true` (§35 of the brief). Expressed as a
    // TrustProxyFunction ("trust exactly the configured number of
    // hops") rather than a bare number — functionally identical to
    // Fastify's runtime-supported numeric form, but matches this
    // installed version's stricter TypeScript union.
    trustProxy: (_address: string, hop: number) => hop <= config.trustProxyHops,
    bodyLimit: config.maxBodyBytes,
    requestTimeout: config.requestTimeoutMs
  });

  // Binary-safe by construction: capture the raw body for every content
  // type instead of Fastify's default JSON parsing — the original
  // request's body (which may be multipart/binary/anything) must reach
  // the upstream byte-for-byte, never text-decoded or re-encoded.
  //
  // §RC-verification-pass bug fix: a bare `addContentTypeParser('*', ...)`
  // does NOT override Fastify's built-in parsers (`application/json`,
  // `text/plain`, etc. are pre-registered) — it only runs for content
  // types with no other registered parser. Every real login/mutation
  // request the app sends is `application/json`, so without
  // `removeAllContentTypeParsers()` first, Fastify's default JSON parser
  // silently consumed the body into a parsed object, `rawBody.length`
  // was `undefined`, and forward.ts treated the request as bodyless —
  // every JSON POST through the relay (login included) reached the
  // upstream with an empty body. Confirmed via a real local integration
  // run (POST /auth/login through the relay returned the upstream's own
  // "Body cannot be empty" error) before this fix.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  // CONNECT is never implemented — this relay is an application HTTP
  // relay, not a generic tunnel (§19 of the brief). Node's http server
  // does not route CONNECT through normal handlers by default; this
  // listener makes the rejection explicit and immediate instead of
  // leaving the socket to hang.
  app.server.on('connect', (_req, socket) => {
    socket.destroy();
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post('/forward', async (request, reply) => {
    if (!concurrency.tryAcquire()) {
      return reply.code(503).send({ error: 'relay_overloaded' });
    }
    try {
      if (!perIp.allow(request.ip)) {
        return reply.code(429).send({ error: 'rate_limited' });
      }

      const method = String(request.headers['x-t2-method'] || '').toUpperCase();
      const path = String(request.headers['x-t2-path'] || '');
      const hadOriginHeader = request.headers['x-t2-had-origin'] === 'true';
      if (!method || !path) {
        return reply.code(400).send({ error: 'missing_metadata_headers' });
      }

      // Build a WHATWG Headers object from the client's request headers,
      // excluding our own metadata headers — headers.ts's allowlist then
      // picks only the specific subset it actually forwards.
      const clientHeaders = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (METADATA_HEADERS.has(key) || value === undefined) continue;
        clientHeaders.append(key, Array.isArray(value) ? value.join(', ') : value);
      }

      const rawBody = request.body as Buffer | undefined;

      const upstreamResponse = await forwardToUpstream(
        { method, path, hadOriginHeader, clientHeaders, body: rawBody && rawBody.length > 0 ? rawBody : null },
        config.upstreamOrigin,
        agent,
        config.requestTimeoutMs
      );

      const responseHeaders = buildClientResponseHeaders(upstreamResponse.headers);
      for (const [key, value] of Object.entries(responseHeaders)) {
        reply.header(key, value);
      }
      // Multiple Set-Cookie headers must stay distinct — getSetCookie()
      // returns each value separately (never comma-joined); Fastify
      // forwards an array value as multiple real Set-Cookie header
      // lines, matching what Node's http module has always supported.
      const setCookies = upstreamResponse.headers.getSetCookie();
      if (setCookies.length > 0) {
        reply.header('set-cookie', setCookies);
      }

      reply.code(upstreamResponse.status);
      return reply.send(upstreamResponse.body);
    } catch (e) {
      if (e instanceof InvalidRelayPathError) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      request.log.error(e);
      return reply.code(502).send({ error: 'upstream_unreachable' });
    } finally {
      concurrency.release();
    }
  });

  return app;
}

async function main() {
  const app = await buildRelay();
  const config = loadRelayConfig();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`T2 Edge Relay listening on :${config.port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Relay failed to start:', e?.message || e);
    process.exit(1);
  });
}
