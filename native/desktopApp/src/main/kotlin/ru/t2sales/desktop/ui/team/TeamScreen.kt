package ru.t2sales.desktop.ui.team

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.awt.FileDialog
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import androidx.compose.material.Icon
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Store
import ru.t2sales.desktop.ui.components.AvatarImage
import ru.t2sales.desktop.ui.home.ProgressRow
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.FieldBox
import ru.t2sales.desktop.ui.components.FieldLabel
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.CreateEmployeeRequest
import ru.t2sales.shared.api.CreateStoreRequest
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.OrgAdminItem
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.api.ScheduleApi
import ru.t2sales.shared.api.ScheduleRow
import ru.t2sales.shared.api.TeamApi
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private val ROLE_ORDER = listOf("trainee", "employee", "senior", "manager", "supervisor", "admin")
private val ROLE_LEVEL = mapOf("guest" to -1, "trainee" to 0, "employee" to 1, "senior" to 2, "manager" to 3, "supervisor" to 4, "admin" to 5)
private val ROLE_LABELS = mapOf(
    "trainee" to "Стажёр",
    "employee" to "Продавец",
    "senior" to "Старший продавец",
    "manager" to "Руководитель",
    "supervisor" to "Супервайзер",
    "admin" to "Администратор"
)
private fun roleLabel(role: String) = ROLE_LABELS[role] ?: role.ifBlank { "Продавец" }
private fun assignableRoles(myRole: String): List<String> {
    if (myRole == "admin") return ROLE_ORDER
    val level = ROLE_LEVEL[myRole] ?: -1
    return ROLE_ORDER.filter { (ROLE_LEVEL[it] ?: 0) < level }
}

private val CARD_METRICS = listOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо",
    "phones" to "Телефоны", "accessories" to "Аксессуары", "wink" to "Wink", "shpd" to "ШПД"
)

private class Totals(var sim: Double = 0.0, var combo: Double = 0.0, var phones: Double = 0.0, var active: Boolean = false)
private enum class SortKey { Name, Role, Sim, Combo, Phones }
private fun JsonObject.num(key: String) = this[key]?.jsonPrimitive?.doubleOrNull ?: 0.0


/** Port of pages/team (index.html #page-team): org switcher (admin), «Сотрудники» table with actions, «Управление» list. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TeamScreen(teamApi: TeamApi, scheduleApi: ScheduleApi, salesApi: SalesApi, adminApi: ru.t2sales.shared.api.AdminApi, me: MeResponse?, onNavigate: (ru.t2sales.shared.navigation.Screen) -> Unit) {
    val myRole = me?.role ?: "employee"
    val canManage = myRole == "manager" || myRole == "admin" || me?.is_manager == true
    val isAdmin = myRole == "admin"
    val scope = rememberCoroutineScope()

    var viewOrgId by remember { mutableStateOf<String?>(null) }
    var orgs by remember { mutableStateOf<List<OrgAdminItem>>(emptyList()) }
    var employees by remember { mutableStateOf<List<EmployeeListItem>?>(null) }
    var sales by remember { mutableStateOf<JsonArray>(JsonArray(emptyList())) }
    var todayRows by remember { mutableStateOf<List<ScheduleRow>>(emptyList()) }
    var failed by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableStateOf(0) }
    var sort by remember { mutableStateOf(SortKey.Name) }
    var ascending by remember { mutableStateOf(true) }
    var opened by remember { mutableStateOf<EmployeeListItem?>(null) }
    var confirmRemove by remember { mutableStateOf<EmployeeListItem?>(null) }
    var addEmployee by remember { mutableStateOf(false) }
    var addStore by remember { mutableStateOf(false) }
    var metricsDialog by remember { mutableStateOf(false) }
    var sectorFor by remember { mutableStateOf<EmployeeListItem?>(null) }

    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() }

    LaunchedEffect(Unit) {
        if (isAdmin) runCatching { teamApi.getOrgs() }.onSuccess { orgs = it }
    }
    LaunchedEffect(viewOrgId, reloadKey) {
        failed = false
        runCatching { teamApi.getEmployees(viewOrgId) }.onSuccess { employees = it }.onFailure { failed = true }
        runCatching { teamApi.getSales(today, viewOrgId) }.onSuccess { sales = it }
        runCatching { scheduleApi.getSchedules(today, viewOrgId) }.onSuccess { todayRows = it }
    }

    if (isAdmin && orgs.isNotEmpty()) {
        OrgSwitcher(orgs, viewOrgId ?: me?.org_id) { viewOrgId = it }
        Spacer(Modifier.height(T2Spacing.sp3))
    }

    SectionCard("Сотрудники") {
        val list = employees
        when {
            failed -> Text("Не получилось загрузить команду, зайди чуть позже", color = T2Colors.danger)
            list == null -> CircularProgressIndicator()
            list.isEmpty() -> Text("В команде пока никого нет", color = T2Colors.hint)
            else -> {
                val totals = HashMap<Int, Totals>()
                sales.forEach { row ->
                    val o = row as? JsonObject ?: return@forEach
                    val id = o["employee_id"]?.jsonPrimitive?.intOrNull ?: return@forEach
                    val t = totals.getOrPut(id) { Totals() }
                    t.sim += o.num("sim"); t.combo += o.num("combo"); t.phones += o.num("phones"); t.active = true
                }
                val sorted = list.sortedWith { a, b ->
                    val ta = totals[a.id] ?: Totals()
                    val tb = totals[b.id] ?: Totals()
                    val c = when (sort) {
                        SortKey.Name -> a.full_name.compareTo(b.full_name, ignoreCase = true)
                        SortKey.Role -> roleLabel(a.role).compareTo(roleLabel(b.role))
                        SortKey.Sim -> ta.sim.compareTo(tb.sim)
                        SortKey.Combo -> ta.combo.compareTo(tb.combo)
                        SortKey.Phones -> ta.phones.compareTo(tb.phones)
                    }
                    if (ascending) c else -c
                }
                fun sortBy(k: SortKey) { if (sort == k) ascending = !ascending else { sort = k; ascending = true } }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(T2Radius.sm))
                        .background(T2Colors.surface2)
                        .padding(horizontal = T2Spacing.sp4, vertical = T2Spacing.sp3),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    HeaderCell("ФИО", SortKey.Name, sort, ascending, Modifier.weight(3f), ::sortBy)
                    HeaderCell("Роль", SortKey.Role, sort, ascending, Modifier.weight(2f), ::sortBy)
                    HeaderCell("SIM", SortKey.Sim, sort, ascending, Modifier.weight(1f), ::sortBy)
                    HeaderCell("Комбо", SortKey.Combo, sort, ascending, Modifier.weight(1f), ::sortBy)
                    HeaderCell("Тел", SortKey.Phones, sort, ascending, Modifier.weight(1f), ::sortBy)
                    Text("Статус", color = T2Colors.hint, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.weight(2f))
                    Text("Действия", color = T2Colors.hint, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.weight(4f))
                }
                val mine = if (canManage) assignableRoles(myRole) else emptyList()
                sorted.forEach { e ->
                    val t = totals[e.id] ?: Totals()
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { opened = e }
                            .padding(horizontal = T2Spacing.sp4, vertical = T2Spacing.sp3),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(modifier = Modifier.weight(3f), verticalAlignment = Alignment.CenterVertically) {
                            AvatarImage(teamApi, e.id, e.full_name.trim().take(1).uppercase(), size = 52.dp, active = t.active)
                            Spacer(Modifier.width(T2Spacing.sp3))
                            Text(e.full_name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        }
                        Text(roleLabel(e.role), modifier = Modifier.weight(2f), fontSize = 13.sp)
                        Text(t.sim.toInt().toString(), modifier = Modifier.weight(1f), fontSize = 13.sp)
                        Text(t.combo.toInt().toString(), modifier = Modifier.weight(1f), fontSize = 13.sp)
                        Text(t.phones.toInt().toString(), modifier = Modifier.weight(1f), fontSize = 13.sp)
                        Text(if (t.active) "Активен сегодня" else "—", modifier = Modifier.weight(2f), fontSize = 13.sp)
                        FlowRow(
                            modifier = Modifier.weight(4f),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            if (canManage) {
                                mine.filter { it != e.role }.forEach { r ->
                                    Chip(roleLabel(r)) {
                                        if (r == "supervisor") {
                                            sectorFor = e
                                        } else scope.launch {
                                            runCatching { teamApi.setRole(e.id, r) }
                                                .onSuccess { T2Toast.show("Роль: ${roleLabel(r)}"); reloadKey++ }
                                                .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                                        }
                                    }
                                }
                                Chip("Удалить", danger = true) { confirmRemove = e }
                            }
                        }
                    }
                    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                }
            }
        }
    }

    if (canManage) {
        Spacer(Modifier.height(T2Spacing.sp3))
        SectionCard("Управление") {
            fun export(type: String) {
                val month = today.take(7)
                val path = when (type) {
                    "sales" -> "/export/sales.csv?from=$month-01&to=$today"
                    "bfq" -> "/export/bfq.csv?month=$month"
                    else -> "/export/schedules.csv?month=$month"
                } + (viewOrgId?.let { "&org_id=$it" } ?: "")
                scope.launch {
                    runCatching { teamApi.exportCsv(path) }
                        .onSuccess { bytes ->
                            val dlg = FileDialog(null as java.awt.Frame?, "Сохранить CSV", FileDialog.SAVE)
                            dlg.file = "${type}_$month.csv"
                            dlg.isVisible = true
                            val name = dlg.file
                            if (name != null) {
                                File(dlg.directory, name).writeBytes(bytes)
                                T2Toast.show("Скачано")
                            }
                        }
                        .onFailure { T2Toast.show("Ошибка экспорта", true) }
                }
            }
            ToolRow(Icons.Outlined.Receipt, "История продаж", null) { ru.t2sales.desktop.ui.history.HistoryFilter.employeeId = null; onNavigate(ru.t2sales.shared.navigation.Screen.History) }
            ToolRow(Icons.Outlined.EmojiEvents, "BFQ", null) { onNavigate(ru.t2sales.shared.navigation.Screen.Bfq) }
            ToolRow(Icons.Outlined.Download, "Экспорт продаж CSV", null) { export("sales") }
            ToolRow(Icons.Outlined.Download, "Экспорт BFQ CSV", null) { export("bfq") }
            ToolRow(Icons.Outlined.Download, "Экспорт графика CSV", null) { export("schedules") }
            ToolRow(Icons.Outlined.Add, "Добавить сотрудника", null) { addEmployee = true }
            ToolRow(Icons.Outlined.Store, "Добавить точку", null) { addStore = true }
            if (isAdmin) {
                ToolRow(Icons.Outlined.Public, "Сети", null) { onNavigate(ru.t2sales.shared.navigation.Screen.Orgs) }
                ToolRow(Icons.Outlined.History, "История действий", null) { onNavigate(ru.t2sales.shared.navigation.Screen.Audit) }
                ToolRow(Icons.Outlined.Business, "Дилеры/Секторы", null) { onNavigate(ru.t2sales.shared.navigation.Screen.Dealers) }
            }
            ToolRow(Icons.Outlined.Extension, "Новая метрика плана", "SIM, MNP… + свои пункты") { metricsDialog = true }
            if (isAdmin) ToolRow(Icons.Outlined.Receipt, "Тикеты поддержки", null) { onNavigate(ru.t2sales.shared.navigation.Screen.Support) }
        }
    }

    val sup = sectorFor
    if (sup != null) {
        ru.t2sales.desktop.ui.admin.SectorPickerDialog(
            adminApi = adminApi,
            title = "Сектор для ${sup.full_name}",
            currentSectorId = null,
            allowSkip = true,
            onDismiss = { sectorFor = null },
            onSkip = {
                scope.launch {
                    runCatching { teamApi.setRole(sup.id, "supervisor") }
                        .onSuccess { T2Toast.show("Роль: ${roleLabel("supervisor")}"); sectorFor = null; reloadKey++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            },
            onPick = { sectorId ->
                scope.launch {
                    runCatching { teamApi.setRole(sup.id, "supervisor", sectorId) }
                        .onSuccess { T2Toast.show("Роль: ${roleLabel("supervisor")}"); sectorFor = null; reloadKey++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            }
        )
    }

    val emp = opened
    if (emp != null) {
        val sale = sales.firstOrNull { (it as? JsonObject)?.get("employee_id")?.jsonPrimitive?.intOrNull == emp.id } as? JsonObject
        val shift = todayRows.firstOrNull { it.employee_id == emp.id }
        EmployeeCard(
            emp, sale, shift, canManage,
            onAddSale = { opened = null; AddSaleState.open(emp.id) },
            onZero = { metric ->
                scope.launch {
                    val saleId = sale?.get("id")?.jsonPrimitive?.intOrNull
                    if (saleId == null) return@launch
                    runCatching { salesApi.zeroMetric(saleId, metric) }
                        .onSuccess { T2Toast.show("Исправлено"); reloadKey++; opened = null }
                        .onFailure { T2Toast.show("Ошибка", true) }
                }
            }
        ) { opened = null }
    }

    val rem = confirmRemove
    if (rem != null) {
        SheetDialog("Деактивировать сотрудника?", onDismiss = { confirmRemove = null }) {
            Text(rem.full_name, color = T2Colors.hint, modifier = Modifier.padding(bottom = 16.dp))
            MainButton("Деактивировать", enabled = true) {
                confirmRemove = null
                scope.launch {
                    runCatching { teamApi.deactivate(rem.id) }
                        .onSuccess { T2Toast.show("Удалён"); reloadKey++ }
                        .onFailure { T2Toast.show("Ошибка", true) }
                }
            }
        }
    }

    if (addEmployee) {
        AddEmployeeDialog(assignableRoles(myRole).ifEmpty { listOf("employee") }, onDismiss = { addEmployee = false }) { name, role ->
            scope.launch {
                runCatching { teamApi.createEmployee(CreateEmployeeRequest(name, role, if (isAdmin) viewOrgId else null)) }
                    .onSuccess { T2Toast.show("Сотрудник добавлен"); addEmployee = false; reloadKey++ }
                    .onFailure { T2Toast.show("Ошибка", true) }
            }
        }
    }
    if (metricsDialog) MetricsDialog(salesApi) { metricsDialog = false }
    if (addStore) {
        AddStoreDialog(onDismiss = { addStore = false }) { req ->
            scope.launch {
                runCatching { teamApi.createStore(req.copy(org_id = if (isAdmin) viewOrgId else null)) }
                    .onSuccess { T2Toast.show("Точка создана"); addStore = false }
                    .onFailure { T2Toast.show("Ошибка", true) }
            }
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.lg)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(T2Colors.surface)
            .border(1.dp, T2Colors.border, shape)
            .padding(T2Spacing.sp4)
    ) {
        Text(title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.6.sp)
        Spacer(Modifier.height(T2Spacing.sp3))
        content()
    }
}

@Composable
private fun HeaderCell(label: String, key: SortKey, current: SortKey, asc: Boolean, modifier: Modifier, onSort: (SortKey) -> Unit) {
    val arrow = if (key == current) (if (asc) "↑" else "↓") else "⇅"
    Text(
        "$label $arrow",
        color = if (key == current) T2Colors.primary else T2Colors.hint,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        modifier = modifier.clickable { onSort(key) }
    )
}

@Composable
private fun Chip(label: String, danger: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label,
        color = if (danger) T2Colors.danger else T2Colors.text,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        modifier = Modifier
            .clip(shape)
            .background(T2Colors.surface2)
            .border(1.dp, T2Colors.border, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp)
    )
}

@Composable
private fun ToolRow(icon: ImageVector, title: String, sub: String?, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(T2Radius.sm))
            .clickable(onClick = onClick)
            .padding(vertical = T2Spacing.sp2),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val shape = RoundedCornerShape(T2Radius.sm)
        Box(
            modifier = Modifier.size(52.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
            contentAlignment = Alignment.Center
        ) { Icon(icon, contentDescription = null, tint = T2Colors.text, modifier = Modifier.size(22.dp)) }
        Spacer(Modifier.width(T2Spacing.sp4))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 12.sp)
        }
        Text("›", color = T2Colors.hint, fontSize = 22.sp)
    }
}

@Composable
private fun OrgSwitcher(orgs: List<OrgAdminItem>, currentId: String?, onPick: (String) -> Unit) {
    fun dealerOf(o: OrgAdminItem) = o.dealer_name ?: "Без дилера"
    fun sectorOf(o: OrgAdminItem) = o.sector_id ?: "default"
    val current = orgs.firstOrNull { it.id == currentId } ?: orgs.first()
    val dealers = orgs.map(::dealerOf).distinct().sorted()
    val sectors = orgs.filter { dealerOf(it) == dealerOf(current) }.map(::sectorOf).distinct().sorted()
    val inSector = orgs.filter { dealerOf(it) == dealerOf(current) && sectorOf(it) == sectorOf(current) }

    Column(modifier = Modifier.fillMaxWidth()) {
        Picker("Дилер", dealerOf(current), dealers) { d ->
            val firstSector = orgs.filter { dealerOf(it) == d }.map(::sectorOf).distinct().sorted().first()
            orgs.firstOrNull { dealerOf(it) == d && sectorOf(it) == firstSector }?.let { onPick(it.id) }
        }
        Spacer(Modifier.height(T2Spacing.sp2))
        Picker("Сектор", sectorOf(current), sectors) { s ->
            orgs.firstOrNull { dealerOf(it) == dealerOf(current) && sectorOf(it) == s }?.let { onPick(it.id) }
        }
        Spacer(Modifier.height(T2Spacing.sp2))
        Picker("Сеть", current.name, inSector.map { it.name }) { n ->
            inSector.firstOrNull { it.name == n }?.let { onPick(it.id) }
        }
    }
}

@Composable
private fun Picker(label: String, value: String, options: List<String>, onPick: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        FieldLabel(label)
        ru.t2sales.desktop.ui.components.DropdownField(value, options, onPick = onPick)
    }
}

@Composable
private fun EmployeeCard(
    emp: EmployeeListItem,
    sale: JsonObject?,
    shift: ScheduleRow?,
    canManage: Boolean,
    onAddSale: () -> Unit,
    onZero: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var confirmMetric by remember { mutableStateOf<String?>(null) }
    SheetDialog(emp.full_name, onDismiss) {
        Text(roleLabel(emp.role), color = T2Colors.hint, fontSize = 13.sp)
        Spacer(Modifier.height(16.dp))
        FieldLabel("Смена сегодня")
        Text(
            if (shift != null) {
                val parts = listOfNotNull(
                    (shift.store_name ?: shift.store_id).takeIf { it.isNotBlank() },
                    shift.shift_text?.takeIf { it.isNotBlank() }
                ).joinToString(" \u00b7 ")
                parts + (shift.hours?.let { " (${it.toInt()}\u0447)" } ?: "")
            } else "Выходной / нет в графике",
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp
        )
        Spacer(Modifier.height(16.dp))
        FieldLabel("Продажи сегодня")
        CARD_METRICS.forEach { (key, name) -> ProgressRow(name, sale?.num(key) ?: 0.0, 0.0) }

        val nonZero = if (canManage && sale != null) CARD_METRICS.filter { (k, _) -> sale.num(k) > 0 } else emptyList()
        if (nonZero.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            FieldLabel("Исправить ошибочный ввод")
            nonZero.forEach { (key, name) ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("$name: ${sale!!.num(key).toInt()}", fontSize = 14.sp)
                    Chip("Удалить", danger = true) { confirmMetric = key }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        MainButton("Добавить продажу", enabled = true, onClick = onAddSale)
    }
    val metric = confirmMetric
    if (metric != null) {
        SheetDialog("Убрать «${CARD_METRICS.firstOrNull { it.first == metric }?.second ?: metric}» из продаж сегодня?", { confirmMetric = null }) {
            MainButton("Убрать", enabled = true) { confirmMetric = null; onZero(metric) }
        }
    }
}

@Composable
private fun AddEmployeeDialog(roles: List<String>, onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(if ("employee" in roles) "employee" else roles.first()) }
    var error by remember { mutableStateOf<String?>(null) }
    SheetDialog("Новый сотрудник", onDismiss) {
        Field("ФИО", name, { name = it }, fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        Picker("Роль", roleLabel(role), roles.map(::roleLabel)) { picked -> roles.firstOrNull { roleLabel(it) == picked }?.let { role = it } }
        error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
        Spacer(Modifier.height(20.dp))
        MainButton("Создать", enabled = true) {
            if (name.isBlank()) error = "Укажите ФИО" else onCreate(name.trim(), role)
        }
    }
}

@Composable
private fun AddStoreDialog(onDismiss: () -> Unit, onCreate: (CreateStoreRequest) -> Unit) {
    var id by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("#6d9eeb") }
    var workTime by remember { mutableStateOf("10-21") }
    var hours by remember { mutableStateOf("11") }
    var openTime by remember { mutableStateOf("09:00") }
    var closeTime by remember { mutableStateOf("21:00") }
    var allDay by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    SheetDialog("Новая точка", onDismiss) {
        val fill = T2Colors.surface2
        Field("ID (латиница)", id, { id = it }, fill = fill); Spacer(Modifier.height(12.dp))
        Field("Название", name, { name = it }, fill = fill); Spacer(Modifier.height(12.dp))
        Field("Код", code, { code = it }, fill = fill); Spacer(Modifier.height(12.dp))
        Field("Цвет", color, { color = it }, fill = fill); Spacer(Modifier.height(12.dp))
        if (!allDay) {
            Field("Часы работы (например 10-21)", workTime, { workTime = it }, fill = fill); Spacer(Modifier.height(12.dp))
            Field("Часов в смене", hours, { hours = it.filter(Char::isDigit).take(2) }, fill = fill); Spacer(Modifier.height(12.dp))
        }
        Field("Время открытия", openTime, { openTime = it }, fill = fill); Spacer(Modifier.height(12.dp))
        Field("Время итога дня", closeTime, { closeTime = it }, fill = fill); Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { allDay = !allDay }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(if (allDay) "☑" else "☐", fontSize = 20.sp, color = T2Colors.primary)
            Spacer(Modifier.width(8.dp))
            Text("Круглосуточно")
        }
        error?.let { Text(it, color = T2Colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
        Spacer(Modifier.height(20.dp))
        MainButton("Создать", enabled = true) {
            if (id.isBlank() || name.isBlank()) error = "ID и название обязательны"
            else onCreate(
                CreateStoreRequest(
                    id = id.trim(), name = name.trim(), code = code.trim(), color = color.trim(),
                    work_time = if (allDay) "круглосуточно" else workTime.trim().ifEmpty { null },
                    hours = if (allDay) 24 else (hours.toIntOrNull() ?: 11),
                    close_time_weekday = closeTime.trim().ifEmpty { null },
                    close_time_sunday = closeTime.trim().ifEmpty { null },
                    open_time_weekday = openTime.trim().ifEmpty { null },
                    open_time_sunday = openTime.trim().ifEmpty { null }
                )
            )
        }
    }
}
