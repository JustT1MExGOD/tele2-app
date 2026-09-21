package ru.t2sales.android.offline

import java.io.File
import java.time.Instant
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class Cached<T>(val value: T, val savedAt: Instant)

/**
 * The last good answer of a few read-only requests (the dashboard, the schedule), kept on disk per employee. It is a fallback and a
 * quick first paint - never a source of truth: whenever the server answers, its data replaces the cached data.
 */
class ReadCache(private val dir: File, private val owner: () -> Int?) {
    private val json = Json { ignoreUnknownKeys = true }

    private fun fileFor(key: String): File? {
        val me = owner() ?: return null
        val safe = key.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
        return File(File(dir, me.toString()), "$safe.json")
    }

    fun <T> put(key: String, serializer: KSerializer<T>, value: T) {
        runCatching {
            val file = fileFor(key) ?: return
            file.parentFile?.mkdirs()
            val doc = buildJsonObject {
                put("saved_at", JsonPrimitive(Instant.now().toString()))
                put("data", json.encodeToJsonElement(serializer, value))
            }
            val tmp = File(file.path + ".tmp")
            tmp.writeText(json.encodeToString(JsonObject.serializer(), doc))
            tmp.renameTo(file) // written next to the file first: a crash mid-write never leaves half a copy
        }
    }

    fun <T> get(key: String, serializer: KSerializer<T>): Cached<T>? = runCatching {
        val file = fileFor(key) ?: return null
        if (!file.isFile) return null
        val doc = json.parseToJsonElement(file.readText()).jsonObject
        Cached(json.decodeFromJsonElement(serializer, doc["data"]!!), Instant.parse(doc["saved_at"]!!.jsonPrimitive.content))
    }.getOrNull()
}
