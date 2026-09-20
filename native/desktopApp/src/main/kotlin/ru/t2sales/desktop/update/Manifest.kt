package ru.t2sales.desktop.update

import java.net.URI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/** Runtime version of the native app: single source is `appVersion` in desktopApp/build.gradle.kts (-> app-version.properties). */
object AppVersion {
    val current: String by lazy {
        runCatching {
            AppVersion::class.java.getResourceAsStream("/app-version.properties")?.use { s ->
                java.util.Properties().apply { load(s) }.getProperty("version")?.trim()
            }
        }.getOrNull()?.takeIf { Versions.parse(it) != null } ?: "0.0.0"
    }
}

/** Port of updater/version.ts: numeric MAJOR.MINOR.PATCH comparison (never a string comparison). */
object Versions {
    fun parse(raw: String): List<Int>? {
        val t = raw.trim()
        if (t.isEmpty()) return null
        val parts = t.split('.')
        if (parts.size > 10) return null
        val nums = mutableListOf<Int>()
        for (p in parts) {
            // only plain non-negative integers: no sign, no whitespace, no "v" prefix, no pre-release suffix
            if (p.isEmpty() || !p.all { it in '0'..'9' }) return null
            nums += p.toIntOrNull() ?: return null
        }
        return nums
    }

    /** > 0 if a > b, < 0 if a < b, 0 if equal, null if either does not parse (the caller must not act on null). */
    fun compare(a: String, b: String): Int? {
        val pa = parse(a) ?: return null
        val pb = parse(b) ?: return null
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val x = pa.getOrElse(i) { 0 }
            val y = pb.getOrElse(i) { 0 }
            if (x != y) return x - y
        }
        return 0
    }

    /** Only a well-formed, strictly greater version counts - equal, older or malformed never triggers an update (no downgrades). */
    fun isNewer(current: String, candidate: String): Boolean {
        val cmp = compare(candidate, current) ?: return false
        return cmp > 0
    }
}

const val MAX_INSTALLER_SIZE_BYTES = 500L * 1024 * 1024
private const val MAX_RELEASE_NOTES_LENGTH = 8000

/** Where native installers live on the update server. Electron uses /releases/ on the same host, the native app has its own subtree so the two never mix. */
const val NATIVE_RELEASES_PREFIX = "/native/releases/"

private val SHA256_RE = Regex("^[0-9a-fA-F]{64}$")
private val SAFE_FILENAME_RE = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\\.exe$")
private val WINDOWS_RESERVED = setOf(
    "CON", "PRN", "AUX", "NUL",
    "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
)

data class UpdateManifest(
    val channel: String,
    val version: String,
    val publishedAt: String,
    val mandatory: Boolean,
    val filename: String,
    val url: String,
    val sha256: String,
    val size: Long,
    val releaseNotes: String? = null,
    val minSupportedVersion: String? = null
)

class ManifestValidationError(message: String) : Exception(message)

/** `scheme://host[:port]` with the default port dropped - the unit the update origin is compared by. */
fun originOf(uri: URI): String {
    val port = when {
        uri.port == -1 -> ""
        uri.scheme == "https" && uri.port == 443 -> ""
        uri.scheme == "http" && uri.port == 80 -> ""
        else -> ":${uri.port}"
    }
    return "${uri.scheme.lowercase()}://${uri.host.lowercase()}$port"
}

private fun fail(reason: String): Nothing = throw ManifestValidationError(reason)

/**
 * Port of updater/manifest.ts::validateManifest. The manifest is untrusted input: it must match the channel it was fetched for,
 * the installer URL must be https on the configured update origin under /native/releases/, and the type returned cannot carry
 * a command, arguments or a local path - by construction, nothing but release metadata.
 */
fun validateManifest(raw: JsonElement, expectedChannel: String, allowedOrigin: String): UpdateManifest {
    val m = raw as? JsonObject ?: fail("манифест не является JSON-объектом")
    fun str(name: String): String? = (m[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    if ((m["schemaVersion"] as? JsonPrimitive)?.doubleOrNull != 1.0) fail("неподдерживаемая версия схемы манифеста")

    val channel = str("channel") ?: fail("не указан канал")
    if (channel != "stable" && channel != "beta") fail("недопустимый канал: $channel")
    if (channel != expectedChannel) fail("канал манифеста «$channel» не совпадает с запрошенным «$expectedChannel»")

    val version = str("version")?.takeIf { Versions.parse(it) != null } ?: fail("некорректная версия")
    val publishedAt = str("publishedAt")?.takeIf { runCatching { java.time.Instant.parse(it) }.isSuccess || runCatching { java.time.OffsetDateTime.parse(it) }.isSuccess }
        ?: fail("некорректная дата публикации")

    val mandatoryEl = m["mandatory"] as? JsonPrimitive
    if (mandatoryEl == null || mandatoryEl.isString || mandatoryEl.content != "true" && mandatoryEl.content != "false") fail("mandatory должно быть true или false")
    val mandatory = mandatoryEl.content == "true"

    val installer = m["installer"] as? JsonObject ?: fail("installer должен быть объектом")
    fun istr(name: String): String? = (installer[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    val filename = istr("filename")?.takeIf { SAFE_FILENAME_RE.matches(it) } ?: fail("недопустимое имя установщика")
    if (filename.contains("..") || filename.contains('/') || filename.contains('\\')) fail("имя установщика не должно содержать разделителей пути")
    if (filename.substringBefore('.').uppercase() in WINDOWS_RESERVED) fail("имя установщика зарезервировано Windows")

    val url = istr("url") ?: fail("не указан адрес установщика")
    val parsed = runCatching { URI(url) }.getOrNull()?.takeIf { it.scheme != null && it.host != null } ?: fail("адрес установщика некорректен")
    if (parsed.scheme != "https") fail("адрес установщика должен быть https://")
    if (originOf(parsed) != allowedOrigin) fail("адрес установщика не относится к настроенному серверу обновлений")
    if (!parsed.path.startsWith(NATIVE_RELEASES_PREFIX)) fail("адрес установщика должен лежать в $NATIVE_RELEASES_PREFIX")
    if (parsed.path != "$NATIVE_RELEASES_PREFIX$filename") fail("имя файла в адресе не совпадает с именем установщика")

    val sha256 = istr("sha256")?.takeIf { SHA256_RE.matches(it) } ?: fail("некорректная контрольная сумма SHA-256")

    val sizeD = (installer["size"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
    if (sizeD == null || sizeD <= 0 || sizeD % 1.0 != 0.0) fail("некорректный размер установщика")
    if (sizeD > MAX_INSTALLER_SIZE_BYTES) fail("размер установщика превышает допустимый")

    val notesEl = m["releaseNotes"]
    val notes = if (notesEl == null) null else {
        val s = (notesEl as? JsonPrimitive)?.takeIf { it.isString }?.content ?: fail("releaseNotes должно быть строкой")
        if (s.length > MAX_RELEASE_NOTES_LENGTH) fail("releaseNotes слишком длинные")
        s
    }
    val minEl = m["minSupportedVersion"]
    val min = if (minEl == null) null else {
        (minEl as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { Versions.parse(it) != null } ?: fail("некорректная minSupportedVersion")
    }
    return UpdateManifest(channel, version, publishedAt, mandatory, filename, url, sha256.lowercase(), sizeD.toLong(), notes, min)
}

/** Kept for readability of call sites that only need the text of a primitive. */
internal fun JsonElement?.textOrNull(): String? = (this as? JsonPrimitive)?.contentOrNull
