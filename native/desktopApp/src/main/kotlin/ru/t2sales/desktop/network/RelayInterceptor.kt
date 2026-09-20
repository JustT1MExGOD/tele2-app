package ru.t2sales.desktop.network

import java.net.URI
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.Buffer

/**
 * RELAY transport (port of network/relay-client.ts). While [NetworkManager.relayActive], every request to the canonical origin
 * is rewritten into `POST {relay}/forward` with the wire protocol of relay/src/index.ts: the original method/path travel in
 * `x-t2-method` / `x-t2-path` / `x-t2-had-origin`, the original body is the POST body byte-for-byte (no JSON/base64 envelope),
 * and the relay answers with the upstream's real status / headers / body.
 *
 * It sits at the OkHttp layer, BELOW Ktor's cookie and CSRF plugins: by then `Cookie` and `X-CSRF-Token` are already on the
 * request, and Ktor still sees the original canonical URL, so it stores the relay's `Set-Cookie` for the canonical origin
 * (the exact thing the Electron client had to do by hand with `session.cookies.set`).
 */
class RelayInterceptor(private val net: NetworkManager, canonicalOrigin: String, private val relayUrl: String) : Interceptor {
    private val canonicalHost = URI(canonicalOrigin).host

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        // Not relaying: DIRECT mode, another host (never an open proxy), or a WebSocket upgrade (the relay is HTTP-only;
        // chat then simply falls back to polling, like in the web).
        if (!net.relayActive || relayUrl.isEmpty() || req.url.host != canonicalHost || req.header("Upgrade") != null) return chain.proceed(req)

        val bytes = req.body?.let { b -> Buffer().also { b.writeTo(it) }.readByteArray() } ?: ByteArray(0)
        val path = req.url.encodedPath + (req.url.encodedQuery?.let { "?$it" } ?: "")
        val builder = Request.Builder()
            .url("$relayUrl/forward")
            .post(bytes.toRequestBody(req.body?.contentType() ?: req.header("Content-Type")?.toMediaTypeOrNull()))
        // same allowlist as relay/src/headers.ts REQUEST_HEADER_ALLOWLIST (the relay enforces its own copy too)
        for (name in FORWARDED) req.header(name)?.let { builder.header(name, it) }
        builder.header("x-t2-method", req.method)
        builder.header("x-t2-path", path)
        builder.header("x-t2-had-origin", "false") // a native client sends no Origin header
        return chain.proceed(builder.build())
    }

    private companion object {
        val FORWARDED = listOf("cookie", "x-csrf-token", "x-step-up-token", "accept", "accept-language")
    }
}
