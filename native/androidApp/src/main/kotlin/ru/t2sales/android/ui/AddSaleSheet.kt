package ru.t2sales.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.DropdownMenu
import androidx.compose.material.DropdownMenuItem
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.async
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors

private val MANAGER_ROLES = setOf("manager", "admin", "supervisor", "senior")

private data class FormParts(
    val metrics: List<MetricDef>, val emps: List<EmployeeListItem>, val stores: List<StoreInfo>,
    val schedules: List<ru.t2sales.shared.api.ScheduleRow>, val open: ru.t2sales.shared.api.ShiftOpenMapResponse?
)

private class SaleForm(val employees: List<EmployeeListItem>, val stores: List<StoreInfo>, val byEmp: Map<Int, String>, val metrics: List<MetricDef>)

/** Bottom sheet over the screen: the phone version of the web's openAddSale/submitSale. */
@Composable
fun AddSaleSheet(container: AppContainer, myEmployeeId: Int?, myName: String?, role: String?, presetEmployeeId: Int? = null, onDismiss: () -> Unit) {
    val canManage = role in MANAGER_ROLES
    val scope = rememberCoroutineScope()
    var form by remember { mutableStateOf<SaleForm?>(null) }
    var failed by remember { mutableStateOf(false) }
    var employeeId by remember { mutableStateOf<Int?>(null) }
    var storeId by remember { mutableStateOf<String?>(null) }
    val selection = remember { mutableStateMapOf<String, String>() }
    var busy by remember { mutableStateOf(false) }
    val clientId = remember { UUID.randomUUID().toString() }
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() }

    LaunchedEffect(Unit) {
        runCatching {
            // the five requests go out together, so the form opens after the slowest one, not after all of them
            val (metrics, emps, storeList, schedules, open) = coroutineScope {
                val aMetrics = async {
                    runCatching { container.salesApi.getMetrics().items }.getOrDefault(emptyList())
                        .map { MetricDef(it.id, it.label ?: it.id, it.short_label, it.unit ?: if (it.unit_type == "money") "₽" else "шт") }
                        .ifEmpty { FALLBACK_METRICS }
                }
                val aEmps = async { container.teamApi.getEmployees() }
                val aStores = async { container.scheduleApi.getOrgStores().stores }
                val aSchedules = async { runCatching { container.scheduleApi.getSchedules(today) }.getOrDefault(emptyList()) }
                val aOpen = async { runCatching { container.salesApi.getOpenMap() }.getOrNull() }
                FormParts(aMetrics.await(), aEmps.await(), aStores.await(), aSchedules.await(), aOpen.await())
            }
            val stores = storeList.toMutableList()
            open?.stores?.forEach { s -> if (stores.none { it.id == s.id }) stores.add(s) }

            // the store "по факту смены": the open shift wins over the schedule
            val byEmp = HashMap<Int, String>()
            schedules.forEach { byEmp[it.employee_id] = it.store_id }
            open?.open?.forEach { (k, v) -> k.toIntOrNull()?.let { byEmp[it] = v } }

            var empList = emps
            if (!canManage && myEmployeeId != null) {
                empList = emps.filter { it.id == myEmployeeId }
                if (empList.isEmpty()) empList = listOf(EmployeeListItem(myEmployeeId, myName ?: "Я"))
            }
            val defaultEmp = if (canManage) presetEmployeeId ?: myEmployeeId ?: schedules.firstOrNull()?.employee_id ?: empList.firstOrNull()?.id
            else myEmployeeId ?: empList.firstOrNull()?.id
            employeeId = defaultEmp
            storeId = defaultEmp?.let { byEmp[it] } ?: stores.firstOrNull()?.id
            SaleForm(empList, stores, byEmp, metrics)
        }.onSuccess { form = it }.onFailure { failed = true }
    }

    BottomSheet("Добавить продажу", busy, onDismiss, footer = form?.let { f ->
        {
            MainButton(if (busy) "Сохраняем…" else "Добавить", !busy) {
                val emp = employeeId
                val store = storeId
                if (emp == null || store == null) { Toaster.show("Укажи сотрудника и точку", true); return@MainButton }
                val chosen = f.metrics.mapNotNull { m ->
                    val n = selection[m.id]?.replace(',', '.')?.toDoubleOrNull() ?: return@mapNotNull null
                    if (n > 0) m to n else null
                }
                if (chosen.isEmpty()) { Toaster.show("Выбери метрики и количество", true); return@MainButton }
                busy = true
                val body = buildJsonObject {
                    put("employee_id", JsonPrimitive(emp))
                    put("store_id", JsonPrimitive(store))
                    put("sale_date", JsonPrimitive(today))
                    put("client_id", JsonPrimitive(clientId)) // the server de-duplicates on it: a resend never doubles a sale
                    chosen.forEach { (m, n) -> put(m.id, JsonPrimitive(if (n % 1.0 == 0.0) n.toLong() else n)) }
                }
                val summary = chosen.joinToString(", ") { (m, n) -> "${m.label ?: m.id} × ${if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()}" }
                scope.launch {
                    runCatching { container.salesApi.createSale(body) }
                        .onSuccess {
                            Toaster.show("Добавлено: $summary")
                            AppState.refreshTick++
                            onDismiss()
                        }
                        .onFailure { e ->
                            if (e is ApiException) {
                                // the server answered and said no: show why, the form stays open
                                Toaster.show(e.message.takeIf { it != "fail" } ?: "Ошибка сохранения", true)
                                busy = false
                            } else {
                                // no answer at all: keep the sale (same client_id, so a resend can never double it) and send it later
                                runCatching { container.outbox.enqueue(body, summary) }
                                    .onSuccess { Toaster.show("Нет связи: продажа сохранена и отправится сама (в очереди: ${container.outbox.pendingCount})"); onDismiss() }
                                    .onFailure { Toaster.show("Ошибка сохранения", true); busy = false }
                            }
                        }
                }
            }
        }
    }) {
        val f = form
        when {
            failed -> Text("Ошибка загрузки", color = T2Colors.danger, modifier = Modifier.padding(vertical = 16.dp))
            f == null -> LoadingBlock(Modifier.padding(vertical = 8.dp), lines = 4)
            else -> SaleFormBody(f, canManage, employeeId, storeId, selection, { employeeId = it }, { storeId = it })
        }
    }
}

@Composable
private fun SaleFormBody(
    f: SaleForm, canManage: Boolean, employeeId: Int?, storeId: String?, selection: MutableMap<String, String>,
    onEmployee: (Int) -> Unit, onStore: (String) -> Unit
) {
    Label("Сотрудник")
    PickerField(f.employees.firstOrNull { it.id == employeeId }?.full_name ?: "", f.employees.map { it.full_name }, canManage) { picked ->
        f.employees.firstOrNull { it.full_name == picked }?.let { e ->
            onEmployee(e.id)
            f.byEmp[e.id]?.let(onStore)
        }
    }
    if (!canManage) Text("Можно вносить только свои продажи", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    Spacer(Modifier.height(16.dp))

    Row { Label("Точка"); Text(" (по факту смены)", color = T2Colors.primary, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp)) }
    PickerField(f.stores.firstOrNull { it.id == storeId }?.name ?: "", f.stores.map { it.name }, true) { picked -> f.stores.firstOrNull { it.name == picked }?.let { onStore(it.id) } }
    Spacer(Modifier.height(16.dp))

    Row { Label("Тип"); Text(" (можно несколько)", color = T2Colors.textSecondary, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp)) }
    f.metrics.chunked(3).forEach { rowMetrics ->
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            rowMetrics.forEach { m ->
                val on = selection.containsKey(m.id)
                val shape = RoundedCornerShape(12.dp)
                Box(
                    Modifier.weight(1f).clip(shape).background(if (on) Color(0xFF106FA3) else T2Colors.surface2)
                        .border(1.dp, if (on) T2Colors.primary else T2Colors.border, shape)
                        .clickable { if (on) selection.remove(m.id) else selection[m.id] = "1" }.padding(vertical = 12.dp, horizontal = 6.dp),
                    contentAlignment = Alignment.Center
                ) { Text(m.label ?: m.id, color = if (on) Color.White else T2Colors.text, fontWeight = FontWeight.Bold, fontSize = 13.sp, textAlign = TextAlign.Center) }
            }
            repeat(3 - rowMetrics.size) { Spacer(Modifier.weight(1f)) }
        }
    }
    Spacer(Modifier.height(8.dp))

    Label("Количество")
    if (selection.isEmpty()) {
        Text("Выбери одну или несколько метрик", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
    } else {
        f.metrics.filter { selection.containsKey(it.id) }.forEach { m ->
            val shape = RoundedCornerShape(12.dp)
            Row(
                Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(m.label ?: m.id, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(" ${m.unit ?: ""}", color = T2Colors.hint, fontSize = 11.sp)
                }
                val inShape = RoundedCornerShape(10.dp)
                BasicTextField(
                    value = selection[m.id] ?: "",
                    onValueChange = { v -> selection[m.id] = v.filter { it.isDigit() || it == '.' || it == ',' }.take(9) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TextStyle(color = T2Colors.text, fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                    cursorBrush = SolidColor(T2Colors.primary),
                    modifier = Modifier.width(96.dp).clip(inShape).background(T2Colors.surface).border(1.dp, T2Colors.border, inShape).padding(horizontal = 6.dp, vertical = 10.dp)
                )
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(1, 2, 5, 10).forEach { n ->
            val shape = RoundedCornerShape(12.dp)
            Box(
                Modifier.weight(1f).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape)
                    .clickable { selection.keys.toList().forEach { selection[it] = n.toString() } }.padding(12.dp),
                contentAlignment = Alignment.Center
            ) { Text(n.toString(), fontWeight = FontWeight.Bold, fontSize = 14.sp) }
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text.uppercase(), color = T2Colors.hint, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, modifier = Modifier.padding(bottom = 6.dp))
}

/** A select field: the current value in a rounded box, the list opens under it (the web's <select>, styled like the rest). */
@Composable
fun PickerField(value: String, options: List<String>, enabled: Boolean, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    BackHandler(enabled = open) { open = false }
    val shape = RoundedCornerShape(12.dp)
    Box {
        Row(
            Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape)
                .clickable(enabled = enabled) { open = true }.padding(horizontal = 14.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
        ) {
            Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.weight(1f))
            if (enabled) Text("▾", color = T2Colors.hint, fontSize = 14.sp)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.background(T2Colors.surface).heightIn(max = 360.dp)) {
            options.forEach { o ->
                DropdownMenuItem(onClick = { open = false; onPick(o) }) {
                    Text(o, color = T2Colors.text, fontWeight = if (o == value) FontWeight.Bold else FontWeight.Medium, fontSize = 15.sp)
                }
            }
        }
    }
}
