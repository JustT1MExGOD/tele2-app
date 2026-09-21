package ru.t2sales.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.theme.T2Colors

/** Base metrics are protected from deletion on the backend too (DELETE /metrics/:id); the list only hides a useless button. */
private val LOCKED_METRICS = setOf(
    "sim", "mnp", "pa", "combo", "phones", "accessories", "settings",
    "insurance", "wink", "shpd", "focus", "credit_request", "credit_issued",
    "plotter", "hb", "credit"
)

/** Port of openAddMetric / saveMetric / deleteMetric (pages/cash-metrics): «Метрики плана». */
@Composable
fun MetricsDialog(salesApi: SalesApi, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<MetricDef>?>(null) }
    var reload by remember { mutableStateOf(0) }
    var label by remember { mutableStateOf("") }
    var short by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("Количество") }
    var busy by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<MetricDef?>(null) }

    LaunchedEffect(reload) {
        runCatching { salesApi.getMetrics().items }.onSuccess { items = it }.onFailure { items = emptyList() }
    }

    SheetDialog("Метрики плана", onDismiss) {
        val custom = items.orEmpty().filter { it.id !in LOCKED_METRICS }
        if (custom.isNotEmpty()) {
            Text("СВОИ МЕТРИКИ", color = T2Colors.hint, fontWeight = FontWeight.ExtraBold, fontSize = 11.sp, letterSpacing = 0.4.sp, modifier = Modifier.padding(bottom = 8.dp))
            custom.forEach { m ->
                Row(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("${m.label ?: m.id} (${m.id})", fontSize = 14.sp, modifier = Modifier.weight(1f))
                    MChipButton("Удалить", danger = true) { deleting = m }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        Text("НОВАЯ МЕТРИКА", color = T2Colors.hint, fontWeight = FontWeight.ExtraBold, fontSize = 11.sp, letterSpacing = 0.4.sp, modifier = Modifier.padding(bottom = 8.dp))
        Field("Название", label, { label = it }, placeholder = "Например: eSIM", fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        Field("Короткое", short, { short = it }, placeholder = "eSIM", fill = T2Colors.surface2)
        Spacer(Modifier.height(12.dp))
        SelectField("Тип", unit, listOf("Количество", "Деньги")) { unit = it }
        Spacer(Modifier.height(16.dp))
        MainButton(if (busy) "Создаём…" else "Создать", enabled = !busy) {
            val l = label.trim()
            if (l.isEmpty()) { T2Toast.show("Укажи название", true); return@MainButton }
            busy = true
            scope.launch {
                runCatching { salesApi.createMetric(l, short.trim().ifEmpty { l.take(8) }, if (unit == "Деньги") "money" else "count") }
                    .onSuccess { r ->
                        val name = ((r["item"] as? JsonObject)?.get("label") as? JsonPrimitive)?.content ?: l
                        T2Toast.show("Метрика «$name» добавлена")
                        onDismiss()
                    }
                    .onFailure { T2Toast.show(it.message ?: "Ошибка", true); busy = false }
            }
        }
    }

    deleting?.let { m ->
        ConfirmDialog(
            "Удалить метрику", "Удалить метрику «${m.label ?: m.id}»? Она перестанет показываться в формах — уже внесённые по ней данные останутся в базе.", "Удалить",
            onDismiss = { deleting = null }
        ) {
            deleting = null
            scope.launch {
                runCatching { salesApi.deleteMetric(m.id) }
                    .onSuccess { T2Toast.show("Метрика удалена"); reload++ }
                    .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
            }
        }
    }
}
