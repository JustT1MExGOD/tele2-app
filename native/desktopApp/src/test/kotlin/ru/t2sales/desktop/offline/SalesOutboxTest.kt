package ru.t2sales.desktop.offline

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.StoreInfo

private fun sale(clientId: String, sim: Int = 1) = buildJsonObject {
    put("employee_id", JsonPrimitive(7))
    put("store_id", JsonPrimitive("kalinina2"))
    put("sale_date", JsonPrimitive("2026-09-21"))
    put("client_id", JsonPrimitive(clientId))
    put("sim", JsonPrimitive(sim))
}

private class Harness(val dir: Path = Files.createTempDirectory("t2outbox"), var me: Int? = 7) {
    val file: Path = dir.resolve("pending-sales.json")
    val sent = mutableListOf<JsonObject>()
    var behaviour: (JsonObject) -> Unit = {}
    fun make() = SalesOutbox(file, owner = { me }, send = { sent.add(it); behaviour(it) }, clock = { Instant.parse("2026-09-21T15:04:05Z") })
}

class SalesOutboxTest {
    @Test fun queueSurvivesARestartAndKeepsTheRealMomentOfTheSale() {
        val h = Harness()
        h.make().enqueue(sale("a"), "SIM × 1")
        val reopened = h.make() // a new process reading the same file
        assertEquals(1, reopened.pendingCount)
        val item = reopened.items.single()
        assertEquals("a", item.clientId)
        assertEquals("SIM × 1", item.summary)
        // occurred_at is fixed when the sale is entered, not when it is finally sent: the hourly heatmap stays right
        assertEquals("2026-09-21T15:04:05Z", item.body["occurred_at"]!!.let { (it as JsonPrimitive).content })
    }

    @Test fun sendsOldestFirstAndEmptiesTheQueue() = runBlocking {
        val h = Harness()
        val box = h.make()
        box.enqueue(sale("a"), "1"); box.enqueue(sale("b"), "2"); box.enqueue(sale("c"), "3")
        var announced = 0
        box.onSent = { announced = it }
        val r = box.flush()
        assertEquals(3, r.sent)
        assertEquals(listOf("a", "b", "c"), h.sent.map { (it["client_id"] as JsonPrimitive).content })
        assertEquals(0, box.items.size)
        assertEquals(3, announced)
        assertEquals(0, h.make().items.size) // and the file agrees
    }

    @Test fun noConnectionKeepsEverythingAndStopsThePass() = runBlocking {
        val h = Harness()
        h.behaviour = { throw IOException("unreachable") }
        val box = h.make()
        box.enqueue(sale("a"), "1"); box.enqueue(sale("b"), "2")
        val r = box.flush()
        assertEquals(0, r.sent)
        assertTrue(r.stoppedByError)
        assertEquals(1, h.sent.size, "after the first failure the rest is not even tried")
        assertEquals(2, box.pendingCount)
        assertEquals(1, box.items.first { it.clientId == "a" }.attempts)
    }

    @Test fun serverRejectionGoesToReviewAndTheNextSaleStillGoes() = runBlocking {
        val h = Harness()
        h.behaviour = { if ((it["client_id"] as JsonPrimitive).content == "a") throw ApiException(409, null, "Результат операции требует сверки") }
        val box = h.make()
        box.enqueue(sale("a"), "1"); box.enqueue(sale("b"), "2")
        val r = box.flush()
        assertEquals(1, r.sent)
        assertEquals(1, r.review)
        assertFalse(r.stoppedByError)
        val a = box.items.single()
        assertEquals(OutboxStatus.Review, a.status)
        assertEquals("Результат операции требует сверки", a.error)
        // a rejected sale is never re-sent on its own
        h.sent.clear()
        box.flush()
        assertTrue(h.sent.isEmpty())
        box.discard("a")
        assertEquals(0, box.items.size)
    }

    @Test fun classificationOfServerAnswers() {
        assertEquals(Verdict.Review, classify(ApiException(400, null, "x")))
        assertEquals(Verdict.Review, classify(ApiException(409, null, "x")))
        assertEquals(Verdict.Review, classify(ApiException(404, null, "x")))
        assertEquals(Verdict.KeepAndStop, classify(ApiException(401, null, "x"))) // session expired: sign in again, the sale is not lost
        assertEquals(Verdict.KeepAndStop, classify(ApiException(403, null, "x")))
        assertEquals(Verdict.KeepAndStop, classify(ApiException(429, null, "x")))
        assertEquals(Verdict.KeepAndStop, classify(ApiException(500, null, "x")))
        assertEquals(Verdict.KeepAndStop, classify(ApiException(503, null, "x")))
        assertEquals(Verdict.KeepAndStop, classify(IOException("timeout")))
    }

    @Test fun onePersonsQueueIsNeverShownOrSentInAnothersSession() = runBlocking {
        val h = Harness(me = 7)
        h.make().enqueue(sale("mine"), "1")
        h.me = 9 // somebody else signs in on the same PC
        val box = h.make()
        assertEquals(0, box.items.size)
        assertEquals(0, box.pendingCount)
        assertEquals(0, box.flush().sent)
        assertTrue(h.sent.isEmpty())
        h.me = null // signed out
        assertEquals(0, h.make().items.size)
        h.me = 7
        assertEquals(1, h.make().items.size)
    }

    @Test fun theSameSaleEnteredTwiceIsOneEntry() {
        val h = Harness()
        val box = h.make()
        box.enqueue(sale("a"), "1")
        box.enqueue(sale("a"), "1")
        assertEquals(1, box.items.size)
    }

    @Test fun aDamagedFileDoesNotStopTheAppAndIsKeptAside() {
        val h = Harness()
        Files.writeString(h.file, "{ this is not json")
        val box = h.make()
        assertEquals(0, box.items.size)
        assertTrue(Files.exists(h.file.resolveSibling("pending-sales.json.bad")))
        box.enqueue(sale("a"), "1") // and the queue works again
        assertEquals(1, h.make().items.size)
    }
}

class SaleFormCacheTest {
    private fun form() = CachedSaleForm(
        savedAt = Instant.parse("2026-09-21T10:00:00Z"),
        employees = listOf(EmployeeListItem(7, "Иванов Иван"), EmployeeListItem(8, "Петров Пётр", role = "senior")),
        stores = listOf(StoreInfo("kalinina2", "Калинина 2", "#ff6d01")),
        storeByEmployee = mapOf(7 to "kalinina2"),
        metrics = listOf(MetricDef("sim", "SIM", unit = "шт"))
    )

    @Test fun roundTripAndOnlyForTheSameEmployee() {
        val file = Files.createTempDirectory("t2cache").resolve("sale-form-cache.json")
        val cache = SaleFormCache(file)
        assertNull(cache.load(7)) // nothing saved yet
        cache.save(7, form())
        val back = assertNotNull(cache.load(7))
        assertEquals(Instant.parse("2026-09-21T10:00:00Z"), back.savedAt)
        assertEquals(listOf("Иванов Иван", "Петров Пётр"), back.employees.map { it.full_name })
        assertEquals("senior", back.employees[1].role)
        assertEquals("Калинина 2", back.stores.single().name)
        assertEquals(mapOf(7 to "kalinina2"), back.storeByEmployee)
        assertEquals("SIM", back.metrics.single().label)
        assertNull(cache.load(8), "another employee never sees this data")
    }

    @Test fun aDamagedCacheIsJustAMiss() {
        val file = Files.createTempDirectory("t2cache").resolve("sale-form-cache.json")
        Files.writeString(file, "garbage")
        assertNull(SaleFormCache(file).load(7))
    }
}
