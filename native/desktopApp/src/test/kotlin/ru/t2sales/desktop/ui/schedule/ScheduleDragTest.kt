package ru.t2sales.desktop.ui.schedule

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import ru.t2sales.shared.api.ScheduleRow

private fun shift(emp: Int, date: String, store: String = "kalinina2", hours: Double? = 12.0, text: String? = "9-21") =
    ScheduleRow(work_date = date, shift_text = text, hours = hours, store_id = store, employee_id = emp, full_name = "Сотрудник $emp", store_name = store, store_short = store.take(4))

private val names = mapOf(1 to "Иванов", 2 to "Петров")
private val nameOf: (Int) -> String = { names[it].orEmpty() }

class ShiftMoveTest {
    private val a = CellKey(1, "2026-09-10")
    private val b = CellKey(2, "2026-09-12")

    @Test fun movingOntoAnEmptyDayTakesTheShiftAndFreesTheSource() {
        val from = shift(1, "2026-09-10", "kosmonavtov", 11.0, "10-21")
        val changes = assertNotNull(planMove(a, from, b, null, nameOf))
        assertEquals(2, changes.size)
        val bulk = toBulk(changes, forward = true)
        // the target gets the same store / hours / text, for the other employee and date
        assertEquals(listOf(1, 2), bulk.map { it.employee_id }.sorted())
        val target = bulk.single { it.employee_id == 2 }
        assertEquals("2026-09-12", target.work_date); assertEquals("kosmonavtov", target.store_id); assertEquals(11, target.hours); assertEquals("10-21", target.shift_text)
        // the source is deleted (hours 0), still naming a real store of the network: the server checks it before deleting
        val source = bulk.single { it.employee_id == 1 }
        assertEquals(0, source.hours); assertEquals("kosmonavtov", source.store_id)
    }

    @Test fun movingOntoAnOccupiedDaySwapsTheTwoShifts() {
        val from = shift(1, "2026-09-10", "kosmonavtov", 11.0, "10-21")
        val to = shift(2, "2026-09-12", "kalinina11", 8.0, "9-17")
        val bulk = toBulk(assertNotNull(planMove(a, from, b, to, nameOf)), forward = true)
        val onA = bulk.single { it.employee_id == 1 }
        val onB = bulk.single { it.employee_id == 2 }
        assertEquals(Triple("kalinina11", 8, "9-17"), Triple(onA.store_id, onA.hours, onA.shift_text)) // the source day now has the other shift
        assertEquals(Triple("kosmonavtov", 11, "10-21"), Triple(onB.store_id, onB.hours, onB.shift_text))
    }

    @Test fun undoRestoresBothCellsExactly() {
        val from = shift(1, "2026-09-10", "kosmonavtov", 11.0, "10-21")
        val to = shift(2, "2026-09-12", "kalinina11", 8.0, "9-17")
        val swap = assertNotNull(planMove(a, from, b, to, nameOf))
        val back = toBulk(swap, forward = false)
        assertEquals(Triple("kosmonavtov", 11, "10-21"), back.single { it.employee_id == 1 }.let { Triple(it.store_id, it.hours, it.shift_text) })
        assertEquals(Triple("kalinina11", 8, "9-17"), back.single { it.employee_id == 2 }.let { Triple(it.store_id, it.hours, it.shift_text) })

        // undoing a plain move: the target cell had no shift, so undo deletes what the move created there
        val move = assertNotNull(planMove(a, from, b, null, nameOf))
        val undoMove = toBulk(move, forward = false)
        val created = undoMove.single { it.employee_id == 2 }
        assertEquals(0, created.hours); assertEquals("kosmonavtov", created.store_id)
        assertEquals(11, undoMove.single { it.employee_id == 1 }.hours)
    }

    @Test fun nothingToDoOrCannotBeSaved() {
        val s = shift(1, "2026-09-10")
        assertNull(planMove(a, s, a, null, nameOf), "same cell")
        assertNull(planMove(a, null, b, null, nameOf), "no shift to pick up")
        assertNull(planMove(a, shift(1, "2026-09-10", hours = 8.5), b, null, nameOf), "the server stores whole hours from this client")
        assertNull(planMove(a, shift(1, "2026-09-10", hours = 0.0), b, null, nameOf), "a day off is not a shift")
        assertNull(planMove(a, s, b, shift(2, "2026-09-12", hours = 7.5), nameOf), "a swap needs both shifts to be whole hours")
    }

    @Test fun localApplyAndUndoGiveBackTheOriginalMonth() {
        val from = shift(1, "2026-09-10", "kosmonavtov", 11.0, "10-21")
        val other = shift(1, "2026-09-11")
        val month = listOf(from, other)
        val changes = assertNotNull(planMove(a, from, b, null, nameOf))
        val moved = applyLocally(month, changes, forward = true)
        assertEquals(2, moved.size)
        assertTrue(moved.none { it.employee_id == 1 && it.work_date == "2026-09-10" }, "the source day is free")
        val target = moved.single { it.employee_id == 2 }
        assertEquals("2026-09-12", target.work_date); assertEquals("Петров", target.full_name); assertEquals("kosmonavtov", target.store_id)
        val back = applyLocally(moved, changes, forward = false)
        assertEquals(setOf(from, other), back.toSet())
    }

    @Test fun datesWithATimeSuffixStillMatchTheirCell() {
        val from = shift(1, "2026-09-10")
        val stamped = from.copy(work_date = "2026-09-10T00:00:00.000Z")
        val changes = assertNotNull(planMove(a, from, b, null, nameOf))
        assertTrue(applyLocally(listOf(stamped), changes, true).none { it.employee_id == 1 })
    }
}

class ShiftDragStateTest {
    private val src = CellKey(1, "2026-09-10")
    private val near = CellKey(1, "2026-09-11")
    private val far = CellKey(2, "2026-09-20")

    private fun drag() = ShiftDrag().also {
        it.bounds[src] = Rect(0f, 0f, 50f, 50f)
        it.bounds[near] = Rect(60f, 0f, 110f, 50f)
        it.bounds[far] = Rect(0f, 300f, 50f, 350f)
    }

    @Test fun targetFollowsThePointerAndNeverIsTheSourceItself() {
        val d = drag()
        d.begin(src, shift(1, "2026-09-10"), Offset(25f, 25f))
        assertNull(d.target, "still over the source")
        d.moveBy(Offset(60f, 0f)) // now at (85, 25)
        assertEquals(near, d.target)
        d.moveBy(Offset(-60f, 300f)) // (25, 325)
        assertEquals(far, d.target)
        d.moveBy(Offset(500f, 0f)) // off every cell
        assertNull(d.target)
    }

    @Test fun finishReturnsFromAndToOnlyWhenDroppedOnACell() {
        val d = drag()
        d.begin(src, shift(1, "2026-09-10"), Offset(25f, 25f))
        d.moveBy(Offset(60f, 0f))
        assertEquals(src to near, d.finish())
        assertTrue(!d.active, "the gesture is over")

        d.begin(src, shift(1, "2026-09-10"), Offset(25f, 25f))
        d.moveBy(Offset(1000f, 1000f))
        assertNull(d.finish(), "dropped in empty space: nothing happens")
    }

    @Test fun cancelForgetsEverything() {
        val d = drag()
        d.begin(src, shift(1, "2026-09-10"), Offset(25f, 25f))
        d.moveBy(Offset(60f, 0f))
        d.cancel()
        assertTrue(!d.active); assertNull(d.target); assertNull(d.finish())
    }
}
