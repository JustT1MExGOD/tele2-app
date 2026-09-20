package ru.t2sales.desktop.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.HorizontalScrollbar
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollbarAdapter
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.DropdownMenu
import androidx.compose.material.DropdownMenuItem
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import androidx.compose.ui.window.Dialog
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.FieldBox
import ru.t2sales.desktop.ui.components.FieldLabel
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.api.ScheduleApi
import ru.t2sales.shared.api.ScheduleBulkItem
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val MOSCOW = ZoneId.of("Europe/Moscow")
private val MONTHS = listOf(
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
)
private val WEEKDAYS_MON = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")

private const val REPLACEMENT_STORE_ID = "__REPLACEMENT__"
private val REPLACEMENT_COLOR = Color(0xFF00C853)
private val STORE_COLORS = mapOf(
    "kosmonavtov" to "#6d9eeb",
    "kalinina2" to "#ff6d01",
    "kalinina11" to "#ffd966"
)
private val DEFAULT_STORE_COLOR = Color(0xFF2AABEE)

private fun parseHex(hex: String): Color? = runCatching {
    val h = hex.removePrefix("#")
    Color(("FF" + if (h.length == 3) h.map { "$it$it" }.joinToString("") else h).toLong(16))
}.getOrNull()

private fun storeColor(storeId: String, stores: Map<String, StoreInfo>): Color {
    if (storeId == REPLACEMENT_STORE_ID) return REPLACEMENT_COLOR
    return stores[storeId]?.color?.let(::parseHex)
        ?: STORE_COLORS[storeId]?.let(::parseHex)
        ?: DEFAULT_STORE_COLOR
}

private fun storeShort(row: ScheduleRow, limit: Int): String =
    if (row.store_id == REPLACEMENT_STORE_ID) "Замена"
    else (row.store_short ?: row.store_name ?: "").take(limit)

/** Read-only port of pages/schedule: header, month switcher, team summary grid (manager tier) and personal calendar. */
@Composable
fun ScheduleScreen(scheduleApi: ScheduleApi, teamApi: TeamApi, myEmployeeId: Int?, role: String?, canEdit: Boolean) {
    val today = remember { LocalDate.now(MOSCOW) }
    var month by remember { mutableStateOf(YearMonth.from(today)) }
    var rows by remember { mutableStateOf<List<ScheduleRow>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var stores by remember { mutableStateOf<Map<String, StoreInfo>>(emptyMap()) }
    var employees by remember { mutableStateOf<List<EmployeeListItem>?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    var editing by remember { mutableStateOf<EditTarget?>(null) }
    var draft by remember { mutableStateOf<ScheduleDraft?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { scheduleApi.getOrgStores() }.onSuccess { r -> stores = r.stores.associateBy { it.id } }
        runCatching { teamApi.getEmployees() }.onSuccess { employees = it }.onFailure { employees = emptyList() }
    }
    LaunchedEffect(month, reloadKey) {
        rows = null
        failed = false
        runCatching { scheduleApi.getScheduleMonth(month.toString()) }
            .onSuccess { rows = it.items }
            .onFailure { failed = true }
    }

    MonthSwitcher(month) { month = it }

    val list = rows
    val managerTier = role == "manager" || role == "senior" || role == "admin"
    when {
        failed -> Text("Ошибка загрузки графика — не удалось получить смены", color = T2Colors.danger)
        list == null || employees == null -> CircularProgressIndicator()
        else -> {
            if (managerTier) {
                Text(
                    "Сводный график команды",
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = T2Colors.text,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                SummaryGrid(list, employees.orEmpty(), month, stores, today)
                Spacer(Modifier.height(T2Spacing.sp3))
            }
            if (canEdit) {
                DraftSection(scheduleApi, stores, employees.orEmpty(), draft, { draft = it }, { reloadKey++ })
                Spacer(Modifier.height(T2Spacing.sp3))
                Text(
                    "Нажми на день, чтобы поставить / убрать смену",
                    color = T2Colors.hint,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                )
            }
            val byEmp = list.groupBy { it.employee_id }
            val people = employees.orEmpty().map { it.id to it.full_name }
                .plus(list.filter { r -> employees.orEmpty().none { it.id == r.employee_id } }.map { it.employee_id to it.full_name }.distinct())
                .sortedBy { it.second.lowercase() }
            if (people.isEmpty()) Text("Нет данных", color = T2Colors.hint, modifier = Modifier.fillMaxWidth().padding(24.dp), textAlign = TextAlign.Center)
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 0.dp)) {
                WEEKDAYS_MON.forEach {
                    Text(it.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(2.dp))
            val draftByEmp = draft?.byEmployee().orEmpty()
            people.forEach { (empId, name) ->
                val days = byEmp[empId].orEmpty().associateBy { it.work_date.take(10) }
                val shape = RoundedCornerShape(T2Radius.default)
                Column(
                    modifier = Modifier
                        .padding(bottom = 12.dp)
                        .fillMaxWidth()
                        .clip(shape)
                        .background(T2Colors.surface)
                        .border(1.dp, T2Colors.border, shape)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(name, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text("${days.size} смен", color = T2Colors.hint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                    MonthGrid(
                        month, days, today, stores,
                        draftByDate = draftByEmp[empId].orEmpty(),
                        onDayClick = if (canEdit) { date, row -> editing = EditTarget(empId, name, date, row) } else null
                    )
                }
            }
        }
    }

    val target = editing
    if (target != null) {
        EditShiftDialog(
            target = target,
            stores = stores.values.sortedBy { it.name },
            onDismiss = { editing = null },
            onSave = { item, onError ->
                scope.launch {
                    runCatching { scheduleApi.saveShift(item) }
                        .onSuccess {
                            if (it.count == 1) { editing = null; reloadKey++ }
                            else onError("Смена не сохранена: обновите график и повторите")
                        }
                        .onFailure { onError(it.message ?: "Нет прав") }
                }
            }
        )
    }
}

@Composable
private fun InfoCard(label: String, value: String, sub: String?, modifier: Modifier) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(
        modifier = modifier
            .clip(shape)
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, shape)
            .padding(T2Spacing.sp4)
    ) {
        Text(label.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.overline)
        Text(value, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        if (!sub.isNullOrBlank()) Text(sub, color = T2Colors.hint, style = MaterialTheme.typography.caption)
    }
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.xl)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, shape)
            .padding(T2Spacing.sp4)
    ) { content() }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        color = T2Colors.hint,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.overline,
        modifier = Modifier.padding(bottom = T2Spacing.sp2)
    )
}

@Composable
private fun MonthSwitcher(month: YearMonth, onChange: (YearMonth) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        NavButton("\u2039") { onChange(month.minusMonths(1)) }
        Text("${MONTHS[month.monthValue - 1]} ${month.year}", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
        NavButton("\u203A") { onChange(month.plusMonths(1)) }
    }
}

@Composable
private fun NavButton(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Text(label, fontSize = 20.sp) }
}

private val CELL_W = 58.dp
private val CELL_H = 44.dp
private val NAME_W = 140.dp
private val HOURS_H = 32.dp

@Composable
private fun SummaryGrid(all: List<ScheduleRow>, employees: List<EmployeeListItem>, month: YearMonth, stores: Map<String, StoreInfo>, today: LocalDate) {
    val grouped = all.groupBy { it.employee_id }
    val byEmp = (employees.map { it.id to it.full_name } + all.filter { r -> employees.none { it.id == r.employee_id } }.map { it.employee_id to it.full_name }.distinct())
        .map { (id, name) -> name to grouped[id].orEmpty().associateBy { it.work_date.take(10) } }
        .sortedBy { it.first.lowercase() }
    if (byEmp.isEmpty()) {
        Text("Нет данных", color = T2Colors.hint)
        return
    }
    val total = month.lengthOfMonth()
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val cellPx = with(LocalDensity.current) { (CELL_W + 4.dp).roundToPx() }
    LaunchedEffect(month) {
        if (YearMonth.from(today) == month) scroll.scrollTo(((today.dayOfMonth - 3).coerceAtLeast(0)) * cellPx)
    }
    val weekdays = listOf("пн", "вт", "ср", "чт", "пт", "сб", "вс")

    Column {
    Row {
        Column {
            NameCell("ФИО", CELL_H)
            byEmp.forEach { (name, _) ->
                NameCell(name, CELL_H + HOURS_H + 4.dp)
            }
        }
        Column(
            modifier = Modifier
                .horizontalScroll(scroll)
                .pointerInput(Unit) {
                    detectDragGestures { change, drag ->
                        change.consume()
                        scope.launch { scroll.scrollBy(-drag.x) }
                    }
                }
        ) {
            Row {
                for (d in 1..total) {
                    val date = month.atDay(d)
                    val weekend = date.dayOfWeek.value >= 6
                    Column(
                        modifier = Modifier
                            .padding(2.dp)
                            .size(CELL_W, CELL_H)
                            .clip(RoundedCornerShape(T2Radius.xs))
                            .background(if (weekend) T2Colors.dangerSoft else T2Colors.surface2),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(d.toString(), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text(weekdays[date.dayOfWeek.value - 1], color = T2Colors.hint, fontSize = 10.sp)
                    }
                }
            }
            byEmp.forEach { (_, days) ->
                Row {
                    for (d in 1..total) ShiftCell(days[month.atDay(d).toString()], stores, CELL_H, isHours = false)
                }
                Row {
                    for (d in 1..total) ShiftCell(days[month.atDay(d).toString()], stores, HOURS_H, isHours = true)
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
    HorizontalScrollbar(
        adapter = rememberScrollbarAdapter(scroll),
        modifier = Modifier.fillMaxWidth().padding(start = NAME_W + 4.dp, top = 4.dp)
    )
    }
}

@Composable
private fun NameCell(name: String, height: androidx.compose.ui.unit.Dp) {
    Box(
        modifier = Modifier
            .padding(2.dp)
            .size(NAME_W, height)
            .clip(RoundedCornerShape(T2Radius.xs))
            .background(T2Colors.surface2),
        contentAlignment = Alignment.Center
    ) {
        Text(name, fontWeight = FontWeight.Bold, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 8.dp))
    }
}

@Composable
private fun ShiftCell(row: ScheduleRow?, stores: Map<String, StoreInfo>, height: androidx.compose.ui.unit.Dp, isHours: Boolean) {
    val hours = row?.hours ?: 0.0
    val off = row == null || hours <= 0
    val shape = RoundedCornerShape(T2Radius.xs)
    val base = Modifier.padding(2.dp).size(CELL_W, height).clip(shape)
    if (off) {
        Box(
            modifier = base.background(T2Colors.surface2),
            contentAlignment = Alignment.Center
        ) { Text(if (isHours) "0" else "вых", color = T2Colors.hint, fontSize = 11.sp) }
    } else {
        val col = storeColor(row!!.store_id, stores)
        Column(
            modifier = base.background(col.copy(alpha = 0.13f)).border(1.dp, col, shape),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (isHours) {
                Text(hours.toInt().toString(), color = col, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            } else {
                Text(row.shift_text ?: "", color = col, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(storeShort(row, 6), color = col, fontSize = 9.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun MonthGrid(
    month: YearMonth,
    mine: Map<String, ScheduleRow>,
    today: LocalDate,
    stores: Map<String, StoreInfo>,
    draftByDate: Map<String, kotlinx.serialization.json.JsonObject> = emptyMap(),
    onDayClick: ((LocalDate, ScheduleRow?) -> Unit)? = null
) {
    val first = month.atDay(1)
    val offset = first.dayOfWeek.value - 1
    val total = month.lengthOfMonth()
    val weeks = (offset + total + 6) / 7
    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (w in 0 until weeks) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (c in 0 until 7) {
                    val date = first.plusDays((w * 7 + c - offset).toLong())
                    val inMonth = date.month == month.month && date.year == month.year
                    Box(modifier = Modifier.weight(1f)) {
                        if (!inMonth) {
                            PadCell(date.dayOfMonth)
                        } else {
                            val row = mine[date.toString()]
                            // the draft never replaces or shadows a saved shift - the saved row always wins
                            val draftItem = if (row == null) draftByDate[date.toString()] else null
                            DayCell(date.dayOfMonth, row, date == today, stores, draftItem, onDayClick?.let { cb -> { cb(date, row) } })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PadCell(day: Int) {
    Box(modifier = Modifier.fillMaxWidth().aspectRatio(1f).heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
        Text(day.toString(), color = T2Colors.hint.copy(alpha = 0.35f), fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun DayCell(day: Int, row: ScheduleRow?, isToday: Boolean, stores: Map<String, StoreInfo>, draftItem: kotlinx.serialization.json.JsonObject?, onClick: (() -> Unit)?) {
    val shape = RoundedCornerShape(10.dp)
    val draftStore = draftItem?.get("store_id")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
    val col = row?.let { storeColor(it.store_id, stores) } ?: draftStore?.let { storeColor(it, stores) }
    val isDraft = row == null && draftStore != null
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .heightIn(min = 40.dp)
            .clip(shape)
            .background(if (isDraft) col!!.copy(alpha = 0.07f) else col?.copy(alpha = 0.13f) ?: T2Colors.surface2.copy(alpha = 0.5f))
            .then(
                if (isDraft) Modifier.drawBehind {
                    drawRoundRect(
                        color = col!!, cornerRadius = androidx.compose.ui.geometry.CornerRadius(10.dp.toPx()),
                        style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6f, 4f)))
                    )
                } else Modifier.border(1.5.dp, if (isToday) T2Colors.primary else col ?: Color.Transparent, shape)
            )
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(day.toString(), fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = col ?: T2Colors.text)
        if (row != null && col != null) {
            Text(storeShort(row, 6), color = col, fontSize = 8.sp, maxLines = 1, modifier = Modifier.padding(horizontal = 1.dp))
        } else if (isDraft && col != null) {
            Text((stores[draftStore]?.name ?: draftStore).orEmpty().take(4), color = col, fontSize = 8.sp, maxLines = 1, modifier = Modifier.padding(horizontal = 1.dp))
        }
    }
}

private data class EditTarget(val employeeId: Int, val name: String, val date: LocalDate, val row: ScheduleRow?)

@Composable
private fun EditShiftDialog(
    target: EditTarget,
    stores: List<StoreInfo>,
    onDismiss: () -> Unit,
    onSave: (ScheduleBulkItem, (String) -> Unit) -> Unit
) {
    var storeId by remember { mutableStateOf(target.row?.store_id ?: stores.firstOrNull()?.id ?: "") }
    var hours by remember { mutableStateOf((target.row?.hours?.toInt() ?: 11).toString()) }
    var text by remember { mutableStateOf(target.row?.shift_text ?: "10-21") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val storeLabel = if (storeId == REPLACEMENT_STORE_ID) "Замена (точка неизвестна)"
    else stores.firstOrNull { it.id == storeId }?.name ?: storeId

    Dialog(onDismissRequest = { if (!busy) onDismiss() }) {
        val shape = RoundedCornerShape(28.dp)
        Column(
            modifier = Modifier
                .width(460.dp)
                .clip(shape)
                .background(T2Colors.surface)
                .border(1.dp, T2Colors.border, shape)
                .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 20.dp)
        ) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .size(width = 40.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(T2Colors.surface3)
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Смена ${target.date}", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = T2Colors.text)
                Text(
                    "✕",
                    color = T2Colors.hint,
                    fontSize = 20.sp,
                    modifier = Modifier.clip(CircleShape).clickable(enabled = !busy, onClick = onDismiss).padding(8.dp)
                )
            }
            Text(target.name, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))

            FieldLabel("Точка")
            ru.t2sales.desktop.ui.components.DropdownField(
                value = storeLabel,
                options = listOf(ru.t2sales.desktop.ui.components.DropdownItem("Замена (точка неизвестна)", REPLACEMENT_STORE_ID, REPLACEMENT_COLOR)) +
                    stores.map { ru.t2sales.desktop.ui.components.DropdownItem(it.name, it.id) },
                selected = storeId
            ) { storeId = it.key as String }
            Spacer(Modifier.height(16.dp))
            Field("Часы (0 = выходной)", hours, { v -> hours = v.filter(Char::isDigit).take(2) }, fill = T2Colors.surface2)
            Spacer(Modifier.height(16.dp))
            Field("Смена", text, { text = it.take(20) }, fill = T2Colors.surface2)
            error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
            Spacer(Modifier.height(20.dp))
            MainButton(if (busy) "Сохраняем…" else "Сохранить", enabled = !busy && storeId.isNotEmpty()) {
                val h = hours.toIntOrNull() ?: 0
                if (h > 14) {
                    error = "Часы: от 0 до 14"
                } else {
                    busy = true
                    error = null
                    onSave(ScheduleBulkItem(target.employeeId, target.date.toString(), storeId, h, text)) {
                        error = it
                        busy = false
                    }
                }
            }
        }
    }
}
