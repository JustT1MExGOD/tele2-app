package ru.t2sales.desktop.system

import java.net.ServerSocket
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import ru.t2sales.desktop.offline.ReadCache
import ru.t2sales.shared.api.ScheduleMonthResponse
import ru.t2sales.shared.api.ScheduleRow

class SingleInstanceTest {
    private fun freePort() = ServerSocket(0).use { it.localPort }

    @Test fun theSecondStartTellsTheFirstToShowItselfAndExits() {
        val port = freePort()
        val shown = CountDownLatch(1)
        assertTrue(SingleInstance.acquire(onShow = { shown.countDown() }, port = port), "the first copy owns the app")
        // a second copy: acquire() reports "not the only one" after poking the first
        assertFalse(SingleInstance.acquire(onShow = { error("the second copy must not become the owner") }, port = port))
        assertTrue(shown.await(3, TimeUnit.SECONDS), "the first copy was asked to come forward")
    }
}

class ReadCacheTest {
    private fun month(vararg emp: Int) = ScheduleMonthResponse(
        "2026-09", emp.map { ScheduleRow(work_date = "2026-09-10", shift_text = "9-21", hours = 12.0, store_id = "kalinina2", employee_id = it, full_name = "Сотрудник $it") }
    )

    @Test fun savesAndReadsBackTheLastAnswerWithItsTime() {
        val dir = Files.createTempDirectory("t2cache")
        var me: Int? = 7
        val cache = ReadCache(dir, owner = { me })
        assertNull(cache.get("schedule.2026-09", ScheduleMonthResponse.serializer()), "nothing saved yet")
        cache.put("schedule.2026-09", ScheduleMonthResponse.serializer(), month(1, 2))
        val back = assertNotNull(cache.get("schedule.2026-09", ScheduleMonthResponse.serializer()))
        assertEquals(listOf(1, 2), back.value.items.map { it.employee_id })
        assertEquals("Сотрудник 2", back.value.items[1].full_name)
        assertTrue(back.savedAt.isBefore(java.time.Instant.now().plusSeconds(5)))
        // a fresh answer replaces the old one
        cache.put("schedule.2026-09", ScheduleMonthResponse.serializer(), month(9))
        assertEquals(listOf(9), cache.get("schedule.2026-09", ScheduleMonthResponse.serializer())!!.value.items.map { it.employee_id })
        // the cache belongs to one employee: somebody else on the same PC sees nothing, and signed out sees nothing
        me = 8
        assertNull(cache.get("schedule.2026-09", ScheduleMonthResponse.serializer()))
        me = null
        assertNull(cache.get("schedule.2026-09", ScheduleMonthResponse.serializer()))
        cache.put("schedule.2026-09", ScheduleMonthResponse.serializer(), month(5)) // signed out: silently not saved
        me = 7
        assertEquals(listOf(9), cache.get("schedule.2026-09", ScheduleMonthResponse.serializer())!!.value.items.map { it.employee_id })
    }

    @Test fun aDamagedFileIsJustAMissAndKeysCannotEscapeTheFolder() {
        val dir = Files.createTempDirectory("t2cache")
        val cache = ReadCache(dir, owner = { 7 })
        cache.put("home.stats", ScheduleMonthResponse.serializer(), month(1))
        Files.writeString(dir.resolve("7").resolve("home.stats.json"), "{ broken")
        assertNull(cache.get("home.stats", ScheduleMonthResponse.serializer()))
        cache.put("../../evil", ScheduleMonthResponse.serializer(), month(1))
        assertTrue(Files.walk(dir).use { s -> s.allMatch { it.startsWith(dir) } }, "nothing was written outside the cache folder")
    }
}
