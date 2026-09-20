package ru.t2sales.desktop.ui.sales

import ru.t2sales.shared.api.ApiException
import ru.t2sales.desktop.ui.components.SkeletonBlock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.DropdownMenu
import androidx.compose.material.DropdownMenuItem
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.desktop.ui.components.FieldBox
import ru.t2sales.desktop.ui.components.FieldLabel
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.api.ScheduleApi
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.theme.T2Colors

/** Fallback used by the web too when GET /metrics is empty (app/core.ts window.METRICS). */
private val FALLBACK_METRICS = listOf(
    MetricDef("sim", "SIM", unit = "шт"), MetricDef("mnp", "MNP", unit = "шт"), MetricDef("pa", "ПА", unit = "шт"),
    MetricDef("combo", "Комбо", unit = "шт"), MetricDef("phones", "Телефоны", unit = "₽"),
    MetricDef("accessories", "Аксессуары", unit = "₽"), MetricDef("settings", "Настройки", unit = "₽"),
    MetricDef("insurance", "Страховки", unit = "₽"), MetricDef("wink", "Wink", unit = "₽"),
    MetricDef("shpd", "ШПД", unit = "шт"), MetricDef("focus", "ФО", unit = "₽"),
    MetricDef("credit_request", "Кредит заявка", unit = "шт"), MetricDef("credit_issued", "Кредит выдан", unit = "₽"),
    MetricDef("plotter", "Плоттер", unit = "шт"), MetricDef("hb", "НВ", unit = "шт")
)

private class SaleForm(
    val employees: List<EmployeeListItem>,
    val stores: List<StoreInfo>,
    val byEmp: Map<Int, String>,
    val metrics: List<MetricDef>
)

/** Port of features/add-sale (openAddSale/submitSale): employee, store "по факту смены", metric chips, quantities. */
@Composable
fun AddSaleDialog(
    teamApi: TeamApi,
    scheduleApi: ScheduleApi,
    salesApi: SalesApi,
    outbox: ru.t2sales.desktop.offline.SalesOutbox,
    formCache: ru.t2sales.desktop.offline.SaleFormCache,
    myEmployeeId: Int?,
    myName: String?,
    canManage: Boolean,
    presetEmployeeId: Int?,
    onDismiss: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var form by remember { mutableStateOf<SaleForm?>(null) }
    var failed by remember { mutableStateOf(false) }
    var cachedAt by remember { mutableStateOf<java.time.Instant?>(null) }
    var employeeId by remember { mutableStateOf<Int?>(null) }
    var storeId by remember { mutableStateOf<String?>(null) }
    val selection = remember { mutableStateMapOf<String, String>() }
    var busy by remember { mutableStateOf(false) }
    val clientId = remember { UUID.randomUUID().toString() }
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() }

    LaunchedEffect(Unit) {
        runCatching {
            val metrics = runCatching { salesApi.getMetrics().items }.getOrDefault(emptyList())
                .map { MetricDef(it.id, it.label ?: it.id, it.short_label, it.unit ?: if (it.unit_type == "money") "₽" else "шт") }
                .ifEmpty { FALLBACK_METRICS }
            val emps = teamApi.getEmployees()
            val stores = scheduleApi.getOrgStores().stores.toMutableList()
            val schedules = runCatching { scheduleApi.getSchedules(today) }.getOrDefault(emptyList())
            val open = runCatching { salesApi.getOpenMap() }.getOrNull()
            open?.stores?.forEach { s -> if (stores.none { it.id == s.id }) stores.add(s) }

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
            myEmployeeId?.let { formCache.save(it, ru.t2sales.desktop.offline.CachedSaleForm(java.time.Instant.now(), empList, stores, byEmp, metrics)) }
            SaleForm(empList, stores, byEmp, metrics)
        }.onSuccess { form = it }.onFailure {
            // no answer from the server: open the form from the last data it gave this employee, so a sale can still be entered
            val cached = myEmployeeId?.let { id -> formCache.load(id) }
            if (cached == null) {
                failed = true
            } else {
                val defaultEmp = if (canManage) presetEmployeeId ?: myEmployeeId ?: cached.employees.firstOrNull()?.id else myEmployeeId ?: cached.employees.firstOrNull()?.id
                employeeId = defaultEmp
                storeId = defaultEmp?.let { cached.storeByEmployee[it] } ?: cached.stores.firstOrNull()?.id
                cachedAt = cached.savedAt
                form = SaleForm(cached.employees, cached.stores, cached.storeByEmployee, cached.metrics.ifEmpty { FALLBACK_METRICS })
            }
        }
    }

    SheetDialog("Добавить продажу", onDismiss = { if (!busy) onDismiss() }) {
        val f = form
        when {
            failed -> Text("Ошибка загрузки", color = T2Colors.danger)
            f == null -> FormSkeleton()
            else -> {
                cachedAt?.let { at ->
                    val shown = java.time.format.DateTimeFormatter.ofPattern("dd.MM HH:mm").format(at.atZone(java.time.ZoneId.of("Europe/Moscow")))
                    Text("Нет связи: данные от $shown. Продажа сохранится и отправится сама, когда связь появится.", color = T2Colors.warning, fontSize = 12.sp, modifier = Modifier.padding(bottom = 12.dp))
                }
                FieldLabel("Сотрудник")
                Dropdown(
                    value = f.employees.firstOrNull { it.id == employeeId }?.full_name ?: "",
                    options = f.employees.map { it.full_name },
                    enabled = canManage
                ) { picked ->
                    f.employees.firstOrNull { it.full_name == picked }?.let { e ->
                        employeeId = e.id
                        f.byEmp[e.id]?.let { storeId = it }
                    }
                }
                if (!canManage) Text("Можно вносить только свои продажи", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.height(16.dp))

                Row {
                    FieldLabel("Точка")
                    Text(" (по факту смены)", color = T2Colors.primary, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp))
                }
                Dropdown(
                    value = f.stores.firstOrNull { it.id == storeId }?.name ?: "",
                    options = f.stores.map { it.name },
                    enabled = true
                ) { picked -> f.stores.firstOrNull { it.name == picked }?.let { storeId = it.id } }
                Spacer(Modifier.height(16.dp))

                Row {
                    FieldLabel("Тип")
                    Text(" (можно несколько)", color = T2Colors.textSecondary, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp))
                }
                f.metrics.chunked(3).forEach { rowMetrics ->
                    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        rowMetrics.forEach { m ->
                            val on = selection.containsKey(m.id)
                            val shape = RoundedCornerShape(12.dp)
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(shape)
                                    .background(if (on) Color(0xFF106FA3) else T2Colors.surface2)
                                    .border(1.dp, if (on) T2Colors.primary else T2Colors.border, shape)
                                    .clickable { if (on) selection.remove(m.id) else selection[m.id] = "1" }
                                    .padding(vertical = 12.dp, horizontal = 6.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(m.label ?: m.id, color = if (on) Color.White else T2Colors.text, fontWeight = FontWeight.Bold, fontSize = 13.sp, textAlign = TextAlign.Center)
                            }
                        }
                        repeat(3 - rowMetrics.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
                Spacer(Modifier.height(8.dp))

                FieldLabel("Количество")
                if (selection.isEmpty()) {
                    Text("Выбери одну или несколько метрик", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
                } else {
                    f.metrics.filter { selection.containsKey(it.id) }.forEach { m ->
                        val shape = RoundedCornerShape(12.dp)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp)
                                .clip(shape)
                                .background(T2Colors.surface2)
                                .border(1.dp, T2Colors.border, shape)
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
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
                                textStyle = TextStyle(color = T2Colors.text, fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                                cursorBrush = SolidColor(T2Colors.primary),
                                modifier = Modifier
                                    .width(88.dp)
                                    .clip(inShape)
                                    .background(T2Colors.surface)
                                    .border(1.dp, T2Colors.border, inShape)
                                    .padding(horizontal = 6.dp, vertical = 8.dp)
                            )
                        }
                    }
                }
                Row(modifier = Modifier.fillMaxWidth().padding(top = 0.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(1, 2, 5, 10).forEach { n ->
                        val shape = RoundedCornerShape(12.dp)
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(shape)
                                .background(T2Colors.surface2)
                                .border(1.dp, T2Colors.border, shape)
                                .clickable { selection.keys.toList().forEach { selection[it] = n.toString() } }
                                .padding(10.dp),
                            contentAlignment = Alignment.Center
                        ) { Text(n.toString(), fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                    }
                }
                Spacer(Modifier.height(16.dp))
                MainButton(if (busy) "Сохраняем…" else "Добавить", enabled = !busy) {
                    val emp = employeeId
                    val store = storeId
                    if (emp == null || store == null) {
                        T2Toast.show("Укажи сотрудника и точку", true)
                        return@MainButton
                    }
                    val chosen = f.metrics.mapNotNull { m ->
                        val n = selection[m.id]?.replace(',', '.')?.toDoubleOrNull() ?: return@mapNotNull null
                        if (n > 0) m to n else null
                    }
                    if (chosen.isEmpty()) {
                        T2Toast.show("Выбери метрики и количество", true)
                        return@MainButton
                    }
                    busy = true
                    val body = buildJsonObject {
                        put("employee_id", JsonPrimitive(emp))
                        put("store_id", JsonPrimitive(store))
                        put("sale_date", JsonPrimitive(today))
                        put("client_id", JsonPrimitive(clientId))
                        chosen.forEach { (m, n) -> put(m.id, JsonPrimitive(if (n % 1.0 == 0.0) n.toLong() else n)) }
                    }
                    val summary = chosen.joinToString(", ") { (m, n) -> "${m.label ?: m.id} × ${if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()}" }
                    scope.launch {
                        runCatching { salesApi.createSale(body) }
                            .onSuccess {
                                T2Toast.show("Добавлено: $summary")
                                AddSaleState.refreshTick++
                                onDismiss()
                            }
                            .onFailure { e ->
                                if (e is ApiException) {
                                    // the server answered and said no: show why, the form stays open
                                    T2Toast.show(e.message.takeIf { m -> m != "fail" } ?: "Ошибка сохранения", true)
                                    busy = false
                                } else {
                                    // no answer at all: keep the sale (same client_id, so a resend can never double it) and send it later
                                    runCatching { outbox.enqueue(body, summary) }
                                        .onSuccess {
                                            T2Toast.show("Нет связи: продажа сохранена и отправится сама (в очереди: ${outbox.pendingCount})")
                                            onDismiss()
                                        }
                                        .onFailure { T2Toast.show("Ошибка сохранения", true); busy = false }
                                }
                            }
                    }
                }
            }
        }
    }
}

@Composable
private fun Dropdown(value: String, options: List<String>, enabled: Boolean, onPick: (String) -> Unit) {
    ru.t2sales.desktop.ui.components.DropdownField(value, options, enabled, onPick)
}

/** Shape of the form while its data loads: two fields and the grid of type chips. */
@Composable
private fun FormSkeleton() {
    androidx.compose.foundation.layout.Column(verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(14.dp)) {
        repeat(2) {
            SkeletonBlock(Modifier.fillMaxWidth(0.3f).height(12.dp), 6.dp)
            SkeletonBlock(Modifier.fillMaxWidth().height(52.dp), 14.dp)
        }
        SkeletonBlock(Modifier.fillMaxWidth(0.4f).height(12.dp), 6.dp)
        repeat(3) {
            androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp)) {
                repeat(3) { SkeletonBlock(Modifier.weight(1f).height(46.dp), 14.dp) }
            }
        }
    }
}
