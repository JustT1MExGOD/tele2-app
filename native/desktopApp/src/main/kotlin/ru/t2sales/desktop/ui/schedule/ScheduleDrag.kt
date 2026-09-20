package ru.t2sales.desktop.ui.schedule

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import ru.t2sales.shared.api.ScheduleBulkItem
import ru.t2sales.shared.api.ScheduleRow

/** One schedule cell: an employee on a date (the server keeps at most one shift per pair). */
internal data class CellKey(val employeeId: Int, val date: String)

/** What happens to one cell: [before] -> [after] (null = no shift). */
internal class ShiftChange(val key: CellKey, val before: ScheduleRow?, val after: ScheduleRow?)

/** Hours the server can store from this client: a whole positive number (the same rule as the edit dialog). */
internal fun ScheduleRow.wholeHours(): Int? = hours?.takeIf { it > 0 && it % 1.0 == 0.0 }?.toInt()

private fun ScheduleRow.movedTo(key: CellKey, nameOf: (Int) -> String) = copy(work_date = key.date, employee_id = key.employeeId, full_name = nameOf(key.employeeId))

/**
 * Dragging a shift from [from] onto [to]: an empty target takes the shift and the source becomes free; an occupied target swaps places
 * with it. Returns null when there is nothing to do (same cell, no shift to move) or the shifts cannot be saved as they are.
 */
internal fun planMove(from: CellKey, fromRow: ScheduleRow?, to: CellKey, toRow: ScheduleRow?, nameOf: (Int) -> String): List<ShiftChange>? {
    if (from == to || fromRow == null || fromRow.wholeHours() == null) return null
    if (toRow != null && toRow.wholeHours() == null) return null
    return listOf(
        ShiftChange(from, fromRow, toRow?.movedTo(from, nameOf)),
        ShiftChange(to, toRow, fromRow.movedTo(to, nameOf))
    )
}

/**
 * The request for [changes] (or for undoing them: [forward] = false). One request, applied by the server in one transaction, so a swap
 * can never end up half done. `hours = 0` deletes a shift; the delete still names a real store of the network (the server checks it),
 * so the store of the shift that is being removed is used.
 */
internal fun toBulk(changes: List<ShiftChange>, forward: Boolean): List<ScheduleBulkItem> = changes.map { c ->
    val wanted = if (forward) c.after else c.before
    val current = if (forward) c.before else c.after
    if (wanted != null) ScheduleBulkItem(c.key.employeeId, c.key.date, wanted.store_id, wanted.wholeHours()!!, wanted.shift_text.orEmpty())
    else ScheduleBulkItem(c.key.employeeId, c.key.date, current!!.store_id, 0, "")
}

/** The month's rows after applying (or undoing) [changes], without asking the server again. */
internal fun applyLocally(rows: List<ScheduleRow>, changes: List<ShiftChange>, forward: Boolean): List<ScheduleRow> {
    val touched = changes.map { it.key }.toSet()
    val kept = rows.filterNot { CellKey(it.employee_id, it.work_date.take(10)) in touched }
    return kept + changes.mapNotNull { if (forward) it.after else it.before }
}

/** Drag-and-drop state shared by every employee's calendar on the screen. Positions are in window coordinates. */
internal class ShiftDrag {
    /** Where each visible cell is; cells report it while composed. Read on pointer moves, so it is a plain map. */
    val bounds = HashMap<CellKey, Rect>()

    var source by mutableStateOf<CellKey?>(null)
        private set
    var sourceRow by mutableStateOf<ScheduleRow?>(null)
        private set
    var pointer by mutableStateOf(Offset.Zero)
        private set
    var target by mutableStateOf<CellKey?>(null)
        private set

    val active: Boolean get() = source != null

    fun begin(key: CellKey, row: ScheduleRow, at: Offset) {
        source = key; sourceRow = row; pointer = at; target = null
    }

    fun moveBy(delta: Offset) {
        pointer += delta
        val s = source
        target = bounds.entries.firstOrNull { (k, r) -> k != s && r.contains(pointer) }?.key
    }

    /** Ends the gesture; returns (from, to) when it was dropped on a cell. */
    fun finish(): Pair<CellKey, CellKey>? {
        val s = source
        val t = target
        cancel()
        return if (s != null && t != null) s to t else null
    }

    fun cancel() {
        source = null; sourceRow = null; target = null
    }
}
