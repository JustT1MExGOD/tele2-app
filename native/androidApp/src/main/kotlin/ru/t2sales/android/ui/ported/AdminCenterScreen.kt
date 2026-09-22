@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.ApiException
import ru.t2sales.shared.api.AuditItem
import ru.t2sales.shared.api.AcEmployeeDetail
import ru.t2sales.shared.api.AcEmployeeHit
import ru.t2sales.shared.api.AcOverview
import ru.t2sales.shared.api.AcStore
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private enum class AcTab(val label: String) {
    Overview("Обзор"), Employees("Сотрудники"), Stores("Точки"), Sales("Коррекции продаж"), Shifts("Коррекции смен"),
    Schedules("Коррекции графика"), Plans("Коррекции планов"), Flags("Флаги функциональности"), OrgSettings("Настройки сети"),
    Rules("Бизнес-правила"), Operations("Операционный центр"), Audit("Аудит")
}

private val ROLE_LABELS = mapOf(
    "trainee" to "Стажёр", "employee" to "Продавец", "senior" to "Старший продавец",
    "manager" to "Руководитель", "supervisor" to "Супервайзер", "admin" to "Администратор"
)
private val ROLE_ORDER = listOf("trainee", "employee", "senior", "manager", "supervisor", "admin")
private fun roleLabel(r: String) = ROLE_LABELS[r] ?: r

private const val WEB_ONLY = "Эта вкладка пока доступна только в веб-версии"

/** Port of the Admin Control Center shell (index.html #page-admin-center, pages/admin-center/index.ts): tab bar + tab body. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AdminCenterScreen(container: AppContainer) {
    var tab by remember { mutableStateOf(AcTab.Overview) }

    PageSection(null) {
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AcTab.values().forEach { t ->
                val active = t == tab
                val shape = RoundedCornerShape(T2Radius.md)
                Text(
                    t.label,
                    color = if (active) T2Colors.primary else T2Colors.text,
                    fontWeight = FontWeight.Bold, fontSize = 13.sp,
                    modifier = Modifier.clip(shape)
                        .background(if (active) T2Colors.primarySoft else T2Colors.surface2)
                        .border(1.dp, if (active) T2Colors.primary else T2Colors.border, shape)
                        .clickable { tab = t }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                )
            }
        }
    }
    Spacer(Modifier.height(12.dp))

    when (tab) {
        AcTab.Overview -> OverviewTab(container)
        AcTab.Employees -> EmployeesTab(container)
        AcTab.Stores -> StoresTab(container)
        AcTab.Audit -> AuditTab(container)
        AcTab.Sales -> SalesTab(container)
        AcTab.Shifts -> ShiftsTab(container)
        AcTab.Schedules -> SchedulesTab(container)
        AcTab.Plans -> PlansTab(container)
        AcTab.Flags -> FlagsTab(container)
        AcTab.OrgSettings -> OrgSettingsTab(container)
        AcTab.Rules -> RulesTab(container)
        AcTab.Operations -> OperationsTab(container)
        else -> PageSection(tab.label) {
            Text(WEB_ONLY, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        }
    }
}

// ---------------- Overview
@Composable
private fun OverviewTab(container: AppContainer) {
    var data by remember { mutableStateOf<AcOverview?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { container.adminCenterApi.overview() }.onSuccess { data = it }.onFailure { failed = true } }

    PageSection("Обзор сети") {
        val d = data
        when {
            failed -> Text("Не удалось загрузить обзор", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            d == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                val st = d.shifts_today
                fun num(e: kotlinx.serialization.json.JsonElement?) = (e as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() ?: 0
                val active = if (st is kotlinx.serialization.json.JsonObject) num(st["active"]) else num(st)
                val replacement = if (st is kotlinx.serialization.json.JsonObject) num(st["replacement"]) else 0
                val cards = listOf(
                    Triple("Точки", "${d.stores.active} / ${d.stores.total}", "активные / всего"),
                    Triple("Сотрудники", "${d.employees.active} / ${d.employees.total}", "активные / всего"),
                    Triple("Смены сегодня", active.toString(), "открыто" + if (replacement > 0) " · замен: $replacement" else ""),
                    Triple("Заявки на доступ", d.pending_access_requests.toString(), "в ожидании"),
                    Triple("Обращения поддержки", d.open_support_tickets.toString(), "открыто"),
                    Triple("Алерты", d.active_alerts.toString(), "активные")
                )
                BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                    val cols = ((maxWidth + 8.dp) / (160.dp + 8.dp)).toInt().coerceAtLeast(1)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        cards.chunked(cols).forEach { row ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { (t, v, sub) ->
                                    val shape = RoundedCornerShape(12.dp)
                                    Column(
                                        modifier = Modifier.weight(1f).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 10.dp),
                                        verticalArrangement = Arrangement.spacedBy(2.dp)
                                    ) {
                                        Text(t, color = T2Colors.textSecondary, fontSize = 12.sp)
                                        Text(v, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                                        Text(sub, color = T2Colors.textSecondary, fontSize = 11.sp)
                                    }
                                }
                                repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------- shared row
@Composable
internal fun NavRow(title: String, sub: String?, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            if (sub != null) Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
    }
}

@Composable
internal fun EmptyText(text: String) =
    Text(text, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))

@Composable
internal fun StatusPill(text: String) {
    val shape = RoundedCornerShape(12.dp)
    Text(text, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 12.dp, vertical = 10.dp))
}

// ---------------- Employees
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmployeesTab(container: AppContainer) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var term by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<AcEmployeeHit>?>(null) }
    var selected by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(term) {
        val t = term.trim()
        if (t.length < 2) { hits = null; return@LaunchedEffect }
        delay(250)
        hits = runCatching { api.search(t).employees }.getOrElse { emptyList() }
    }

    PageSection("Сотрудники") {
        Box(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
            Field("", term, { term = it }, placeholder = "Поиск по имени (от 2 символов)", fill = T2Colors.surface2)
        }
        val list = hits
        if (list != null) {
            if (list.isEmpty()) EmptyText("Ничего не найдено")
            else list.forEach { e -> NavRow(e.full_name, roleLabel(e.role)) { selected = e.id } }
        }
    }
    val id = selected
    if (id != null) {
        Spacer(Modifier.height(12.dp))
        EmployeeDetail(container, id)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmployeeDetail(container: AppContainer, id: Int) {
    val api = container.adminCenterApi
    val scope = rememberCoroutineScope()
    var detail by remember(id) { mutableStateOf<AcEmployeeDetail?>(null) }
    var failed by remember(id) { mutableStateOf(false) }
    var reload by remember(id) { mutableStateOf(0) }
    var roleChoice by remember(id) { mutableStateOf<String?>(null) }
    var danger by remember { mutableStateOf<Boolean>(false) }
    var resetLink by remember { mutableStateOf<String?>(null) }
    var pendingTicket by remember { mutableStateOf<((String) -> Unit)?>(null) }

    LaunchedEffect(id, reload) {
        failed = false
        runCatching { api.employee(id) }.onSuccess { detail = it; if (roleChoice == null) roleChoice = it.employee.role }.onFailure { failed = true }
    }

    fun withTicket(block: (String) -> Unit) { pendingTicket = block }
    fun toastErr(text: String) = T2Toast.show(text, true)

    val d = detail
    when {
        failed -> PageSection(null) { EmptyText("Не удалось загрузить сотрудника") }
        d == null -> LoadingBlock()
        else -> {
            val emp = d.employee
            PageSection(null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(emp.full_name.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp)
                    StatusPill(roleLabel(emp.role))
                }
                Text(
                    (if (emp.is_active) "Активен" else "Деактивирован") + (emp.access_status?.let { " \u00B7 $it" } ?: "") + (emp.hire_date?.let { " \u00B7 нанят $it" } ?: ""),
                    color = T2Colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
                val myRoles = ROLE_ORDER
                FlowRow(
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 4
                ) {
                    Box(modifier = Modifier.padding(0.dp)) {
                        SelectField("", roleLabel(roleChoice ?: emp.role), myRoles.map(::roleLabel)) { picked -> roleChoice = myRoles.first { roleLabel(it) == picked } }
                    }
                    MChipButton("Сменить роль") {
                        val newRole = roleChoice
                        if (newRole == null || newRole == emp.role) return@MChipButton
                        val mandatory = newRole == "admin" || newRole == "supervisor"
                        val run: (String?) -> Unit = { ticket ->
                            scope.launch {
                                runCatching { api.changeRole(id, newRole, ticket) }
                                    .onSuccess { T2Toast.show("Роль изменена"); reload++ }
                                    .onFailure { e ->
                                        if (e is ApiException && e.code == "step_up_required" && ticket == null) withTicket { t -> scope.launch {
                                            runCatching { api.changeRole(id, newRole, t) }.onSuccess { T2Toast.show("Роль изменена"); reload++ }.onFailure { toastErr("Не удалось изменить роль") }
                                        } }
                                        else toastErr("Не удалось изменить роль")
                                    }
                            }
                        }
                        if (mandatory) withTicket { t -> run(t) } else run(null)
                    }
                    if (emp.is_active) MChipButton("Деактивировать") { danger = true }
                    else MChipButton("Восстановить") {
                        scope.launch {
                            runCatching { api.reactivateEmployee(id) }.onSuccess { T2Toast.show("Сотрудник восстановлен"); reload++ }.onFailure { toastErr("Ошибка") }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))

            PageSection("Сессии") {
                if (d.sessions.isEmpty()) EmptyText("Нет активных сессий")
                d.sessions.forEach { s ->
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(deviceLabel(s.user_agent), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            val loc = listOfNotNull(s.city, s.country).filter { it.isNotBlank() }.joinToString(", ")
                            Text((if (loc.isNotEmpty()) "$loc \u00B7 " else "") + "посл. активность ${ruDate(s.last_seen_at)}", color = T2Colors.hint, fontSize = 13.sp)
                        }
                        MChipButton("Отозвать") {
                            scope.launch {
                                runCatching { api.revokeSession(id, s.id) }.onSuccess { T2Toast.show("Сессия отозвана"); reload++ }.onFailure { toastErr("Ошибка") }
                            }
                        }
                    }
                }
                if (d.sessions.isNotEmpty()) {
                    Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        MChipButton("Отозвать все сессии") {
                            scope.launch {
                                runCatching { api.revokeAllSessions(id) }.onSuccess { T2Toast.show("Все сессии отозваны"); reload++ }.onFailure { toastErr("Ошибка") }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))

            PageSection("Безопасность") {
                Row(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MChipButton("Сбросить MFA") {
                        withTicket { t ->
                            scope.launch {
                                runCatching { api.resetMfa(id, t) }.onSuccess { T2Toast.show("MFA сброшена") }.onFailure { toastErr("Ошибка") }
                            }
                        }
                    }
                    MChipButton("Сброс пароля") {
                        scope.launch {
                            runCatching { api.passwordReset(id) }
                                .onSuccess { r -> resetLink = ru.t2sales.shared.api.ApiConfig.PROD_API_BASE + "/?reset=" + r.token }
                                .onFailure { toastErr("Ошибка") }
                        }
                    }
                }
            }

            if (danger) {
                DangerDialog(
                    title = "Деактивировать сотрудника",
                    description = "Сотрудник потеряет доступ к системе. Действие обратимо.",
                    onDismiss = { danger = false },
                    onConfirm = {
                        danger = false
                        scope.launch {
                            runCatching { api.deactivateEmployee(id) }.onSuccess { T2Toast.show("Сотрудник деактивирован"); reload++ }.onFailure { toastErr("Ошибка") }
                        }
                    }
                )
            }
        }
    }
    val t = pendingTicket
    if (t != null) StepUpDialog(api, onDismiss = { pendingTicket = null }, onTicket = { ticket -> pendingTicket = null; t(ticket) })
    val link = resetLink
    if (link != null) ResetLinkSheet(link) { resetLink = null }
}

/** Shows the one-time reset link the server just created: it is otherwise thrown away, so an admin never had a way to hand it to the employee. */
@Composable
private fun ResetLinkSheet(link: String, onDismiss: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    BottomSheet("Ссылка на сброс пароля", onDismiss = onDismiss, footer = {
        MainButton("Скопировать и закрыть") {
            val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("Ссылка на сброс пароля T2 Sales", link))
            T2Toast.show("Скопировано")
            onDismiss()
        }
    }) {
        Text("Одноразовая, действует до первого перехода. Передайте её сотруднику лично (не в общий чат) — по ней сразу открывается его сессия.", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp))
        androidx.compose.foundation.text.selection.SelectionContainer {
            Text(link, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(T2Colors.surface2).padding(12.dp))
        }
    }
}

// ---------------- Stores
@Composable
private fun StoresTab(container: AppContainer) {
    val api = container.adminCenterApi
    var stores by remember { mutableStateOf<List<AcStore>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var selected by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reload) { runCatching { api.stores().items }.onSuccess { stores = it }.onFailure { failed = true } }

    PageSection("Точки сети") {
        val list = stores
        when {
            failed -> EmptyText("Не удалось загрузить точки")
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Нет точек")
            else -> list.forEach { s -> NavRow(s.display_name ?: s.name, s.code + if (s.is_active) "" else " \u00B7 деактивирована") { selected = s.id } }
        }
    }
    val id = selected
    if (id != null) {
        Spacer(Modifier.height(12.dp))
        StoreDetail(api, id) { reload++ }
    }
}

@Composable
private fun StoreDetail(api: ru.t2sales.shared.api.AdminCenterApi, id: String, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var store by remember(id) { mutableStateOf<AcStore?>(null) }
    var failed by remember(id) { mutableStateOf(false) }
    var reload by remember(id) { mutableStateOf(0) }
    var name by remember(id) { mutableStateOf("") }
    var danger by remember { mutableStateOf(false) }

    LaunchedEffect(id, reload) {
        failed = false
        runCatching { api.store(id).store }.onSuccess { store = it; name = it.name }.onFailure { failed = true }
    }
    val s = store
    when {
        failed -> PageSection(null) { EmptyText("Не удалось загрузить точку") }
        s == null -> LoadingBlock()
        else -> PageSection(null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically
            ) {
                Text((s.display_name ?: s.name).uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp)
                StatusPill(s.code)
            }
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("", name, { name = it }, placeholder = "Название", fill = T2Colors.surface2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MChipButton("Сохранить") {
                        if (name.isBlank()) { T2Toast.show("Укажите название", true); return@MChipButton }
                        scope.launch {
                            runCatching { api.editStoreName(id, name.trim()) }
                                .onSuccess { T2Toast.show("Сохранено"); reload++; onChanged() }
                                .onFailure { T2Toast.show("Ошибка сохранения", true) }
                        }
                    }
                    if (s.is_active) MChipButton("Деактивировать") { danger = true }
                    else MChipButton("Восстановить") {
                        scope.launch {
                            runCatching { api.reactivateStore(id) }.onSuccess { T2Toast.show("Точка восстановлена"); reload++; onChanged() }.onFailure { T2Toast.show("Ошибка", true) }
                        }
                    }
                }
            }
        }
    }
    if (danger) {
        DangerDialog(
            title = "Деактивировать точку",
            description = "Точка станет недоступна для новых смен и продаж. Действие обратимо.",
            onDismiss = { danger = false },
            onConfirm = {
                danger = false
                scope.launch {
                    runCatching { api.deactivateStore(id) }.onSuccess { T2Toast.show("Точка деактивирована"); reload++; onChanged() }.onFailure { T2Toast.show("Ошибка", true) }
                }
            }
        )
    }
}

// ---------------- Audit
@Composable
private fun AuditTab(container: AppContainer) {
    val scope = rememberCoroutineScope()
    var action by remember { mutableStateOf("") }
    var target by remember { mutableStateOf("") }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<AuditItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf(0) }

    LaunchedEffect(query) {
        failed = false
        items = null
        runCatching { container.adminApi.getAudit(action.trim().ifEmpty { null }, target.trim().ifEmpty { null }, from.ifBlank { null }, to.ifBlank { null }, 100, 0).items }
            .onSuccess { items = it }.onFailure { failed = true }
    }

    PageSection("Журнал действий") {
        FlowRow(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 2) {
            Box(Modifier.weight(1f)) { Field("", action, { action = it }, placeholder = "action", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", target, { target = it }, placeholder = "тип цели", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", from, { from = it }, placeholder = "С ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", to, { to = it }, placeholder = "По ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
            MChipButton("Найти") { query++ }
        }
        val list = items
        when {
            failed -> EmptyText("Ошибка загрузки")
            list == null -> LoadingBlock(Modifier.padding(16.dp))
            list.isEmpty() -> EmptyText("Записей не найдено")
            else -> list.forEach { i ->
                Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp)) {
                    Text("${i.action} \u00B7 ${i.target_type}${i.target_id?.let { " #$it" } ?: ""}", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text((i.actor_name ?: "система") + (i.actor_role?.let { " ($it)" } ?: ""), color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

private fun ruDate(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))
}.getOrDefault(iso.take(10))

private fun deviceLabel(ua: String?): String {
    if (ua.isNullOrBlank()) return "\uD83C\uDF10 Неизвестное устройство"
    val mobile = Regex("Mobi|Android|iPhone|iPod|iPad").containsMatchIn(ua)
    val os = when {
        "iPad" in ua -> "iPadOS"; "iPhone" in ua -> "iOS"; "Android" in ua -> "Android"; "Windows" in ua -> "Windows"
        "Mac OS X" in ua -> "macOS"; "Linux" in ua -> "Linux"; else -> "Неизвестная ОС"
    }
    val browser = when {
        "YaBrowser" in ua -> "Яндекс Браузер"; "Edg/" in ua -> "Edge"; "OPR/" in ua -> "Opera"; "Firefox" in ua -> "Firefox"
        "Chrome" in ua -> "Chrome"; "Safari" in ua -> "Safari"; else -> "Браузер"
    }
    return (if (mobile) "\uD83D\uDCF1 " else "\uD83D\uDCBB ") + "$browser, $os"
}
