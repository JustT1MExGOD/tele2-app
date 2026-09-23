package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import kotlinx.coroutines.launch
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.ScheduleBulkItem
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val MOSCOW = ZoneId.of("Europe/Moscow")
private val MONTHS = listOf("Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь")
private val WEEKDAYS_MON = listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")

private const val REPLACEMENT_STORE_ID = "__REPLACEMENT__"
private val REPLACEMENT_COLOR = Color(0xFF00C853)
private val STORE_COLORS = mapOf("kosmonavtov" to "#6d9eeb", "kalinina2" to "#ff6d01", "kalinina11" to "#ffd966")
private val DEFAULT_STORE_COLOR = Color(0xFF2AABEE)

private fun parseHex(hex: String): Color? = runCatching {
    val h = hex.removePrefix("#")
    Color(("FF" + if (h.length == 3) h.map { "$it$it" }.joinToString("") else h).toLong(16))
}.getOrNull()

private fun storeColor(storeId: String, stores: Map<String, StoreInfo>): Color {
    if (storeId == REPLACEMENT_STORE_ID) return REPLACEMENT_COLOR
    return stores[storeId]?.color?.let(::parseHex) ?: STORE_COLORS[storeId]?.let(::parseHex) ?: DEFAULT_STORE_COLOR
}

private fun storeShort(row: ScheduleRow, limit: Int): String =
    if (row.store_id == REPLACEMENT_STORE_ID) "Замена" else (row.store_short ?: row.store_name ?: "").take(limit)

private class EditTarget(val employeeId: Int, val name: String, val date: LocalDate, val row: ScheduleRow?)

/**
 * Mobile port of pages/schedule: month switcher, team summary (manager tier), automatic draft section (managers), one month
 * calendar per person, tap a day to edit it (managers). Not ported yet: moving a shift by dragging it (desktop-mouse only).
 */
@Composable
fun ScheduleScreen(container: AppContainer, me: MeResponse) {
    val scheduleApi = container.scheduleApi
    val role = me.role
    val canEdit = role == "manager" || role == "admin" || me.is_manager == true
    val managerTier = role == "manager" || role == "senior" || role == "admin"
    val today = remember { LocalDate.now(MOSCOW) }
    var month by remember { mutableStateOf(YearMonth.from(today)) }
    var rows by remember { mutableStateOf<List<ScheduleRow>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var stores by remember { mutableStateOf<Map<String, StoreInfo>>(emptyMap()) }
    var employees by remember { mutableStateOf<List<EmployeeListItem>?>(null) }
    var reloadKey by remember { mutableStateOf(0) }
    var editing by remember { mutableStateOf<EditTarget?>(null) }
    var draft by remember { mutableStateOf<ScheduleDraft?>(null) }

    LaunchedEffect(Unit) {
        runCatching { scheduleApi.getOrgStores() }.onSuccess { r -> stores = r.stores.associateBy { it.id } }
        runCatching { container.teamApi.getEmployees() }.onSuccess { employees = it }.onFailure { employees = emptyList() }
    }
    LaunchedEffect(month, reloadKey) {
        rows = null
        failed = false
        runCatching { scheduleApi.getScheduleMonth(month.toString()) }.onSuccess { rows = it.items }.onFailure { failed = true }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp)) {
        MonthSwitcher(month) { month = it }
        val list = rows
        val emps = employees
        when {
            failed -> Text("Ошибка загрузки графика — не удалось получить смены", color = T2Colors.danger)
            list == null || emps == null -> LoadingBlock(Modifier.padding(vertical = 16.dp), lines = 5)
            else -> {
                if (managerTier) {
                    Text("Сводный график команды", fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp))
                    SummaryGrid(list, emps, month, stores, today)
                    Spacer(Modifier.height(T2Spacing.sp3))
                }
                if (canEdit) {
                    DraftSection(scheduleApi, stores, emps, draft, { draft = it }, { reloadKey++ })
                    Spacer(Modifier.height(T2Spacing.sp3))
                }
                if (canEdit) Text("Нажми на день, чтобы поставить / убрать смену", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
                val byEmp = list.groupBy { it.employee_id }
                val people = emps.map { it.id to it.full_name }
                    .plus(list.filter { r -> emps.none { it.id == r.employee_id } }.map { it.employee_id to it.full_name }.distinct())
                    .sortedBy { it.second.lowercase() }
                if (people.isEmpty()) Text("Нет данных", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
                    WEEKDAYS_MON.forEach { Text(it.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
                }
                Spacer(Modifier.height(2.dp))
                people.forEach { (empId, name) ->
                    val days = byEmp[empId].orEmpty().associateBy { it.work_date.take(10) }
                    val shape = RoundedCornerShape(T2Radius.default)
                    Column(Modifier.padding(bottom = 12.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(name, fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1)
                            Text("${days.size} смен", color = T2Colors.hint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                        MonthGrid(month, days, today, stores, if (canEdit) { date, row -> editing = EditTarget(empId, name, date, row) } else null)
                    }
                }
            }
        }
        Spacer(Modifier.height(96.dp))
    }

    editing?.let { target ->
        val scope = rememberCoroutineScope()
        EditShiftSheet(target, stores.values.sortedBy { it.name }, onDismiss = { editing = null }) { item, onError ->
            scope.launch {
                runCatching { scheduleApi.saveShift(item) }
                    .onSuccess {
                        if (it.count == 1) { editing = null; reloadKey++; Toaster.show("Смена сохранена") }
                        else onError("Смена не сохранена: обновите график и повторите")
                    }
                    .onFailure { onError(it.message ?: "Нет прав") }
            }
        }
    }
}

@Composable
private fun MonthSwitcher(month: YearMonth, onChange: (YearMonth) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, bottom = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        NavButton("‹") { onChange(month.minusMonths(1)) }
        Text("${MONTHS[month.monthValue - 1]} ${month.year}", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
        NavButton("›") { onChange(month.plusMonths(1)) }
    }
}

@Composable
private fun NavButton(label: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Box(Modifier.size(44.dp).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick), contentAlignment = Alignment.Center) { Text(label, fontSize = 20.sp) }
}

private val CELL_W = 46.dp
private val CELL_H = 40.dp
private val NAME_W = 110.dp

/** The whole team on one scrolling table: names on the left (fixed), days to the right, each cell coloured by the store. */
@Composable
private fun SummaryGrid(all: List<ScheduleRow>, employees: List<EmployeeListItem>, month: YearMonth, stores: Map<String, StoreInfo>, today: LocalDate) {
    val grouped = all.groupBy { it.employee_id }
    val byEmp = (employees.map { it.id to it.full_name } + all.filter { r -> employees.none { it.id == r.employee_id } }.map { it.employee_id to it.full_name }.distinct())
        .map { (id, name) -> name to grouped[id].orEmpty().associateBy { it.work_date.take(10) } }
        .sortedBy { it.first.lowercase() }
    if (byEmp.isEmpty()) { Text("Нет данных", color = T2Colors.hint); return }
    val total = month.lengthOfMonth()
    val scroll = rememberScrollState()
    LaunchedEffect(month) { if (YearMonth.from(today) == month) scroll.scrollTo(((today.dayOfMonth - 3).coerceAtLeast(0)) * 160) }
    val weekdays = listOf("пн", "вт", "ср", "чт", "пт", "сб", "вс")
    Row {
        Column {
            NameCell("ФИО")
            byEmp.forEach { (name, _) -> NameCell(name) }
        }
        Column(Modifier.horizontalScroll(scroll)) {
            Row {
                for (d in 1..total) {
                    val date = month.atDay(d)
                    Column(
                        Modifier.padding(2.dp).size(CELL_W, CELL_H).clip(RoundedCornerShape(T2Radius.xs)).background(if (date.dayOfWeek.value >= 6) T2Colors.dangerSoft else T2Colors.surface2),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
                    ) {
                        Text(d.toString(), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text(weekdays[date.dayOfWeek.value - 1], color = T2Colors.hint, fontSize = 10.sp)
                    }
                }
            }
            byEmp.forEach { (_, days) ->
                Row { for (d in 1..total) ShiftCell(days[month.atDay(d).toString()], stores) }
            }
        }
    }
}

@Composable
private fun NameCell(name: String) {
    Box(Modifier.padding(2.dp).size(NAME_W, CELL_H), contentAlignment = Alignment.CenterStart) {
        Text(name, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
    }
}

@Composable
private fun ShiftCell(row: ScheduleRow?, stores: Map<String, StoreInfo>) {
    val col = row?.let { storeColor(it.store_id, stores) }
    Column(
        Modifier.padding(2.dp).size(CELL_W, CELL_H).clip(RoundedCornerShape(T2Radius.xs)).background(col?.copy(alpha = 0.18f) ?: T2Colors.surface2.copy(alpha = 0.4f)),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        if (row != null && col != null) {
            Text(storeShort(row, 5), color = col, fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(row.shift_text.orEmpty(), color = T2Colors.hint, fontSize = 9.sp, maxLines = 1)
        }
    }
}

@Composable
private fun MonthGrid(month: YearMonth, mine: Map<String, ScheduleRow>, today: LocalDate, stores: Map<String, StoreInfo>, onDayClick: ((LocalDate, ScheduleRow?) -> Unit)?) {
    val first = month.atDay(1)
    val offset = first.dayOfWeek.value - 1
    val weeks = (offset + month.lengthOfMonth() + 6) / 7
    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (w in 0 until weeks) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (c in 0 until 7) {
                    val date = first.plusDays((w * 7 + c - offset).toLong())
                    val inMonth = date.month == month.month && date.year == month.year
                    Box(Modifier.weight(1f)) {
                        if (!inMonth) {
                            Box(Modifier.fillMaxWidth().aspectRatio(1f).heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
                                Text(date.dayOfMonth.toString(), color = T2Colors.hint.copy(alpha = 0.35f), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                        } else {
                            val row = mine[date.toString()]
                            DayCell(date.dayOfMonth, row, date == today, stores, onDayClick?.let { cb -> { cb(date, row) } })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(day: Int, row: ScheduleRow?, isToday: Boolean, stores: Map<String, StoreInfo>, onClick: (() -> Unit)?) {
    val shape = RoundedCornerShape(10.dp)
    val col = row?.let { storeColor(it.store_id, stores) }
    Column(
        Modifier.fillMaxWidth().aspectRatio(1f).heightIn(min = 40.dp).clip(shape)
            .background(col?.copy(alpha = 0.13f) ?: T2Colors.surface2.copy(alpha = 0.5f))
            .border(1.5.dp, if (isToday) T2Colors.primary else col ?: Color.Transparent, shape)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        Text(day.toString(), fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, color = col ?: T2Colors.text)
        if (row != null && col != null) Text(storeShort(row, 6), color = col, fontSize = 8.sp, maxLines = 1, modifier = Modifier.padding(horizontal = 1.dp))
    }
}

@Composable
private fun EditShiftSheet(target: EditTarget, stores: List<StoreInfo>, onDismiss: () -> Unit, onSave: (ScheduleBulkItem, (String) -> Unit) -> Unit) {
    var storeId by remember { mutableStateOf(target.row?.store_id ?: stores.firstOrNull()?.id ?: "") }
    var hours by remember { mutableStateOf((target.row?.hours?.toInt() ?: 11).toString()) }
    var text by remember { mutableStateOf(target.row?.shift_text ?: "10-21") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val storeLabel = if (storeId == REPLACEMENT_STORE_ID) "Замена (точка неизвестна)" else stores.firstOrNull { it.id == storeId }?.name ?: storeId

    BottomSheet("Смена ${target.date}", busy, onDismiss, footer = {
        MainButton(if (busy) "Сохраняем…" else "Сохранить", !busy && storeId.isNotEmpty()) {
            val h = hours.toIntOrNull() ?: 0
            if (h > 14) {
                error = "Часы: от 0 до 14"
            } else {
                busy = true
                error = null
                onSave(ScheduleBulkItem(target.employeeId, target.date.toString(), storeId, h, text)) { error = it; busy = false }
            }
        }
    }) {
        Text(target.name, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        Text("ТОЧКА", color = T2Colors.hint, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, modifier = Modifier.padding(bottom = 6.dp))
        PickerField(storeLabel, listOf("Замена (точка неизвестна)") + stores.map { it.name }, true) { picked ->
            storeId = if (picked == "Замена (точка неизвестна)") REPLACEMENT_STORE_ID else stores.firstOrNull { it.name == picked }?.id ?: storeId
        }
        Spacer(Modifier.height(16.dp))
        Field("Часы (0 = выходной)", hours, { v -> hours = v.filter(Char::isDigit).take(2) }, keyboard = KeyboardType.Number)
        Spacer(Modifier.height(16.dp))
        Field("Смена", text, { text = it.take(20) })
        error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
    }
}
