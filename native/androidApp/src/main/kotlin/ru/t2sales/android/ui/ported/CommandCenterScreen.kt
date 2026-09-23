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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.UUID
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.CcAction
import ru.t2sales.shared.api.CcProblem
import ru.t2sales.shared.api.CcResponse
import ru.t2sales.shared.api.CcStore
import ru.t2sales.shared.api.EmployeeListItem
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius
import ru.t2sales.shared.theme.T2Spacing

private const val WEB_ONLY = "Этот раздел пока доступен только в веб-версии"

private class TaskCtx(val storeId: String?, val employeeId: Int?, val alertId: Int?, val title: String)

/** Port of pages/command-center: «Что происходит», «Где проблема», sector analytics link, task creation. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CommandCenterScreen(container: AppContainer, me: MeResponse, onNavigate: (Screen) -> Unit) {
    val api = container.commandCenterApi
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<CcResponse?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var taskCtx by remember { mutableStateOf<TaskCtx?>(null) }

    LaunchedEffect(reload) {
        failed = false
        runCatching { api.get() }.onSuccess { data = it }.onFailure { failed = true }
    }

    val d = data
    when {
        failed -> Text("Command Center сейчас недоступен, зайди чуть позже", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        d == null -> LoadingBlock()
        else -> {
            val n = d.network
            val tone = when {
                n.health >= 75 -> Color(0xFF30D158)
                n.health >= 45 -> Color(0xFFFF9F0A)
                else -> Color(0xFFFF453A)
            }
            val pace = n.pace_delta.roundToInt()

            Section("Что происходит") {
                Row(modifier = Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(
                        modifier = Modifier.size(52.dp).clip(CircleShape).background(tone.copy(alpha = 0.13f)).border(2.dp, tone.copy(alpha = 0.27f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) { Text(n.health.roundToInt().toString(), color = tone, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp) }
                    Column {
                        Row {
                            Text("${n.overall_pct.roundToInt()}%", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text(" план дня \u00b7 ${n.staff_on_shift} на смене \u00b7 ${n.stores_count} точек", fontSize = 13.sp)
                        }
                        Text((if (pace >= 0) "+$pace" else "$pace") + "% к темпу дня", color = if (pace >= 0) T2Colors.success else T2Colors.danger, fontSize = 13.sp)
                    }
                }
                Box(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp)) {
                    if (d.stores.isEmpty()) Text("Нет точек в сети", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
                    else CcGrid(d.stores) { StoreBlock(it) }
                }
            }
            Spacer(Modifier.height(T2Spacing.sp3))

            Section("Где проблема" + if (d.problems.isNotEmpty()) " (${d.problems.size})" else "") {
                Box(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                    if (d.problems.isEmpty()) Text("Проблем нет — сеть в ритме", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 10.dp))
                    else CcGrid(d.problems) { p ->
                        ProblemCard(p,
                            onAction = { a ->
                                when (a.type) {
                                    "open_employee" -> onNavigate(Screen.Team)
                                    "open_store" -> AppNav.openStore(a.id?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: a.store_id ?: "")
                                    "create_task" -> taskCtx = TaskCtx(a.store_id, a.employee_id, a.alert_id, a.message ?: "")
                                }
                            },
                            onAck = { id ->
                                scope.launch {
                                    runCatching { api.ackAlert(id) }
                                        .onSuccess { T2Toast.show("Взято в работу"); reload++ }
                                        .onFailure { T2Toast.show("Не удалось обновить алерт", true) }
                                }
                            }
                        )
                    }
                }
            }

            if (me.role == "admin" || me.role == "supervisor") {
                Spacer(Modifier.height(T2Spacing.sp3))
                Section(null) {
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { onNavigate(Screen.SvOverview) }.padding(horizontal = 16.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val shape = RoundedCornerShape(T2Radius.sm)
                        Box(Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), contentAlignment = Alignment.Center) {
                            NavIcon(NavIcons.commandCenter, contentDescription = null, tint = T2Colors.textSecondary, size = 20.dp)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Полная аналитика сектора", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Text("Тренд · топ продавцов · разбивка по точкам", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                        }
                        Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
                    }
                }
            }
        }
    }

    val ctx = taskCtx
    if (ctx != null) {
        CreateTaskDialog(container, ctx, onDismiss = { taskCtx = null }) {
            taskCtx = null
            reload++
        }
    }
}

@Composable
private fun Section(title: String?, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        if (title != null) {
            Text(
                title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
            )
        }
        content()
    }
}

/** .workspace-grid: auto-fit columns of at least 320dp. */
@Composable
private fun <T> CcGrid(items: List<T>, item: @Composable (T) -> Unit) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val cols = ((maxWidth + 16.dp) / (320.dp + 16.dp)).toInt().coerceAtLeast(1)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items.chunked(cols).forEach { row ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                    row.forEach { Box(modifier = Modifier.weight(1f)) { item(it) } }
                    repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun StoreBlock(st: CcStore) {
    val color = st.color?.let { runCatching { Color(("FF" + it.removePrefix("#")).toLong(16)) }.getOrNull() } ?: Color(0xFF2AABEE)
    val t = st.today
    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp))) {
        Box(Modifier.width(4.dp).height(56.dp).background(color))
        Column(modifier = Modifier.weight(1f).padding(start = 12.dp, top = 4.dp, bottom = 4.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(st.name, fontWeight = FontWeight.Bold)
                Text("${(t?.overall ?: 0.0).roundToInt()}%", fontWeight = FontWeight.Bold)
            }
            Text(
                "${st.staff_count ?: 0} на смене \u00b7 SIM ${(t?.sim ?: 0.0).roundToInt()}/${(t?.plan_sim ?: 0.0).roundToInt()} \u00b7 MNP ${(t?.mnp ?: 0.0).roundToInt()}/${(t?.plan_mnp ?: 0.0).roundToInt()}",
                color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProblemCard(p: CcProblem, onAction: (CcAction) -> Unit, onAck: (Int) -> Unit) {
    val warn = p.severity != "critical"
    val c = if (warn) Color(0xFFFF9F0A) else Color(0xFFFF453A)
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.linearGradient(listOf(c.copy(alpha = 0.12f), c.copy(alpha = 0.04f))))
            .border(1.dp, c.copy(alpha = if (warn) 0.30f else 0.25f), shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(if (warn) "\u26A0\uFE0F" else "\uD83D\uDD34", fontSize = 18.sp)
        Column(modifier = Modifier.weight(1f)) {
            Text(p.store_name ?: "Точка", fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text(p.message, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            if (!p.ai_comment.isNullOrBlank()) Text("\u2728 ${p.ai_comment}", color = T2Colors.hint, fontSize = 12.sp, fontStyle = FontStyle.Italic, modifier = Modifier.padding(top = 4.dp))
            FlowRow(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                p.actions.forEach { a ->
                    val label = when (a.type) { "open_employee" -> "Открыть сотрудника"; "open_store" -> "Открыть точку"; "create_task" -> "Создать задачу"; else -> null }
                    if (label != null) Chip(label) { onAction(a) }
                }
                p.alert_id?.let { id -> Chip("Взять в работу") { onAck(id) } }
            }
        }
    }
}

@Composable
private fun Chip(label: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Text(
        label, fontWeight = FontWeight.Bold, fontSize = 13.sp,
        modifier = Modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp)
    )
}

@Composable
private fun CreateTaskDialog(container: AppContainer, ctx: TaskCtx, onDismiss: () -> Unit, onCreated: () -> Unit) {
    val scope = rememberCoroutineScope()
    var employees by remember { mutableStateOf<List<EmployeeListItem>>(emptyList()) }
    var title by remember { mutableStateOf(ctx.title) }
    var assignee by remember { mutableStateOf<EmployeeListItem?>(null) }
    var priority by remember { mutableStateOf("normal") }
    var due by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val clientId = remember { UUID.randomUUID().toString() }
    val priorities = listOf("normal" to "Обычный", "high" to "Высокий", "urgent" to "Срочно", "low" to "Низкий")

    LaunchedEffect(Unit) {
        runCatching { container.teamApi.getEmployees() }.onSuccess { list ->
            employees = list
            assignee = list.firstOrNull { it.id == ctx.employeeId } ?: list.firstOrNull()
        }
    }

    SheetDialog("Новая задача", onDismiss) {
        Field("Что сделать", title, { title = it }, placeholder = "Например: проверить остатки после 18:00", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        SelectField("Кому", assignee?.full_name ?: "", employees.map { it.full_name }) { picked -> assignee = employees.firstOrNull { it.full_name == picked } }
        Spacer(Modifier.height(16.dp))
        SelectField("Приоритет", priorities.first { it.first == priority }.second, priorities.map { it.second }) { picked -> priority = priorities.first { it.second == picked }.first }
        Spacer(Modifier.height(16.dp))
        Field("Дедлайн (необязательно)", due, { due = it }, placeholder = "ГГГГ-ММ-ДД ЧЧ:ММ", fill = T2Colors.surface2)
        Spacer(Modifier.height(20.dp))
        MainButton(if (busy) "Создаём…" else "Создать", enabled = !busy) {
            val a = assignee
            if (title.isBlank() || a == null) {
                T2Toast.show("Укажи, что сделать и кому", true)
                return@MainButton
            }
            val dueIso = if (due.isBlank()) null else runCatching {
                LocalDateTime.parse(due.trim().replace(' ', 'T')).atZone(ZoneId.systemDefault()).toInstant().toString()
            }.getOrElse {
                T2Toast.show("Дедлайн в формате ГГГГ-ММ-ДД ЧЧ:ММ", true)
                return@MainButton
            }
            busy = true
            val body = buildJsonObject {
                put("title", JsonPrimitive(title.trim()))
                put("assigned_to", JsonPrimitive(a.id))
                put("priority", JsonPrimitive(priority))
                ctx.storeId?.let { put("store_id", JsonPrimitive(it)) }
                ctx.alertId?.let { put("alert_id", JsonPrimitive(it)) }
                dueIso?.let { put("due_at", JsonPrimitive(it)) }
                put("client_id", JsonPrimitive(clientId))
            }
            scope.launch {
                runCatching { container.commandCenterApi.createTask(body) }
                    .onSuccess { T2Toast.show("Задача создана"); onCreated() }
                    .onFailure { T2Toast.show(it.message ?: "Не удалось создать задачу", true); busy = false }
            }
        }
    }
}
