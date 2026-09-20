package ru.t2sales.desktop.ui.home

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

class PaceTest {
    // a store that sells 1 unit at every hour 9..20 (12 hours): an even day
    private val even = (9..20).associateWith { 1.0 }

    // a store whose sales are all in the evening
    private val evening = mapOf(18 to 5.0, 19 to 5.0, 20 to 10.0)

    @Test fun shareFollowsTheProfileAndInterpolatesInsideAnHour() {
        assertEquals(0.0, shareBy(even, 9.0), 1e-9)
        assertEquals(0.5, shareBy(even, 15.0), 1e-9)
        assertEquals(1.0, shareBy(even, 21.0), 1e-9)
        assertEquals(0.5 + 1.0 / 24, shareBy(even, 15.5), 1e-9) // half of the 15:00 hour on top of 6 full hours
        assertEquals(0.0, shareBy(evening, 17.0), 1e-9)
        assertEquals(0.25, shareBy(evening, 19.0), 1e-9)
        assertEquals(1.0, shareBy(evening, 21.0), 1e-9)
    }

    @Test fun beforeOpeningAndAfterClosingAreClamped() {
        assertEquals(0.0, shareBy(even, 6.0), 1e-9)
        assertEquals(1.0, shareBy(even, 23.5), 1e-9)
    }

    @Test fun noHistoryMeansAnEvenDay() {
        assertEquals(0.5, shareBy(emptyMap(), 15.0), 1e-9)
        assertEquals(0.5, shareBy(mapOf(10 to 0.0, 11 to -3.0), 15.0), 1e-9, "zero or negative history is no history")
    }

    @Test fun projectionIsFactDividedByTheShareOfTheDayGone() {
        // 15:00 on an even day: half of the day is gone, 10 done, plan 24 -> ends at 20, that is 83% of the plan
        val p = assertNotNull(computePace(plan = 24.0, fact = 10.0, profile = even, hour = 15.0))
        assertEquals(12.0, p.expectedNow, 1e-9)
        assertEquals(20.0, assertNotNull(p.projected), 1e-9)
        assertEquals(83, p.chancePct)
        assertEquals(-2.0, p.delta, 1e-9)
    }

    @Test fun aheadOfThePaceGivesMoreThanAHundred() {
        val p = assertNotNull(computePace(plan = 20.0, fact = 15.0, profile = even, hour = 15.0))
        assertEquals(30.0, p.projected!!, 1e-9)
        assertEquals(150, p.chancePct)
        assertTrue(p.delta > 0)
    }

    @Test fun tooEarlyInTheDayThereIsNoProjection() {
        // 9:30 on an even day is 4% of the day: one sale would swing the forecast, so none is shown
        val p = assertNotNull(computePace(plan = 24.0, fact = 1.0, profile = even, hour = 9.5))
        assertNull(p.projected)
        assertNull(p.chancePct)
        assertNull(computePace(plan = 24.0, fact = 1.0, profile = even, hour = 7.0)!!.projected)
    }

    @Test fun afterClosingTheProjectionIsTheFact() {
        val p = assertNotNull(computePace(plan = 10.0, fact = 8.0, profile = even, hour = 22.0))
        assertEquals(8.0, p.projected!!, 1e-9)
        assertEquals(80, p.chancePct)
    }

    @Test fun noPlanNoPace() {
        assertNull(computePace(plan = 0.0, fact = 5.0, profile = even, hour = 15.0))
    }

    @Test fun anEveningStoreIsNotJudgedByAnEvenRhythm() {
        // at 16:00 an evening store has done nothing and that is normal: expected 0, and (no share yet) no scary projection
        val p = assertNotNull(computePace(plan = 20.0, fact = 0.0, profile = evening, hour = 16.0))
        assertEquals(0.0, p.expectedNow, 1e-9)
        assertNull(p.projected)
    }

    @Test fun readsTheHeatmapAnswer() {
        val json = Json.parseToJsonElement("""{"hours":[{"hour":9,"total":2},{"hour":10,"total":"3"},{"hour":8,"total":9},{"hour":22,"total":9},{"hour":11,"value":4}]}""").jsonObject
        assertEquals(mapOf(9 to 2.0, 10 to 3.0, 11 to 4.0), hourProfile(json))
    }
}
