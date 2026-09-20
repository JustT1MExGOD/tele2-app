package ru.t2sales.desktop.ui.tasks

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.CircularProgressIndicator
import androidx.compose.material.Icon
import androidx.compose.material.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Assignment
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
import kotlinx.coroutines.launch
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.FieldLabel
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.TaskDetailResponse
import ru.t2sales.shared.api.TaskListItem
import ru.t2sales.shared.api.TasksApi
import ru.t2sales.shared.theme.T2Colors

private val STATUS_LABEL = mapOf("open" to "Открыта", "in_progress" to "В работе", "done" to "Выполнена", "cancelled" to "Отменена")

private enum class TaskFilter(val label: String) {
    Active("Активные"), Done("Выполненные"), All("Все");

    fun matches(t: TaskListItem) = when (this) {
        Active -> t.status == "open" || t.status == "in_progress"
        Done -> t.status == "done"
        All -> true
    }
}

private fun ruDateTime(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm:ss"))
}.getOrDefault(iso)

/** Port of pages/tasks: filter chips + rows on the sheet, detail as a modal («Задача»). */
@Composable
fun TasksScreen(tasksApi: TasksApi, myEmployeeId: Int?, role: String?, isManagerFlag: Boolean) {
    val canManageTask = role == "manager" || role == "admin" || role == "supervisor" || isManagerFlag
    var tasks by remember { mutableStateOf<List<TaskListItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(TaskFilter.Active) }
    var openId by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(openId == null) {
        if (openId == null) {
            runCatching { tasksApi.getTasks() }.onSuccess { tasks = it }.onFailure { failed = true }
        }
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        TaskFilter.values().forEach { f ->
            val active = f == filter
            val shape = RoundedCornerShape(12.dp)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(shape)
                    .background(if (active) T2Colors.primarySoft else T2Colors.surface2)
                    .border(1.dp, if (active) T2Colors.primary else T2Colors.border, shape)
                    .clickable { filter = f }
                    .padding(10.dp),
                contentAlignment = Alignment.Center
            ) { Text(f.label, color = if (active) T2Colors.primary else T2Colors.text, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
        }
    }

    val list = tasks
    when {
        failed -> Text("Не удалось загрузить задачи", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        list == null -> CircularProgressIndicator()
        else -> {
            val items = list.filter(filter::matches)
            if (items.isEmpty()) Text("Нет задач", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                items.forEach { t -> TaskRow(t) { openId = t.id } }
            }
        }
    }

    val id = openId
    if (id != null) TaskDetail(tasksApi, id, myEmployeeId, canManageTask, onClose = { openId = null })
}

@Composable
private fun TaskRow(t: TaskListItem, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 0.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val shape = RoundedCornerShape(12.dp)
        Box(
            modifier = Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape),
            contentAlignment = Alignment.Center
        ) {
            val icon = when (t.status) { "done" -> Icons.Outlined.Check; "cancelled" -> Icons.Outlined.Block; else -> Icons.Outlined.Assignment }
            Icon(icon, contentDescription = null, tint = T2Colors.textSecondary, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1)
                PriorityBadge(t.priority)
            }
            val sub = listOfNotNull(
                t.assignee_name?.takeIf { it.isNotBlank() },
                t.store_name?.takeIf { it.isNotBlank() },
                STATUS_LABEL[t.status] ?: t.status
            ).joinToString(" · ")
            Text(sub, color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
        }
        Text("›", color = T2Colors.hint, fontSize = 18.sp)
    }
}

@Composable
private fun PriorityBadge(priority: String) {
    val (color, label) = when (priority) {
        "urgent" -> T2Colors.danger to "Срочно"
        "high" -> T2Colors.warning to "Высокий"
        "low" -> T2Colors.border to "Низкий"
        else -> return
    }
    Row(modifier = Modifier.padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(4.dp))
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Normal)
    }
}

@Composable
private fun TaskDetail(tasksApi: TasksApi, id: Int, myEmployeeId: Int?, canManageTask: Boolean, onClose: () -> Unit) {
    var detail by remember(id) { mutableStateOf<TaskDetailResponse?>(null) }
    var failed by remember(id) { mutableStateOf(false) }
    var reload by remember(id) { mutableStateOf(0) }
    var busy by remember(id) { mutableStateOf(false) }
    var comment by remember(id) { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    LaunchedEffect(id, reload) {
        runCatching { tasksApi.getTask(id) }.onSuccess { detail = it }.onFailure { failed = true }
    }

    fun act(errorText: String, block: suspend () -> Unit, okText: String? = null, after: () -> Unit = {}) {
        if (busy) return
        busy = true
        scope.launch {
            runCatching { block() }
                .onSuccess { okText?.let { T2Toast.show(it) }; after(); reload++ }
                .onFailure { T2Toast.show(errorText, true) }
            busy = false
        }
    }

    SheetDialog("Задача", onClose) {
        val d = detail
        when {
            failed -> Text("Не удалось загрузить задачу", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
            d == null -> CircularProgressIndicator()
            else -> {
                val t = d.task
                Text(t.title, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                val description = t.description
                if (!description.isNullOrBlank()) Text(description, fontSize = 14.sp, modifier = Modifier.padding(top = 2.dp))
                Spacer(Modifier.height(10.dp))
                val meta = listOfNotNull(
                    t.assignee_name?.takeIf { it.isNotBlank() },
                    t.store_name?.takeIf { it.isNotBlank() },
                    STATUS_LABEL[t.status] ?: t.status,
                    t.due_at?.let { "до ${ruDateTime(it)}" }
                ).joinToString(" · ")
                Text(meta, color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(bottom = 10.dp))

                val isAssignee = myEmployeeId != null && myEmployeeId == t.assigned_to
                val actions = buildList {
                    if (isAssignee && t.status == "open") add("in_progress" to "Взять в работу")
                    if (isAssignee && (t.status == "open" || t.status == "in_progress")) add("done" to "Отметить выполненной")
                    if (canManageTask && t.status != "cancelled") add("cancelled" to "Отменить")
                    if (canManageTask && (t.status == "done" || t.status == "cancelled")) add("open" to "Открыть заново")
                }
                if (actions.isNotEmpty()) {
                    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        actions.forEach { (status, label) ->
                            val shape = RoundedCornerShape(12.dp)
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape)
                                    .clickable(enabled = !busy) { act("Не удалось изменить статус", { tasksApi.changeStatus(id, status) }, "Статус обновлён") }
                                    .padding(10.dp),
                                contentAlignment = Alignment.Center
                            ) { Text(label, fontWeight = FontWeight.Bold, fontSize = 14.sp, textAlign = TextAlign.Center) }
                        }
                    }
                }

                FieldLabel("История")
                Column(modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
                    if (d.comments.isEmpty()) Text("Пока пусто", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp))
                    d.comments.forEach { c ->
                        Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                            Text("${c.author_name ?: "Система"} · ${ruDateTime(c.created_at)}", color = T2Colors.hint, fontSize = 12.sp)
                            Text(c.body, fontSize = 13.sp)
                        }
                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                    }
                }
                Spacer(Modifier.height(16.dp))
                Field("", comment, { comment = it }, placeholder = "Комментарий", fill = T2Colors.surface2)
                Spacer(Modifier.height(8.dp))
                MainButton("Добавить комментарий", enabled = !busy) {
                    val text = comment.trim()
                    if (text.isNotEmpty()) act("Не удалось отправить комментарий", { tasksApi.addComment(id, text) }, after = { comment = "" })
                }
            }
        }
    }
}
