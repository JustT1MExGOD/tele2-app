package ru.t2sales.desktop.ui.info

import ru.t2sales.desktop.ui.components.LoadingBlock
import ru.t2sales.desktop.ui.components.reveal
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import kotlinx.coroutines.launch
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.AlertItem
import ru.t2sales.shared.navigation.Screen
import ru.t2sales.shared.theme.T2Colors

private val STATUS = linkedMapOf("open" to "Новый", "acked" to "Принят", "in_progress" to "В работе", "resolved" to "Решён", "dismissed" to "Не актуален")
private val FILTERS = listOf("open", "in_progress", "resolved", "dismissed")

private fun ruDateTime(iso: String?): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm:ss"))
}.getOrDefault("")

/** Port of #page-alerts (pages/alerts): status filter chips, alert rows, detail modal with status transitions. */
@Composable
fun AlertsScreen(container: AppContainer, onNavigate: (Screen) -> Unit) {
    val api = container.alertsApi
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf("open") }
    var items by remember { mutableStateOf<List<AlertItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var opened by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(filter, reload) {
        failed = false
        runCatching { api.list(filter) }.onSuccess { items = it }.onFailure { failed = true }
    }

    Row(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FILTERS.forEach { s ->
            val active = s == filter
            val shape = RoundedCornerShape(12.dp)
            Box(
                modifier = Modifier.weight(1f).clip(shape).background(if (active) T2Colors.primarySoft else T2Colors.surface2)
                    .border(1.dp, if (active) T2Colors.primary else T2Colors.border, shape).clickable { filter = s; items = null }.padding(10.dp),
                contentAlignment = Alignment.Center
            ) { Text(STATUS[s] ?: s, color = if (active) T2Colors.primary else T2Colors.text, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
        }
    }

    val list = items
    when {
        failed -> Text("Не удалось загрузить алерты", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        list == null -> LoadingBlock()
        list.isEmpty() -> Text("Нет алертов", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        else -> Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
            list.forEachIndexed { idx, a ->
                Row(
                    modifier = Modifier.reveal(idx, 30).fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { opened = a.id; scope.launch { runCatching { api.markRead(a.id) } } }.padding(vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val shape = RoundedCornerShape(12.dp)
                    Box(Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), contentAlignment = Alignment.Center) {
                        Text(if (a.severity == "critical") "\uD83D\uDD34" else "\u26A0\uFE0F", fontSize = 18.sp)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(a.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Text((a.store_name ?: "") + " \u00B7 " + (STATUS[a.status] ?: a.status) + if (a.task_id != null) " \u00B7 есть задача" else "", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                    }
                    Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
                }
            }
        }
    }

    val id = opened
    if (id != null) {
        val a = items?.firstOrNull { it.id == id } ?: AlertItem(id = id, title = "Алерт", status = filter)
        AlertDetail(api, a, onDismiss = { opened = null }, onChanged = { reload++ }, onOpenTask = { opened = null; onNavigate(Screen.Tasks) })
    }
}

@Composable
private fun AlertDetail(api: ru.t2sales.shared.api.AlertsApi, a: AlertItem, onDismiss: () -> Unit, onChanged: () -> Unit, onOpenTask: () -> Unit) {
    val scope = rememberCoroutineScope()
    var status by remember(a.id) { mutableStateOf(a.status) }
    var busy by remember { mutableStateOf(false) }
    val next = buildList {
        if (status != "in_progress" && status != "resolved" && status != "dismissed") add("in_progress" to "Взять в работу")
        if (status != "resolved") add("resolved" to "Решено")
        if (status != "dismissed") add("dismissed" to "Не актуально")
    }
    SheetDialog("Алерт", onDismiss) {
        Text(a.title, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        a.body?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 14.sp, modifier = Modifier.padding(top = 2.dp)) }
        Text(
            (a.store_name ?: "") + " \u00B7 " + (STATUS[status] ?: status) + (a.created_at?.let { " \u00B7 " + ruDateTime(it) } ?: ""),
            color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp, bottom = 10.dp)
        )
        if (a.task_id != null) {
            Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onOpenTask).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Связанная задача", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Text(if (a.task_status == "done") "Выполнена" else "В работе", color = T2Colors.hint, fontSize = 13.sp)
                }
                Text("\u203A", color = T2Colors.hint, fontSize = 18.sp)
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            next.forEach { (s, label) ->
                val shape = RoundedCornerShape(12.dp)
                Box(
                    modifier = Modifier.weight(1f).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape)
                        .clickable(enabled = !busy) {
                            busy = true
                            scope.launch {
                                runCatching { api.changeStatus(a.id, s) }
                                    .onSuccess { T2Toast.show("Статус обновлён"); status = s; onChanged() }
                                    .onFailure { T2Toast.show("Не удалось изменить статус", true) }
                                busy = false
                            }
                        }.padding(10.dp),
                    contentAlignment = Alignment.Center
                ) { Text(label, fontWeight = FontWeight.Bold, fontSize = 14.sp, textAlign = TextAlign.Center) }
            }
        }
    }
}
