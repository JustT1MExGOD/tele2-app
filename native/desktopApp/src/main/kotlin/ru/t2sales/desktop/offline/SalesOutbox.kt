package ru.t2sales.desktop.offline

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.t2sales.shared.api.ApiException

enum class OutboxStatus { Pending, Review }

/**
 * One sale entered without a connection. [body] is the exact request `POST /sales` will get: it already carries the `client_id`
 * (the server de-duplicates on it, so a retry after a lost answer never doubles the sale) and `occurred_at` (the real moment of
 * the sale, so the hourly heatmap is right even when the send happens hours later).
 */
class PendingSale(
    val clientId: String,
    val ownerId: Int,
    val summary: String,
    val body: JsonObject,
    val createdAt: String,
    val status: OutboxStatus = OutboxStatus.Pending,
    val attempts: Int = 0,
    val error: String? = null
)

/** What to do with one failed send. */
internal enum class Verdict {
    /** The server looked at it and said no (409 = needs reconciliation, other 4xx = invalid): never retry blindly, a person decides. */
    Review,

    /** No connection, the session expired or the server is failing: keep it, stop this pass, try again later. */
    KeepAndStop
}

internal fun classify(e: Throwable): Verdict {
    if (e !is ApiException) return Verdict.KeepAndStop // I/O error, timeout, relay down: no answer at all
    val s = e.statusCode
    return when {
        s == 401 || s == 403 || s == 408 || s == 425 || s == 429 -> Verdict.KeepAndStop // sign in again / slow down
        s in 400..499 -> Verdict.Review // 400 invalid, 409 changed-data replay, 404 gone ...
        else -> Verdict.KeepAndStop // 5xx
    }
}

data class FlushResult(val sent: Int, val review: Int, val stoppedByError: Boolean)

/**
 * Sales entered offline (or when the server is unreachable), kept on disk until they can be sent. Only sales are queued: every one is
 * idempotent on the server by `client_id`, other actions (shifts, tasks, chat) simply say the connection is missing.
 *
 * The file survives restarts. Each item belongs to the employee who entered it and is sent only in that person's session.
 */
class SalesOutbox(
    private val file: Path,
    private val owner: () -> Int?,
    private val send: suspend (JsonObject) -> Unit,
    private val clock: () -> Instant = { Instant.now() }
) {
    private var all by mutableStateOf(load())
    private val lock = Mutex()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** Called after a pass that delivered something (screens refresh, a toast is shown). Runs on a background thread. */
    var onSent: (Int) -> Unit = {}

    /** The current employee's queue (other people's items on a shared PC are never shown or sent). */
    val items: List<PendingSale> get() = owner()?.let { me -> all.filter { it.ownerId == me } }.orEmpty()
    val pendingCount: Int get() = items.count { it.status == OutboxStatus.Pending }
    val reviewCount: Int get() = items.count { it.status == OutboxStatus.Review }

    fun enqueue(body: JsonObject, summary: String): PendingSale {
        val me = requireNotNull(owner()) { "не выполнен вход" }
        val clientId = body["client_id"]?.jsonPrimitive?.contentOrNull ?: error("в продаже нет client_id")
        val stamped = if ("occurred_at" in body) body else JsonObject(body + ("occurred_at" to JsonPrimitive(clock().toString())))
        val item = PendingSale(clientId, me, summary, stamped, clock().toString())
        // the same sale entered twice (a double click after a failure) is one queue entry
        all = all.filter { it.clientId != clientId } + item
        save()
        return item
    }

    fun discard(clientId: String) {
        all = all.filter { it.clientId != clientId }
        save()
    }

    /** One pass over the queue, oldest first. Concurrent calls collapse into one. */
    suspend fun flush(): FlushResult {
        if (!lock.tryLock()) return FlushResult(0, 0, false)
        try {
            var sent = 0
            var review = 0
            var stopped = false
            for (item in items.filter { it.status == OutboxStatus.Pending }) {
                try {
                    send(item.body)
                    all = all.filter { it.clientId != item.clientId } // a "deduped" answer from the server is a success too
                    sent++
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    when (classify(e)) {
                        Verdict.Review -> {
                            review++
                            replace(item.clientId) { it.copy(status = OutboxStatus.Review, attempts = it.attempts + 1, error = (e as? ApiException)?.message ?: "Сервер отклонил продажу") }
                        }
                        Verdict.KeepAndStop -> {
                            replace(item.clientId) { it.copy(attempts = it.attempts + 1) }
                            stopped = true
                        }
                    }
                    if (stopped) break
                }
            }
            save()
            if (sent > 0) onSent(sent)
            return FlushResult(sent, review, stopped)
        } finally {
            lock.unlock()
        }
    }

    /** Tries the queue in the background while the app runs; a pass costs nothing when it is empty. */
    fun start(intervalMs: Long = 20_000) {
        scope.launch {
            while (isActive) {
                if (owner() != null && pendingCount > 0) flush()
                delay(intervalMs)
            }
        }
    }

    /**
     * Development only (`T2_OUTBOX_DEMO=1` with `gradle run`): puts two entries in the queue to look at the indicator and the list. They are
     * both marked as rejected, so nothing is ever sent to the server, and both are removed from the list with "Удалить".
     */
    fun seedDemoForReview() {
        val me = owner() ?: return
        if (all.any { it.clientId.startsWith("demo-") }) return
        all = all + listOf(
            PendingSale("demo-1", me, "SIM × 2, Телефоны × 1", buildJsonObject { put("client_id", JsonPrimitive("demo-1")) }, clock().toString(), OutboxStatus.Review, 1, "Результат операции требует сверки"),
            PendingSale("demo-2", me, "MNP × 1", buildJsonObject { put("client_id", JsonPrimitive("demo-2")) }, clock().toString(), OutboxStatus.Review, 1, "Некорректное значение mnp")
        )
        save()
    }

    private fun replace(clientId: String, f: (PendingSale) -> PendingSale) {
        all = all.map { if (it.clientId == clientId) f(it) else it }
    }

    // ------------------------------------------------------------------ disk

    private fun PendingSale.copy(status: OutboxStatus = this.status, attempts: Int = this.attempts, error: String? = this.error) =
        PendingSale(clientId, ownerId, summary, body, createdAt, status, attempts, error)

    private fun save() {
        runCatching {
            Files.createDirectories(file.parent)
            val json = buildJsonObject {
                put("version", JsonPrimitive(1))
                put("items", JsonArray(all.map { it.toJson() }))
            }
            val tmp = file.resolveSibling(file.fileName.toString() + ".tmp")
            Files.writeString(tmp, Json.encodeToString(JsonObject.serializer(), json))
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
    }

    private fun load(): List<PendingSale> {
        if (!Files.isRegularFile(file)) return emptyList()
        return try {
            Json.parseToJsonElement(Files.readString(file)).jsonObject["items"]!!.jsonArray.map { it.jsonObject.toPending() }
        } catch (e: Exception) {
            // a damaged file must not stop the app: keep it aside for a look and start clean
            runCatching { Files.move(file, file.resolveSibling(file.fileName.toString() + ".bad"), StandardCopyOption.REPLACE_EXISTING) }
            emptyList()
        }
    }
}

private fun PendingSale.toJson() = buildJsonObject {
    put("client_id", JsonPrimitive(clientId))
    put("owner_id", JsonPrimitive(ownerId))
    put("summary", JsonPrimitive(summary))
    put("body", body)
    put("created_at", JsonPrimitive(createdAt))
    put("status", JsonPrimitive(status.name))
    put("attempts", JsonPrimitive(attempts))
    error?.let { put("error", JsonPrimitive(it)) }
}

private fun JsonObject.toPending() = PendingSale(
    clientId = this["client_id"]!!.jsonPrimitive.content,
    ownerId = this["owner_id"]!!.jsonPrimitive.intOrNull!!,
    summary = this["summary"]!!.jsonPrimitive.content,
    body = this["body"]!!.jsonObject,
    createdAt = this["created_at"]!!.jsonPrimitive.content,
    status = runCatching { OutboxStatus.valueOf(this["status"]!!.jsonPrimitive.content) }.getOrDefault(OutboxStatus.Pending),
    attempts = this["attempts"]?.jsonPrimitive?.intOrNull ?: 0,
    error = this["error"]?.jsonPrimitive?.contentOrNull
)
