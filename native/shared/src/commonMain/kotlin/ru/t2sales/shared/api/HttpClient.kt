package ru.t2sales.shared.api

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpSend
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.cookies.CookiesStorage
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.plugins.cookies.cookies
import io.ktor.client.plugins.plugin
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.http.HttpMethod
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** Thrown by [ReportsApi]/[AuthRepository] call sites on any non-2xx response,
 * matching the {code, message}-carrying Error thrown by http-client.ts's
 * request(). */
class ApiException(
    val statusCode: Int,
    val code: String?,
    override val message: String
) : Exception(message)

private const val CSRF_COOKIE_NAME = "t2_csrf"
private const val CSRF_HEADER_NAME = "X-CSRF-Token"

/**
 * Mirrors readCsrfCookie() + the mutating-method check in
 * backend/frontend/src/shared/api/http-client.ts: attach the current
 * t2_csrf cookie value as X-CSRF-Token on every non-GET/HEAD/OPTIONS
 * request. Ktor's HttpCookies plugin (installed alongside this one) is the
 * source of truth for the cookie value — this plugin only reads from it.
 */
private val CsrfPlugin = createClientPlugin("CsrfPlugin") {
    val httpClient = client
    onRequest { request, _ ->
        val method = request.method
        if (method == HttpMethod.Get || method == HttpMethod.Head || method == HttpMethod.Options) return@onRequest
        val url = request.url.build()
        val cookies = httpClient.cookies(url)
        val csrf = cookies.firstOrNull { it.name == CSRF_COOKIE_NAME }?.value
        if (csrf != null) {
            request.header(CSRF_HEADER_NAME, csrf)
        }
    }
}

/**
 * Builds the shared Ktor client used for every API call. [cookiesStorage] is
 * injected so the JVM target can supply a file-backed implementation
 * (persisting t2_session/t2_csrf across app restarts — a native app has no
 * browser-style cookie jar built in) without this factory needing to know
 * about file I/O at all.
 */
fun createHttpClient(cookiesStorage: CookiesStorage, engine: HttpClientEngine? = null): HttpClient {
    val client = if (engine != null) HttpClient(engine) { configureT2(cookiesStorage) } else HttpClient { configureT2(cookiesStorage) }

    // Translate non-2xx responses into ApiException, matching the shape the
    // web client's request() throws (Object.assign(new Error(...), {code})).
    client.plugin(HttpSend).intercept { request ->
        val call = execute(request)
        val response: HttpResponse = call.response
        // 101 = successful WebSocket upgrade (chat realtime)
        if (!response.status.isSuccess() && response.status.value != 101) {
            val body = runCatching { call.response.body<ApiErrorBody>() }.getOrNull()
            throw ApiException(
                statusCode = response.status.value,
                code = body?.error,
                message = body?.message ?: "Request failed (${response.status.value})"
            )
        }
        call
    }

    return client
}

private fun HttpClientConfig<*>.configureT2(cookiesStorage: CookiesStorage) {
    install(HttpCookies) {
        storage = cookiesStorage
    }
    install(ContentNegotiation) {
        json(Json {
            ignoreUnknownKeys = true
            isLenient = true
        })
    }
    install(WebSockets)
    install(CsrfPlugin)
    expectSuccess = false
}

fun apiUrl(path: String): String = ApiConfig.PROD_API_BASE + path
