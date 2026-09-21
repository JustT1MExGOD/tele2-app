@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.AcPlanDetail
import ru.t2sales.shared.api.AcScheduleRow
import ru.t2sales.shared.api.AcShiftRow
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors

private const val STALE = "Ошибка (возможно, версия устарела)"

@Composable
private fun DateRange(from: String, to: String, onFrom: (String) -> Unit, onTo: (String) -> Unit, extra: @Composable () -> Unit = {}, onSearch: () -> Unit) {
    FlowRow(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 2) {
        Box(Modifier.weight(1f)) { Field("", from, onFrom, placeholder = "С ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
        Box(Modifier.weight(1f)) { Field("", to, onTo, placeholder = "По ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
        extra()
        MChipButton("Найти", onClick = onSearch)
    }
}

@Composable
private fun VoidedCheckbox(value: Boolean, onChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { onChange(!value) }.padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (value) "\u2611" else "\u2610", fontSize = 20.sp, color = T2Colors.primary)
        Text(" показывать аннулированные", fontSize = 13.sp)
    }
}

@Composable
private fun DetailLine(text: String) =
    Text(text, color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))

private fun storeOptions(stores: List<StoreInfo>) = stores.map { it.id to it.name }

// ---------------- Shifts
private sealed class ShiftFlow {
    class Void(val row: AcShiftRow, val preview: String) : ShiftFlow()
    class Restore(val row: AcShiftRow) : ShiftFlow()
    class Correct(val row: AcShiftRow) : ShiftFlow()
    class Ticket(val row: AcShiftRow, val storeId: String?, val date: String?, val reason: String) : ShiftFlow()
}

@Composable
internal fun ShiftsTab(container: AppContainer) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var includeVoided by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<AcShiftRow>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var searchFailed by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var detail by remember { mutableStateOf<AcShiftRow?>(null) }
    var detailFailed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var flow by remember { mutableStateOf<ShiftFlow?>(null) }
    var stores by remember { mutableStateOf<List<StoreInfo>>(emptyList()) }

    LaunchedEffect(selected, reload) {
        val id = selected ?: return@LaunchedEffect
        detailFailed = false
        runCatching { api.shift(id).row }.onSuccess { detail = it }.onFailure { detailFailed = true }
    }
    LaunchedEffect(Unit) { runCatching { container.scheduleApi.getOrgStores().stores }.onSuccess { stores = it } }
    fun done(msg: String) { T2Toast.show(msg); reload++ }

    PageSection("Поиск смен") {
        DateRange(from, to, { from = it }, { to = it }, extra = { VoidedCheckbox(includeVoided) { includeVoided = it } }) {
            searching = true; searchFailed = false
            scope.launch {
                runCatching { api.searchShifts(from.ifBlank { null }, to.ifBlank { null }, includeVoided) }.onSuccess { results = it.items }.onFailure { searchFailed = true }
                searching = false
            }
        }
        val list = results
        when {
            searching -> LoadingBlock(Modifier.padding(16.dp))
            searchFailed -> EmptyText("Ошибка поиска")
            list == null -> {}
            list.isEmpty() -> EmptyText("Ничего не найдено")
            else -> list.forEach { r -> NavRow("${r.employee_name} \u00B7 ${r.store_name}", "${r.work_date} \u00B7 ${r.status}" + if (r.voided_at != null) " \u00B7 аннулировано" else "") { selected = r.id } }
        }
    }

    if (selected != null) {
        Spacer(Modifier.height(12.dp))
        val row = detail
        when {
            detailFailed -> PageSection(null) { EmptyText("Не удалось загрузить смену") }
            row == null || row.id != selected -> LoadingBlock()
            else -> {
                val canVoid = row.voided_at == null && (row.status == "closed" || row.status == "auto_closed")
                PageSection("${row.employee_name} \u00B7 ${row.store_name} \u00B7 ${row.work_date}") {
                    DetailLine("Статус: ${row.status}")
                    if (row.voided_at != null) DetailLine("Аннулировано: ${row.void_reason ?: ""}")
                    Row(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (row.voided_at != null) MChipButton("Восстановить") { flow = ShiftFlow.Restore(row) }
                        else {
                            if (canVoid) MChipButton("Аннулировать") {
                                scope.launch {
                                    val preview = runCatching { api.previewVoidShift(row.id) }.getOrNull()?.let { prettyJson(it) } ?: ""
                                    flow = ShiftFlow.Void(row, preview)
                                }
                            } else Text("Смена ещё открыта \u2014 аннулировать можно только закрытую смену", color = T2Colors.textSecondary, fontSize = 13.sp)
                            MChipButton("Изменить точку/дату") { flow = ShiftFlow.Correct(row) }
                        }
                    }
                }
            }
        }
    }

    when (val f = flow) {
        is ShiftFlow.Void -> DangerDialog("Аннулировать смену", "Смена будет помечена как аннулированная. Действие обратимо через \"Восстановить\".", preview = f.preview, onDismiss = { flow = null }, onConfirm = { reason ->
            flow = null
            scope.launch { runCatching { api.voidShift(f.row.id, f.row.version, reason) }.onSuccess { done("Смена аннулирована") }.onFailure { T2Toast.show(STALE, true) } }
        })
        is ShiftFlow.Restore -> DangerDialog("Восстановить смену", "Смена будет возвращена в исходное состояние.", confirmLabel = "Восстановить", onDismiss = { flow = null }, onConfirm = { reason ->
            flow = null
            scope.launch { runCatching { api.restoreShift(f.row.id, f.row.version, reason) }.onSuccess { done("Смена восстановлена") }.onFailure { T2Toast.show(STALE, true) } }
        })
        is ShiftFlow.Correct -> FieldCorrectionDialog(
            "Изменить точку/дату смены",
            listOf(
                CorrectionField("store_id", "Точка", "select", f.row.store_id, storeOptions(stores)),
                CorrectionField("work_date", "Дата", "date", f.row.work_date)
            ),
            onDismiss = { flow = null },
            onSave = { values, reason ->
                val newStore = values["store_id"]?.takeIf { it != f.row.store_id }
                val date = values["work_date"]?.takeIf { it != f.row.work_date && it.isNotBlank() }
                if (newStore == null && date == null) { flow = null; return@FieldCorrectionDialog }
                scope.launch {
                    val cross = newStore?.let { runCatching { api.previewCorrectShift(f.row.id, it).crossOrg }.getOrDefault(false) } ?: false
                    if (cross) flow = ShiftFlow.Ticket(f.row, newStore, date, reason)
                    else {
                        flow = null
                        runCatching { api.correctShift(f.row.id, f.row.version, newStore, date, reason, null) }.onSuccess { done("Смена изменена") }.onFailure { T2Toast.show(STALE, true) }
                    }
                }
            }
        )
        is ShiftFlow.Ticket -> StepUpDialog(api, onDismiss = { flow = null }, onTicket = { ticket ->
            flow = null
            scope.launch { runCatching { api.correctShift(f.row.id, f.row.version, f.storeId, f.date, f.reason, ticket) }.onSuccess { done("Смена изменена") }.onFailure { T2Toast.show(STALE, true) } }
        })
        null -> {}
    }
}

// ---------------- Schedules
private sealed class ScheduleFlow {
    class Void(val row: AcScheduleRow, val preview: String) : ScheduleFlow()
    class Correct(val row: AcScheduleRow) : ScheduleFlow()
}

@Composable
internal fun SchedulesTab(container: AppContainer) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<AcScheduleRow>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var searchFailed by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var detail by remember { mutableStateOf<AcScheduleRow?>(null) }
    var detailFailed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var flow by remember { mutableStateOf<ScheduleFlow?>(null) }
    var stores by remember { mutableStateOf<List<StoreInfo>>(emptyList()) }

    LaunchedEffect(selected, reload) {
        val id = selected ?: return@LaunchedEffect
        detailFailed = false
        runCatching { api.schedule(id).row }.onSuccess { detail = it }.onFailure { detailFailed = true }
    }
    LaunchedEffect(Unit) { runCatching { container.scheduleApi.getOrgStores().stores }.onSuccess { stores = it } }

    PageSection("Поиск строк графика") {
        DateRange(from, to, { from = it }, { to = it }) {
            searching = true; searchFailed = false
            scope.launch {
                runCatching { api.searchSchedules(from.ifBlank { null }, to.ifBlank { null }) }.onSuccess { results = it.items }.onFailure { searchFailed = true }
                searching = false
            }
        }
        val list = results
        when {
            searching -> LoadingBlock(Modifier.padding(16.dp))
            searchFailed -> EmptyText("Ошибка поиска")
            list == null -> {}
            list.isEmpty() -> EmptyText("Ничего не найдено")
            else -> list.forEach { r -> NavRow("${r.employee_name} \u00B7 ${r.store_name}", r.work_date + (r.shift_text?.let { " \u00B7 $it" } ?: "")) { selected = r.id } }
        }
    }

    if (selected != null) {
        Spacer(Modifier.height(12.dp))
        val row = detail
        when {
            detailFailed -> PageSection(null) { EmptyText("Не удалось загрузить строку графика") }
            row == null || row.id != selected -> LoadingBlock()
            else -> PageSection("${row.employee_name} \u00B7 ${row.store_name} \u00B7 ${row.work_date}") {
                DetailLine((row.shift_text ?: "") + (row.hours?.let { " \u00B7 ${if (it % 1.0 == 0.0) it.toLong() else it} ч" } ?: ""))
                Row(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MChipButton("Удалить (аннулировать)") {
                        scope.launch {
                            val preview = runCatching { api.previewVoidSchedule(row.id) }.getOrNull()?.let { prettyJson(it) } ?: ""
                            flow = ScheduleFlow.Void(row, preview)
                        }
                    }
                    MChipButton("Изменить точку/дату/часы") { flow = ScheduleFlow.Correct(row) }
                }
            }
        }
    }

    when (val f = flow) {
        is ScheduleFlow.Void -> DangerDialog(
            "Удалить строку графика",
            "Строка будет безвозвратно удалена. Восстановление невозможно \u2014 при необходимости внесите смену заново.",
            confirmLabel = "Удалить", preview = f.preview, onDismiss = { flow = null },
            onConfirm = { reason ->
                flow = null
                scope.launch {
                    runCatching { api.voidSchedule(f.row.id, f.row.version, reason) }
                        .onSuccess { T2Toast.show("Строка графика удалена"); selected = null; detail = null }
                        .onFailure { T2Toast.show(STALE, true) }
                }
            }
        )
        is ScheduleFlow.Correct -> FieldCorrectionDialog(
            "Изменить строку графика",
            listOf(
                CorrectionField("store_id", "Точка", "select", f.row.store_id, storeOptions(stores)),
                CorrectionField("work_date", "Дата", "date", f.row.work_date),
                CorrectionField("hours", "Часы", "number", f.row.hours?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "")
            ),
            onDismiss = { flow = null },
            onSave = { values, reason ->
                val storeId = values["store_id"]?.takeIf { it != f.row.store_id }
                val date = values["work_date"]?.takeIf { it != f.row.work_date && it.isNotBlank() }
                val hours = values["hours"]?.toDoubleOrNull()
                if (storeId == null && date == null && hours == null) { flow = null; return@FieldCorrectionDialog }
                scope.launch {
                    if (date != null) {
                        val exists = runCatching { api.previewCorrectSchedule(f.row.id, date).destinationExists }.getOrDefault(false)
                        if (exists) { T2Toast.show("На выбранную дату у этого сотрудника уже есть смена в графике", true); return@launch }
                    }
                    flow = null
                    runCatching { api.correctSchedule(f.row.id, f.row.version, storeId, date, hours, reason) }
                        .onSuccess { T2Toast.show("Строка графика изменена"); reload++ }
                        .onFailure { T2Toast.show(STALE, true) }
                }
            }
        )
        null -> {}
    }
}

// ---------------- Plans
@Composable
internal fun PlansTab(container: AppContainer) {
    PlanBlock(container, "План сотрудника", "employees", "ID плана сотрудника")
    Spacer(Modifier.height(12.dp))
    PlanBlock(container, "План точки", "stores", "ID плана точки")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlanBlock(container: AppContainer, title: String, kind: String, placeholder: String) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var idText by remember { mutableStateOf("") }
    var planId by remember { mutableStateOf<Int?>(null) }
    var plan by remember { mutableStateOf<AcPlanDetail?>(null) }
    var failed by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var metric by remember { mutableStateOf<Triple<String, String, Double>?>(null) }

    LaunchedEffect(planId, reload) {
        val id = planId ?: return@LaunchedEffect
        loading = true; failed = false
        runCatching { api.plan(kind, id) }.onSuccess { plan = it }.onFailure { failed = true }
        loading = false
    }

    PageSection(title) {
        FlowRow(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 2) {
            Box(Modifier.weight(1f)) { Field("", idText, { v -> idText = v.filter { it.isDigit() } }, placeholder = placeholder, fill = T2Colors.surface2) }
            MChipButton("Открыть") { idText.toIntOrNull()?.takeIf { it > 0 }?.let { planId = it; reload++ } }
        }
        val p = plan
        when {
            loading -> LoadingBlock(Modifier.padding(16.dp))
            failed -> EmptyText("Не удалось загрузить план")
            p != null && planId != null -> FlowRow(
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (p.metrics.isEmpty()) Text("нет метрик", color = T2Colors.hint, fontSize = 13.sp)
                p.metrics.forEach { (id, m) ->
                    val v = if (m.value % 1.0 == 0.0) m.value.toLong().toString() else m.value.toString()
                    val shape = RoundedCornerShape(12.dp)
                    Text(
                        "${m.label.ifEmpty { id }}: $v", fontWeight = FontWeight.Bold, fontSize = 13.sp,
                        modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape)
                            .clickable { metric = Triple(id, m.label.ifEmpty { id }, m.value) }.padding(horizontal = 12.dp, vertical = 12.dp)
                    )
                }
            }
        }
    }

    val m = metric
    val id = planId
    if (m != null && id != null) {
        val version = ((plan?.row?.get("version") as? JsonPrimitive)?.intOrNull) ?: 1
        MetricCorrectionDialog(m.second, m.third, onDismiss = { metric = null }, onSave = { value, reason ->
            metric = null
            scope.launch {
                runCatching { api.correctPlanMetric(kind, id, m.first, value, version, reason) }
                    .onSuccess { T2Toast.show("Метрика изменена"); reload++ }
                    .onFailure { T2Toast.show(STALE, true) }
            }
        })
    }
}
