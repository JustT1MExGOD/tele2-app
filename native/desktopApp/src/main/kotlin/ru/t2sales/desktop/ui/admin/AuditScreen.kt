package ru.t2sales.desktop.ui.admin

import ru.t2sales.desktop.ui.components.LoadingBlock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.FieldLabel
import ru.t2sales.desktop.ui.components.MChipButton
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.SelectField
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.AdminApi
import ru.t2sales.shared.api.AuditItem
import ru.t2sales.shared.theme.T2Colors

private val ACTION_LABEL = linkedMapOf(
    "employee.role_change" to "Смена роли",
    "employee.deactivate" to "Изменение статуса сотрудника",
    "sales.correction" to "Правка продажи",
    "plan.update" to "Изменение плана",
    "export.csv" to "Экспорт CSV"
)
private val TARGET_LABEL = linkedMapOf(
    "employee" to "Сотрудник",
    "employee_plan" to "План сотрудника",
    "store_plan" to "План точки",
    "sale" to "Продажа",
    "export" to "Экспорт"
)
private const val LIMIT = 50
private const val ALL_ACTIONS = "Все действия"
private const val ALL_TARGETS = "Все объекты"

private enum class AuditSort { Date, Action, Actor, Target }

private val PRETTY = Json { prettyPrint = true }

private fun ruDateTime(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("dd.MM.yyyy, HH:mm:ss"))
}.getOrDefault(iso)

private fun pretty(el: JsonElement?): String = if (el == null || el is JsonNull) "\u2014" else PRETTY.encodeToString(JsonElement.serializer(), el)

/** Port of the «История действий» page: filters, sortable table, load-more, diff dialog. */
@Composable
fun AuditScreen(api: AdminApi) {
    val scope = rememberCoroutineScope()
    val items = remember { mutableStateListOf<AuditItem>() }
    var loaded by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var action by remember { mutableStateOf(ALL_ACTIONS) }
    var target by remember { mutableStateOf(ALL_TARGETS) }
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var offset by remember { mutableStateOf(0) }
    var more by remember { mutableStateOf(false) }
    var sort by remember { mutableStateOf(AuditSort.Date) }
    var asc by remember { mutableStateOf(false) }
    var opened by remember { mutableStateOf<AuditItem?>(null) }
    var reload by remember { mutableStateOf(0) }

    fun fetch(append: Boolean) {
        scope.launch {
            val a = ACTION_LABEL.entries.firstOrNull { it.value == action }?.key
            val t = TARGET_LABEL.entries.firstOrNull { it.value == target }?.key
            runCatching { api.getAudit(a, t, from.ifBlank { null }, to.ifBlank { null }, LIMIT, offset) }
                .onSuccess { r ->
                    if (!append) items.clear()
                    items.addAll(r.items)
                    more = r.items.size == LIMIT
                    failed = false
                }
                .onFailure {
                    if (!append) failed = true
                    T2Toast.show("Не получилось загрузить историю", true)
                }
            loaded = true
        }
    }

    LaunchedEffect(reload, action, target, from, to) {
        offset = 0
        loaded = false
        fetch(false)
    }

    PageSection("История действий") {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            Box(Modifier.weight(1f)) { SelectField("", action, listOf(ALL_ACTIONS) + ACTION_LABEL.values) { action = it } }
            Box(Modifier.weight(1f)) { SelectField("", target, listOf(ALL_TARGETS) + TARGET_LABEL.values) { target = it } }
            Box(Modifier.weight(1f)) { Field("", from, { from = it }, placeholder = "С даты ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
            Box(Modifier.weight(1f)) { Field("", to, { to = it }, placeholder = "По дату ГГГГ-ММ-ДД", fill = T2Colors.surface2) }
        }
        when {
            failed -> Text("\uD83C\uDF49 Не получилось загрузить историю", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            !loaded -> LoadingBlock(Modifier.padding(16.dp))
            items.isEmpty() -> Text("\uD83C\uDF49 Действий пока нет", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> {
                val sorted = items.sortedWith { a, b ->
                    val c = when (sort) {
                        AuditSort.Date -> a.created_at.compareTo(b.created_at)
                        AuditSort.Action -> (ACTION_LABEL[a.action] ?: a.action).compareTo(ACTION_LABEL[b.action] ?: b.action, true)
                        AuditSort.Actor -> (a.actor_name ?: "").compareTo(b.actor_name ?: "", true)
                        AuditSort.Target -> a.target_type.compareTo(b.target_type, true)
                    }
                    if (asc) c else -c
                }
                fun sortBy(k: AuditSort) { if (sort == k) asc = !asc else { sort = k; asc = true } }
                Row(modifier = Modifier.fillMaxWidth().background(T2Colors.surface2).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Header("Дата", AuditSort.Date, sort, asc, Modifier.weight(2f), ::sortBy)
                    Header("Действие", AuditSort.Action, sort, asc, Modifier.weight(2.5f), ::sortBy)
                    Header("Актор", AuditSort.Actor, sort, asc, Modifier.weight(2f), ::sortBy)
                    Header("Объект", AuditSort.Target, sort, asc, Modifier.weight(2f), ::sortBy)
                }
                sorted.forEach { i ->
                    Row(modifier = Modifier.fillMaxWidth().clickable { opened = i }.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(ruDateTime(i.created_at), fontSize = 13.sp, modifier = Modifier.weight(2f))
                        Text(ACTION_LABEL[i.action] ?: i.action, fontSize = 13.sp, modifier = Modifier.weight(2.5f))
                        Text(i.actor_name ?: "Система", fontSize = 13.sp, modifier = Modifier.weight(2f))
                        Text((TARGET_LABEL[i.target_type] ?: i.target_type) + (i.target_id?.let { " #$it" } ?: ""), fontSize = 13.sp, modifier = Modifier.weight(2f))
                    }
                    Box(Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                }
            }
        }
        if (more) {
            Box(modifier = Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                Text(
                    "Показать ещё", fontWeight = FontWeight.Bold, fontSize = 13.sp,
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { offset += LIMIT; fetch(true) }.padding(horizontal = 16.dp, vertical = 12.dp)
                )
            }
        }
    }

    val item = opened
    if (item != null) {
        SheetDialog(ACTION_LABEL[item.action] ?: item.action, onDismiss = { opened = null }) {
            Text(
                "${item.actor_name ?: "Система"} \u00B7 ${TARGET_LABEL[item.target_type] ?: item.target_type}${item.target_id?.let { " #$it" } ?: ""} \u00B7 ${ruDateTime(item.created_at)}",
                color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp)
            )
            FieldLabel("До")
            DiffBox(pretty(item.before))
            Spacer(Modifier.height(14.dp))
            FieldLabel("После")
            DiffBox(pretty(item.after))
        }
    }
}

@Composable
private fun DiffBox(text: String) {
    Text(
        text, fontFamily = FontFamily.Monospace, fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(T2Colors.surface2).padding(10.dp)
    )
}

@Composable
private fun Header(label: String, key: AuditSort, cur: AuditSort, asc: Boolean, modifier: Modifier, onSort: (AuditSort) -> Unit) {
    val arrow = if (key == cur) (if (asc) "\u2191" else "\u2193") else "\u21C5"
    Text("$label $arrow", color = if (key == cur) T2Colors.primary else T2Colors.hint, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = modifier.clickable { onSort(key) })
}
