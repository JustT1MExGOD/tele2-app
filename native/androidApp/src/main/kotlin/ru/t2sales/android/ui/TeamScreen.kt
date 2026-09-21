package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.coroutineScope
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private val ROLE_ORDER = listOf("trainee", "employee", "senior", "manager", "supervisor", "admin")
private val ROLE_LEVEL = mapOf("guest" to -1, "trainee" to 0, "employee" to 1, "senior" to 2, "manager" to 3, "supervisor" to 4, "admin" to 5)
private val ROLE_LABELS = mapOf(
    "trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец",
    "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор"
)
private fun roleLabel(role: String) = ROLE_LABELS[role] ?: role.ifBlank { "Продавец" }

/** Roles the current user may hand out: strictly below their own (an admin: all). "Супервайзер" needs a sector, which is set on the PC. */
private fun assignableRoles(myRole: String): List<String> {
    if (myRole == "admin") return ROLE_ORDER
    val level = ROLE_LEVEL[myRole] ?: -1
    return ROLE_ORDER.filter { (ROLE_LEVEL[it] ?: 0) < level }
}

private val CARD_METRICS = listOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо",
    "phones" to "Телефоны", "accessories" to "Аксессуары", "wink" to "Wink", "shpd" to "ШПД"
)

private class DayTotals(var sim: Double = 0.0, var combo: Double = 0.0, var phones: Double = 0.0, var active: Boolean = false)
private fun JsonObject.num(key: String) = this[key]?.jsonPrimitive?.doubleOrNull ?: 0.0

/**
 * Mobile port of pages/team (#teamList): a row per employee with today's SIM / Комбо / Тел and the role, the employee card on tap,
 * role chips and "Удалить" for managers, the "Управление" block, the network switcher for an administrator.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TeamScreen(container: AppContainer, me: MeResponse) {
    val teamApi = container.teamApi
    val myRole = me.role ?: "employee"
    val canManage = myRole == "manager" || myRole == "admin" || me.is_manager == true
    val scope = rememberCoroutineScope()

    var employees by remember { mutableStateOf<List<EmployeeListItem>?>(null) }
    var sales by remember { mutableStateOf(JsonArray(emptyList())) }
    var todayRows by remember { mutableStateOf<List<ScheduleRow>>(emptyList()) }
    var failed by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableStateOf(0) }
    var opened by remember { mutableStateOf<EmployeeListItem?>(null) }
    var confirmRemove by remember { mutableStateOf<EmployeeListItem?>(null) }
    var addEmployee by remember { mutableStateOf(false) }
    var addStore by remember { mutableStateOf(false) }
    var metricsDialog by remember { mutableStateOf(false) }
    val isAdmin = myRole == "admin"
    var viewOrgId by remember { mutableStateOf<String?>(null) }
    var orgs by remember { mutableStateOf<List<ru.t2sales.shared.api.OrgAdminItem>>(emptyList()) }
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() }

    LaunchedEffect(Unit) { if (isAdmin) runCatching { teamApi.getOrgs() }.onSuccess { orgs = it } }
    LaunchedEffect(reloadKey, AppState.refreshTick, viewOrgId) {
        failed = false
        coroutineScope {
            launch { runCatching { teamApi.getEmployees(viewOrgId) }.onSuccess { employees = it }.onFailure { failed = true } }
            launch { runCatching { teamApi.getSales(today, viewOrgId) }.onSuccess { sales = it } }
            launch { runCatching { container.scheduleApi.getSchedules(today, viewOrgId) }.onSuccess { todayRows = it } }
        }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp)) {
        // an administrator looks at one network at a time (the web's org switcher)
        if (isAdmin && orgs.size > 1) {
            SelectField("Сеть", orgs.firstOrNull { it.id == (viewOrgId ?: me.org_id) }?.name ?: "", orgs.map { it.name }) { picked -> orgs.firstOrNull { it.name == picked }?.let { viewOrgId = it.id } }
            Spacer(Modifier.height(12.dp))
        }
        Section("Сотрудники") {
            val list = employees
            when {
                failed -> Text("Не получилось загрузить команду, зайди чуть позже", color = T2Colors.danger, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                list == null -> LoadingBlock(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), lines = 5)
                list.isEmpty() -> Text("В команде пока никого нет", color = T2Colors.hint, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                else -> {
                    val totals = HashMap<Int, DayTotals>()
                    sales.forEach { row ->
                        val o = row as? JsonObject ?: return@forEach
                        val id = o["employee_id"]?.jsonPrimitive?.intOrNull ?: return@forEach
                        val t = totals.getOrPut(id) { DayTotals() }
                        t.sim += o.num("sim"); t.combo += o.num("combo"); t.phones += o.num("phones"); t.active = true
                    }
                    val mine = if (canManage) assignableRoles(myRole).filter { it != "supervisor" } else emptyList()
                    list.sortedBy { it.full_name.lowercase() }.forEach { e ->
                        val t = totals[e.id] ?: DayTotals()
                        Row(Modifier.fillMaxWidth().clickable { opened = e }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(42.dp).clip(CircleShape).background(if (t.active) T2Colors.successSoft else T2Colors.surface2).border(1.dp, if (t.active) T2Colors.success else T2Colors.border, CircleShape), contentAlignment = Alignment.Center) {
                                Text(e.full_name.trim().take(1).uppercase(), fontWeight = FontWeight.Bold, color = if (t.active) T2Colors.success else T2Colors.text)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(e.full_name + if (e.role != "employee" && e.role != "trainee" && e.role.isNotBlank()) " ★" else "", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                Text("SIM ${t.sim.toInt()} · Комбо ${t.combo.toInt()} · Тел ${t.phones.toInt()} · ${roleLabel(e.role)}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                            }
                            Text("›", color = T2Colors.hint, fontSize = 18.sp)
                        }
                        if (canManage) {
                            FlowRow(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                mine.filter { it != e.role }.forEach { r ->
                                    Chip(roleLabel(r)) {
                                        scope.launch {
                                            runCatching { teamApi.setRole(e.id, r) }
                                                .onSuccess { Toaster.show("Роль: ${roleLabel(r)}"); reloadKey++ }
                                                .onFailure { Toaster.show(it.message ?: "Ошибка", true) }
                                        }
                                    }
                                }
                                Chip("Удалить", danger = true) { confirmRemove = e }
                            }
                        }
                    }
                }
            }
        }
        if (canManage) {
            Spacer(Modifier.height(12.dp))
            Section("Управление") {
                fun export(type: String) {
                    val month = today.take(7)
                    val path = when (type) {
                        "sales" -> "/export/sales.csv?from=$month-01&to=$today"
                        "bfq" -> "/export/bfq.csv?month=$month"
                        else -> "/export/schedules.csv?month=$month"
                    }
                    scope.launch {
                        runCatching { teamApi.exportCsv(path) }
                            .onSuccess { bytes -> FileShare.share("${type}_$month.csv", "text/csv", bytes) }
                            .onFailure { Toaster.show("Ошибка экспорта", true) }
                    }
                }
                ListRow("₽", "История продаж", null) { HistoryFilter.employeeId = null; Nav.open(Page.History) }
                ListRow("★", "BFQ", null) { Nav.open(Page.Bfq) }
                ListRow("↓", "Экспорт продаж CSV", null) { export("sales") }
                ListRow("↓", "Экспорт BFQ CSV", null) { export("bfq") }
                ListRow("↓", "Экспорт графика CSV", null) { export("schedules") }
                ListRow("+", "Добавить сотрудника", null) { addEmployee = true }
                ListRow("+", "Добавить точку", null) { addStore = true }
                if (isAdmin) {
                    ListRow("●", "Сети", null) { Nav.open(Page.Orgs) }
                    ListRow("≡", "История действий", null) { Nav.open(Page.Audit) }
                    ListRow("▦", "Дилеры/Секторы", null) { Nav.open(Page.Dealers) }
                }
                ListRow("+", "Новая метрика плана", "SIM, MNP… + свои пункты") { metricsDialog = true }
                if (isAdmin) ListRow("?", "Тикеты поддержки", null) { Nav.open(Page.Support) }
                if (myRole == "supervisor" || isAdmin) ListRow("◎", "Кабинет супервайзера", null) { Nav.open(Page.SvOverview) }
                if (isAdmin) ListRow("⚙", "Admin Center", "Организации, точки, сотрудники, коррекции") { Nav.open(Page.AdminCenter) }
            }
        }
        Spacer(Modifier.height(96.dp))
    }

    if (addEmployee) {
        AddEmployeeSheet(assignableRoles(myRole).ifEmpty { listOf("employee") }, onDismiss = { addEmployee = false }) { name, role ->
            scope.launch {
                runCatching { teamApi.createEmployee(ru.t2sales.shared.api.CreateEmployeeRequest(name, role, if (isAdmin) viewOrgId else null)) }
                    .onSuccess { Toaster.show("Сотрудник добавлен"); addEmployee = false; reloadKey++ }
                    .onFailure { Toaster.show(it.message ?: "Ошибка", true) }
            }
        }
    }
    if (metricsDialog) MetricsDialog(container.salesApi) { metricsDialog = false }
    if (addStore) {
        AddStoreSheet(onDismiss = { addStore = false }) { req ->
            scope.launch {
                runCatching { teamApi.createStore(if (isAdmin) req.copy(org_id = viewOrgId) else req) }
                    .onSuccess { Toaster.show("Точка создана"); addStore = false }
                    .onFailure { Toaster.show(it.message ?: "Ошибка", true) }
            }
        }
    }

    opened?.let { emp ->
        val sale = sales.firstOrNull { (it as? JsonObject)?.get("employee_id")?.jsonPrimitive?.intOrNull == emp.id } as? JsonObject
        val shift = todayRows.firstOrNull { it.employee_id == emp.id }
        EmployeeCard(emp, sale, shift, canManage, onAddSale = { opened = null; AppState.openAddSale(emp.id) }, onZero = { metric ->
            scope.launch {
                val saleId = sale?.get("id")?.jsonPrimitive?.intOrNull ?: return@launch
                runCatching { container.salesApi.zeroMetric(saleId, metric) }
                    .onSuccess { Toaster.show("Исправлено"); reloadKey++; opened = null }
                    .onFailure { Toaster.show("Ошибка", true) }
            }
        }) { opened = null }
    }

    confirmRemove?.let { rem ->
        BottomSheet("Деактивировать сотрудника?", onDismiss = { confirmRemove = null }, footer = {
            MainButton("Деактивировать", container = Color(0xFFE74C3C), content = Color.White) {
                confirmRemove = null
                scope.launch {
                    runCatching { teamApi.deactivate(rem.id) }
                        .onSuccess { Toaster.show("Сотрудник деактивирован"); reloadKey++ }
                        .onFailure { Toaster.show(it.message ?: "Ошибка", true) }
                }
            }
        }) { Text("${rem.full_name} потеряет доступ к приложению. Исторические продажи сохранятся.", color = T2Colors.hint, fontSize = 14.sp) }
    }
}

@Composable
private fun Chip(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label, color = if (danger) T2Colors.danger else T2Colors.text, fontWeight = FontWeight.Bold, fontSize = 13.sp,
        modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp)
    )
}

@Composable
private fun EmployeeCard(emp: EmployeeListItem, sale: JsonObject?, shift: ScheduleRow?, canManage: Boolean, onAddSale: () -> Unit, onZero: (String) -> Unit, onDismiss: () -> Unit) {
    var confirmMetric by remember { mutableStateOf<String?>(null) }
    BottomSheet(emp.full_name, onDismiss = onDismiss, footer = { MainButton("Добавить продажу", onClick = onAddSale) }) {
        Text(roleLabel(emp.role), color = T2Colors.hint, fontSize = 13.sp)
        Spacer(Modifier.height(16.dp))
        Label("Смена сегодня")
        Text(
            if (shift != null) {
                val parts = listOfNotNull((shift.store_name ?: shift.store_id).takeIf { it.isNotBlank() }, shift.shift_text?.takeIf { it.isNotBlank() }).joinToString(" · ")
                parts + (shift.hours?.let { " (${it.toInt()}ч)" } ?: "")
            } else "Выходной / нет в графике",
            fontWeight = FontWeight.SemiBold, fontSize = 15.sp
        )
        Spacer(Modifier.height(16.dp))
        Label("Продажи сегодня")
        CARD_METRICS.forEach { (key, name) -> ProgressRow(name, sale?.num(key) ?: 0.0, 0.0) }

        val nonZero = if (canManage && sale != null) CARD_METRICS.filter { (k, _) -> sale.num(k) > 0 } else emptyList()
        if (nonZero.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Label("Исправить ошибочный ввод")
            nonZero.forEach { (key, name) ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("$name: ${sale!!.num(key).toInt()}", fontSize = 14.sp)
                    Chip("Удалить", danger = true) { confirmMetric = key }
                }
            }
        }
    }
    confirmMetric?.let { metric ->
        BottomSheet("Убрать «${CARD_METRICS.firstOrNull { it.first == metric }?.second ?: metric}» из продаж сегодня?", onDismiss = { confirmMetric = null }, footer = {
            MainButton("Убрать") { confirmMetric = null; onZero(metric) }
        }) { Text("Значение обнулится, действие попадёт в журнал.", color = T2Colors.hint, fontSize = 14.sp) }
    }
}

@Composable
private fun Label(text: String) {
    Text(text.uppercase(), color = T2Colors.hint, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp, modifier = Modifier.padding(bottom = 6.dp))
}
