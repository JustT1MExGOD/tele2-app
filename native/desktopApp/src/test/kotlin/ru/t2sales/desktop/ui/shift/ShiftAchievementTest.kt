package ru.t2sales.desktop.ui.shift

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

class ShiftAchievementTest {
    @Test fun unitsAreTheFourMetricsOfOneEmployeeOnly() {
        val rows = Json.parseToJsonElement(
            """[{"employee_id":7,"sim":"3","mnp":1,"pa":0,"combo":2,"phones":50000},
                {"employee_id":8,"sim":9,"mnp":9},
                {"employee_id":7,"sim":1}]"""
        ).jsonArray
        assertEquals(7, unitsOf(rows, 7), "3 + 1 + 0 + 2 + 1; money metrics are not units")
        assertEquals(18, unitsOf(rows, 8))
        assertEquals(0, unitsOf(rows, 99))
        assertEquals(0, unitsOf(Json.parseToJsonElement("[]").jsonArray, 7))
    }

    @Test fun summaryTextForAChat() {
        val data = Json.parseToJsonElement(
            """{"score":92,"ideal_shift":"true","fact":{"sim":7,"mnp":2,"pa":1,"combo":0},"day_plan":{"sim":7,"mnp":2,"pa":1,"combo":1},
                "gamification":{"xp_gained":120,"streak_days":6}}"""
        ).jsonObject
        val t = shiftSummaryText(data)
        assertTrue(t.startsWith("🏆 Идеальная смена · итог 92"), t)
        assertTrue("SIM 7/7, MNP 2/2, ПА 1/1, Комбо 0/1" in t, t)
        assertTrue("+120 XP" in t && "🔥 6 дн. подряд" in t, t)
    }

    @Test fun anOrdinaryShiftAndMissingPartsStayQuiet() {
        val data = Json.parseToJsonElement("""{"score":40.5,"fact":{"sim":1},"day_plan":{"sim":5},"gamification":{}}""").jsonObject
        val t = shiftSummaryText(data)
        assertEquals("Смена закрыта · итог 40,5 · SIM 1/5", t) // the Russian decimal comma, on any computer
    }
}
