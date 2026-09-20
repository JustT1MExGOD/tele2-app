package ru.t2sales.shared.api

import io.ktor.client.plugins.cookies.CookiesStorage
import io.ktor.http.Cookie
import io.ktor.http.CookieEncoding
import io.ktor.http.Url
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import ru.t2sales.shared.auth.platformConfigDir
import java.io.File

@Serializable
private data class StoredCookie(
    val name: String,
    val value: String,
    val domain: String,
    val path: String
)

/**
 * A JVM CookiesStorage backed by a JSON file at ~/.t2sales/cookies.json.
 * A desktop app has no browser-style cookie jar built in, so this is what
 * lets t2_session/t2_csrf survive an app restart (see Milestone 1's
 * verification step 3 — this is the single most important behavior to get
 * right).
 */
class FileCookiesStorage : CookiesStorage {
    private val mutex = Mutex()
    private val file = File(platformConfigDir()).apply { mkdirs() }
        .resolve("cookies.json")
    private val json = Json { ignoreUnknownKeys = true }
    private var cookies: MutableList<StoredCookie> = load()

    private fun load(): MutableList<StoredCookie> {
        if (!file.exists()) return mutableListOf()
        return runCatching {
            json.decodeFromString<List<StoredCookie>>(file.readText()).toMutableList()
        }.getOrDefault(mutableListOf())
    }

    private fun persist() {
        file.writeText(json.encodeToString(ListSerializer(StoredCookie.serializer()), cookies))
    }

    override suspend fun get(requestUrl: Url): List<Cookie> = mutex.withLock {
        cookies
            .filter { requestUrl.host == it.domain || requestUrl.host.endsWith(".${it.domain}") }
            .map { Cookie(name = it.name, value = it.value, domain = it.domain, path = it.path, encoding = CookieEncoding.RAW) }
    }

    override suspend fun addCookie(requestUrl: Url, cookie: Cookie) = mutex.withLock {
        val domain = cookie.domain ?: requestUrl.host
        val path = cookie.path ?: "/"
        cookies.removeAll { it.name == cookie.name && it.domain == domain }
        cookies.add(StoredCookie(name = cookie.name, value = cookie.value, domain = domain, path = path))
        persist()
    }

    override fun close() {
        // Nothing to release — the file is written eagerly on every addCookie.
    }
}
