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
class FileCookiesStorage(private val protector: ru.t2sales.shared.auth.SecretProtector? = ru.t2sales.shared.auth.platformSecretProtector()) : CookiesStorage {
    private val mutex = Mutex()
    private val file = File(platformConfigDir()).apply { mkdirs() }
        .resolve("cookies.json")
    private val json = Json { ignoreUnknownKeys = true }
    private var cookies: MutableList<StoredCookie> = load()

    private fun load(): MutableList<StoredCookie> {
        if (!file.exists()) return mutableListOf()
        return runCatching {
            val raw = file.readBytes()
            val text = if (raw.startsWith(MAGIC)) {
                // encrypted for this Windows user: anything that cannot be opened here (copied file, other account) means "not signed in"
                val plain = protector?.unprotect(java.util.Base64.getDecoder().decode(raw.copyOfRange(MAGIC.size, raw.size).decodeToString().trim()))
                    ?: return mutableListOf()
                plain.decodeToString()
            } else {
                raw.decodeToString() // an older, unencrypted file: read it, and it is rewritten encrypted below
            }
            json.decodeFromString<List<StoredCookie>>(text).toMutableList().also { if (!raw.startsWith(MAGIC) && protector != null) persistList(it) }
        }.getOrDefault(mutableListOf())
    }

    private fun persist() = persistList(cookies)

    private fun persistList(list: List<StoredCookie>) {
        val text = json.encodeToString(ListSerializer(StoredCookie.serializer()), list)
        if (protector == null) {
            file.writeText(text)
        } else {
            val sealed = java.util.Base64.getEncoder().encodeToString(protector.protect(text.toByteArray(Charsets.UTF_8)))
            // written next to the file first: a crash mid-write never leaves a half-written sign-in
            val tmp = File(file.path + ".tmp")
            tmp.writeBytes(MAGIC + sealed.toByteArray(Charsets.US_ASCII))
            java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun ByteArray.startsWith(prefix: ByteArray) = size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    private companion object {
        /** First bytes of an encrypted file; a plain file starts with `[`. */
        val MAGIC = "T2DPAPI1:".toByteArray(Charsets.US_ASCII)
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
