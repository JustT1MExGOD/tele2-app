package ru.t2sales.desktop.offline

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.StoreInfo

/** What the "add sale" form needs to open without a connection: the last data the server gave this employee. */
class CachedSaleForm(
    val savedAt: Instant,
    val employees: List<EmployeeListItem>,
    val stores: List<StoreInfo>,
    /** employee id -> the store they work at today */
    val storeByEmployee: Map<Int, String>,
    val metrics: List<MetricDef>
)

/**
 * The last successfully loaded form data, kept on disk. It is only ever a fallback: whenever the server answers, fresh data is shown
 * and stored. It holds one employee's view (a different signed-in employee never sees it).
 */
class SaleFormCache(private val file: Path) {
    private val json = Json { ignoreUnknownKeys = true }

    fun save(ownerId: Int, form: CachedSaleForm) {
        runCatching {
            Files.createDirectories(file.parent)
            val doc = buildJsonObject {
                put("owner_id", JsonPrimitive(ownerId))
                put("saved_at", JsonPrimitive(form.savedAt.toString()))
                put("employees", json.encodeToJsonElement(ListSerializer(EmployeeListItem.serializer()), form.employees))
                put("stores", json.encodeToJsonElement(ListSerializer(StoreInfo.serializer()), form.stores))
                put("metrics", json.encodeToJsonElement(ListSerializer(MetricDef.serializer()), form.metrics))
                put("store_by_employee", JsonObject(form.storeByEmployee.entries.associate { (k, v) -> k.toString() to JsonPrimitive(v) }))
            }
            val tmp = file.resolveSibling(file.fileName.toString() + ".tmp")
            Files.writeString(tmp, json.encodeToString(JsonObject.serializer(), doc))
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
    }

    fun load(ownerId: Int): CachedSaleForm? = runCatching {
        if (!Files.isRegularFile(file)) return null
        val doc = json.parseToJsonElement(Files.readString(file)).jsonObject
        if (doc["owner_id"]!!.jsonPrimitive.content.toInt() != ownerId) return null
        CachedSaleForm(
            savedAt = Instant.parse(doc["saved_at"]!!.jsonPrimitive.content),
            employees = json.decodeFromJsonElement(ListSerializer(EmployeeListItem.serializer()), doc["employees"]!!),
            stores = json.decodeFromJsonElement(ListSerializer(StoreInfo.serializer()), doc["stores"]!!),
            metrics = json.decodeFromJsonElement(ListSerializer(MetricDef.serializer()), doc["metrics"]!!),
            storeByEmployee = doc["store_by_employee"]!!.jsonObject.entries.mapNotNull { (k, v) -> k.toIntOrNull()?.let { it to v.jsonPrimitive.content } }.toMap()
        )
    }.getOrNull()
}
