package ru.t2sales.desktop.update

import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import javax.net.ssl.SSLContext
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/** `stage` tells a transport failure (could not get the bytes) from an integrity failure (got them, they do not match the manifest). */
class DownloadError(message: String, val stage: Stage = Stage.Download) : Exception(message) {
    enum class Stage { Download, Sha256 }
}

/** `notPublished` = HTTP 404: no release has been published for this channel yet - that is "nothing to update", not a failure. */
class ManifestFetchError(message: String, val notPublished: Boolean = false) : Exception(message)

data class DownloadProgress(val receivedBytes: Long, val totalBytes: Long)

private const val MAX_MANIFEST_BYTES = 1 * 1024 * 1024
private const val MANIFEST_TIMEOUT_MS = 10_000L

/** Never follows redirects (a 3xx is a failure), real TLS verification. `sslContext` is test-only: it ADDS a trusted CA, it never disables checks. */
private fun httpClient(sslContext: SSLContext?, connectTimeoutMs: Long): HttpClient =
    HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofMillis(connectTimeoutMs))
        .apply { if (sslContext != null) sslContext(sslContext) }
        .build()

/** Always requests exactly `{updateBaseUrl}/native/{channel}/manifest.json` - the destination is never taken from anywhere else. */
suspend fun fetchManifest(updateBaseUrl: String, channel: String, timeoutMs: Long = MANIFEST_TIMEOUT_MS, sslContext: SSLContext? = null): UpdateManifest {
    val base = URI(updateBaseUrl)
    val allowedOrigin = originOf(base)
    val url = URI("$allowedOrigin/native/$channel/manifest.json")
    return withContext(Dispatchers.IO) {
        val text = try {
            val req = HttpRequest.newBuilder(url).timeout(Duration.ofMillis(timeoutMs)).header("accept", "application/json").GET().build()
            val res = httpClient(sslContext, timeoutMs).send(req, HttpResponse.BodyHandlers.ofInputStream())
            res.body().use { body ->
                val status = res.statusCode()
                if (status in 300..399) throw ManifestFetchError("Сервер обновлений вернул перенаправление — оно не принимается")
                if (status == 404) throw ManifestFetchError("Для этого канала обновлений ещё ничего не опубликовано", notPublished = true)
                if (status != 200) throw ManifestFetchError("Не удалось получить манифест обновлений (HTTP $status)")
                val declared = res.headers().firstValue("content-length").map { it.toLongOrNull() }.orElse(null)
                if (declared != null && declared > MAX_MANIFEST_BYTES) throw ManifestFetchError("Манифест обновлений слишком большой")
                val bytes = body.readNBytes(MAX_MANIFEST_BYTES + 1)
                if (bytes.size > MAX_MANIFEST_BYTES) throw ManifestFetchError("Манифест обновлений слишком большой")
                bytes.toString(Charsets.UTF_8)
            }
        } catch (e: ManifestFetchError) {
            throw e
        } catch (e: HttpTimeoutException) {
            throw ManifestFetchError("Истекло время ожидания сервера обновлений")
        } catch (e: IOException) {
            throw ManifestFetchError("Не удалось связаться с сервером обновлений")
        }
        val json = runCatching { Json.parseToJsonElement(text) }.getOrElse { throw ManifestFetchError("Манифест обновлений не является корректным JSON") }
        validateManifest(json, channel, allowedOrigin)
    }
}

private fun sha256Of(stream: InputStream, onChunk: (() -> Unit)? = null): String {
    val md = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    while (true) {
        val n = stream.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
        onChunk?.invoke()
    }
    return md.digest().joinToString("") { "%02x".format(it) }
}

private fun constantTimeEquals(hexA: String, hexB: String) =
    MessageDigest.isEqual(hexA.lowercase().toByteArray(), hexB.lowercase().toByteArray())

/**
 * Re-verifies an already-on-disk installer (size + SHA-256, constant-time compare, streamed - never loaded into memory). Called
 * again right before launch: the file waits for an unbounded human click, so it could have been swapped in the meantime.
 */
fun verifyFileIntegrity(file: Path, expectedSha256: String, expectedSize: Long) {
    if (!Files.exists(file)) throw DownloadError("Файл обновления не найден перед установкой", DownloadError.Stage.Sha256)
    if (!Files.isRegularFile(file)) throw DownloadError("Файл обновления повреждён (это не обычный файл)", DownloadError.Stage.Sha256)
    if (Files.size(file) != expectedSize) throw DownloadError("Размер файла обновления изменился перед установкой", DownloadError.Stage.Sha256)
    val actual = try {
        Files.newInputStream(file).use { sha256Of(it) }
    } catch (e: IOException) {
        throw DownloadError("Не удалось повторно проверить файл обновления", DownloadError.Stage.Sha256)
    }
    if (!constantTimeEquals(actual, expectedSha256)) throw DownloadError("Файл обновления был изменён после проверки — установка отменена", DownloadError.Stage.Sha256)
}

/** Non-throwing snapshot for the diagnostic log only: it changes no accept/reject decision. */
data class FileSnapshot(val exists: Boolean, val size: Long?, val sha256Prefix: String?)

fun snapshotFile(file: Path): FileSnapshot {
    if (!Files.isRegularFile(file)) return FileSnapshot(false, null, null)
    val size = runCatching { Files.size(file) }.getOrNull()
    val prefix = runCatching { Files.newInputStream(file).use { sha256Of(it).take(8) } }.getOrNull()
    return FileSnapshot(true, size, prefix)
}

/**
 * Port of updater/downloader.ts. HTTPS only, exact update origin (re-checked here, not just trusted from manifest validation),
 * no redirects, streamed straight to a temp file while SHA-256 is computed, a hard byte cap DURING the stream, exact size + hash
 * checked after, and the rename to the final `.exe` name happens only after verification - there is never an unverified file
 * with a runnable name.
 */
suspend fun downloadAndVerifyInstaller(
    manifest: UpdateManifest,
    cacheDir: Path,
    allowedOrigin: String,
    timeoutMs: Long = 120_000,
    sslContext: SSLContext? = null,
    onProgress: (DownloadProgress) -> Unit = {}
): Path {
    val uri = URI(manifest.url)
    if (uri.scheme != "https") throw DownloadError("Небезопасный адрес сервера обновлений")
    if (originOf(uri) != allowedOrigin) throw DownloadError("Адрес сервера обновлений не совпадает с ожидаемым")

    Files.createDirectories(cacheDir)
    val resolvedDir = cacheDir.toAbsolutePath().normalize()
    val rnd = ByteArray(6).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    val tempPath = cacheDir.resolve("${manifest.filename}.$rnd.download")
    val finalPath = cacheDir.resolve(manifest.filename)
    // defence in depth: re-check the resolved path instead of trusting the filename validation alone
    val resolvedFinal = finalPath.toAbsolutePath().normalize()
    if (resolvedFinal.parent != resolvedDir) throw DownloadError("Внутренняя ошибка проверки пути установки")

    // disk hygiene: leftovers of a crashed/aborted earlier run
    runCatching {
        Files.list(cacheDir).use { s -> s.filter { it.fileName.toString().startsWith("${manifest.filename}.") && it.fileName.toString().endsWith(".download") }.forEach { Files.deleteIfExists(it) } }
    }

    try {
        withContext(Dispatchers.IO) {
            val req = HttpRequest.newBuilder(uri).timeout(Duration.ofMillis(timeoutMs)).GET().build()
            val res = try {
                httpClient(sslContext, 15_000).send(req, HttpResponse.BodyHandlers.ofInputStream())
            } catch (e: HttpTimeoutException) {
                throw DownloadError("Истекло время ожидания загрузки обновления")
            } catch (e: IOException) {
                throw DownloadError("Загрузка обновления прервана сетевой ошибкой")
            }
            res.body().use { body ->
                val status = res.statusCode()
                if (status in 300..399) throw DownloadError("Сервер обновлений вернул перенаправление — загрузка отклонена")
                if (status != 200) throw DownloadError("Сервер обновлений вернул ошибку (HTTP $status)")
                val declared = res.headers().firstValue("content-length").map { it.toLongOrNull() }.orElse(null)
                if (declared != null && declared != manifest.size) throw DownloadError("Заявленный размер файла не совпадает с ожидаемым", DownloadError.Stage.Sha256)

                val md = MessageDigest.getInstance("SHA-256")
                var received = 0L
                var lastEmit = 0L
                try {
                    Files.newOutputStream(tempPath, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            coroutineContext.ensureActive() // cancel = "Загрузка отменена"
                            val n = try {
                                body.read(buf)
                            } catch (e: HttpTimeoutException) {
                                throw DownloadError("Истекло время ожидания загрузки обновления")
                            } catch (e: IOException) {
                                throw DownloadError("Загрузка обновления прервана сетевой ошибкой")
                            }
                            if (n < 0) break
                            received += n
                            if (received > manifest.size) throw DownloadError("Загрузка превысила ожидаемый размер файла — прервана", DownloadError.Stage.Sha256)
                            md.update(buf, 0, n)
                            try { out.write(buf, 0, n) } catch (e: IOException) { throw DownloadError("Не удалось сохранить файл обновления на диск") }
                            val now = System.currentTimeMillis()
                            if (now - lastEmit >= 100) { lastEmit = now; onProgress(DownloadProgress(received, manifest.size)) }
                        }
                    }
                } catch (e: java.nio.file.FileAlreadyExistsException) {
                    throw DownloadError("Не удалось сохранить файл обновления на диск")
                }
                onProgress(DownloadProgress(received, manifest.size))
                if (received != manifest.size) throw DownloadError("Размер файла обновления не совпадает с ожидаемым", DownloadError.Stage.Sha256)
                val actual = md.digest().joinToString("") { "%02x".format(it) }
                if (!constantTimeEquals(actual, manifest.sha256)) throw DownloadError("Контрольная сумма (SHA-256) файла обновления не совпадает", DownloadError.Stage.Sha256)
            }
        }
        // verified: only now does the file get its final, runnable name (atomic rename on the same volume)
        if (Files.exists(finalPath, LinkOption.NOFOLLOW_LINKS)) {
            if (Files.isDirectory(finalPath, LinkOption.NOFOLLOW_LINKS)) throw DownloadError("Не удалось сохранить обновление — путь установки занят")
            Files.delete(finalPath) // a stale file or a planted link is removed itself, never followed
        }
        Files.move(tempPath, finalPath, StandardCopyOption.ATOMIC_MOVE)
        return finalPath
    } catch (e: Throwable) {
        runCatching { Files.deleteIfExists(tempPath) }
        if (e is kotlinx.coroutines.CancellationException) throw DownloadError("Загрузка обновления отменена")
        throw e
    }
}
