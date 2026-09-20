package ru.t2sales.desktop.ui.shift

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.home.ProgressRow
import ru.t2sales.desktop.ui.sales.AddSaleState
import ru.t2sales.shared.theme.T2Colors

private fun JsonElement?.o(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun JsonElement?.a(): List<JsonElement> = (this as? JsonArray) ?: emptyList()
private fun JsonElement?.d(): Double = (this as? JsonPrimitive)?.doubleOrNull ?: 0.0
private fun JsonElement?.s(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""
private fun n(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()

/** Shift lifecycle UI shared by Home ("Сменить точку") and Profile («Смена»): open, close, brief and result dialogs. */
object ShiftUi {
    var brief by mutableStateOf<JsonObject?>(null)
    var result by mutableStateOf<JsonObject?>(null)
    var closing by mutableStateOf(false)
    var changeStore by mutableStateOf(false)

    fun open(container: AppContainer, scope: CoroutineScope, storeCode: String? = null, onDone: (Boolean) -> Unit = {}) {
        scope.launch {
            runCatching { container.profileApi.openShift(storeCode) }
                .onSuccess { T2Toast.show("Смена открыта"); brief = it; AddSaleState.refreshTick++; onDone(true) }
                .onFailure { T2Toast.show(it.message ?: "Не удалось открыть смену", true); onDone(false) }
        }
    }
}

@Composable
fun ShiftDialogHost(container: AppContainer) {
    val scope = rememberCoroutineScope()
    ShiftUi.brief?.let { Brief(it) { ShiftUi.brief = null } }
    ShiftUi.result?.let { ShiftResultCard(it, container) { ShiftUi.result = null } }
    if (ShiftUi.closing) CloseDialog(container, scope)
    if (ShiftUi.changeStore) ChangeStoreDialog(container, scope)
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(modifier = Modifier.padding(bottom = 12.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(14.dp)) {
        Text(title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(bottom = 8.dp))
        content()
    }
}

@Composable
private fun Brief(data: JsonObject, onDismiss: () -> Unit) {
    val plan = data["day_plan"].o()
    val handover = data["handover"] as? JsonObject
    val tasks = data["open_tasks"].a()
    SheetDialog("Смена открыта", onDismiss) {
        Block("План на сегодня") {
            listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").forEach { (id, l) -> ProgressRow(l, 0.0, plan[id].d()) }
        }
        if (handover != null) Block("Передача от предыдущей смены") {
            Text(handover["handover_note"].s(), fontSize = 13.sp, lineHeight = 19.sp)
            val at = runCatching { OffsetDateTime.parse(handover["closed_at"].s()).atZoneSameInstant(ZoneId.of("Europe/Moscow")).format(DateTimeFormatter.ofPattern("HH:mm")) }.getOrDefault("")
            Text(handover["from_employee_name"].s() + if (at.isNotEmpty()) " \u00B7 $at" else "", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        }
        if (tasks.isNotEmpty()) Block("Открытые задачи (${tasks.size})") {
            tasks.forEach { Text("\u2022 ${it.o()["title"].s()}", fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
        }
        Spacer(Modifier.height(4.dp))
        MainButton("Понятно", enabled = true, onClick = onDismiss)
    }
}

@Composable
private fun CloseDialog(container: AppContainer, scope: CoroutineScope) {
    var report by remember { mutableStateOf("") }
    var mood by remember { mutableStateOf("4") }
    var handover by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    SheetDialog("Закрыть смену", onDismiss = { if (!busy) ShiftUi.closing = false }) {
        Field("Самоотчёт (что зашло / что мешало)", report, { report = it }, placeholder = "Кратко\u2026", fill = T2Colors.surface2)
        Spacer(Modifier.height(14.dp))
        Field("Настроение 1\u20135", mood, { v -> mood = v.filter { it.isDigit() }.take(1) }, fill = T2Colors.surface2)
        Spacer(Modifier.height(14.dp))
        Field("Заметка для следующей смены (необязательно)", handover, { handover = it }, placeholder = "Что важно знать тому, кто откроет смену следующим на этой точке\u2026", fill = T2Colors.surface2)
        Spacer(Modifier.height(16.dp))
        MainButton(if (busy) "Закрываем\u2026" else "Закрыть смену", enabled = !busy, container = Color(0xFFE74C3C), content = Color.White) {
            busy = true
            val m = (mood.toIntOrNull() ?: 4).coerceIn(1, 5)
            scope.launch {
                runCatching { container.profileApi.closeShift(report, m, handover) }
                    .onSuccess { ShiftUi.closing = false; ShiftUi.result = it; AddSaleState.refreshTick++ }
                    .onFailure { T2Toast.show(it.message ?: "Не удалось закрыть смену", true); busy = false }
            }
        }
    }
}

@Composable
private fun ChangeStoreDialog(container: AppContainer, scope: CoroutineScope) {
    var code by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var store by remember { mutableStateOf<JsonObject?>(null) }
    var replacement by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    SheetDialog("Сменить точку", onDismiss = { ShiftUi.changeStore = false }) {
        Field("Код точки", code, { v -> code = v.filter { it.isDigit() }; store = null; error = null }, placeholder = "888967", fill = T2Colors.surface2)
        Spacer(Modifier.height(10.dp))
        status?.let { Text(it, fontSize = 13.sp, color = T2Colors.hint) }
        error?.let { Text(it, fontSize = 13.sp, color = Color(0xFFE74C3C)) }
        store?.let { st ->
            Text("${st["code"].s()} \u2014 ${st["display_name"].s().ifEmpty { st["name"].s() }}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            st["address"].s().takeIf { it.isNotEmpty() }?.let { Text(it, color = T2Colors.hint, fontSize = 12.sp) }
            if (replacement) Text("Вы войдёте в режиме замены.", fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp).clip(RoundedCornerShape(8.dp)).background(T2Colors.surface2).padding(8.dp).fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            MainButton(if (busy) "Открываем\u2026" else "Продолжить", enabled = !busy) {
                busy = true
                ShiftUi.open(container, scope, st["code"].s()) { ok -> busy = false; if (ok) ShiftUi.changeStore = false else error = "Не удалось открыть смену" }
            }
        }
        if (store == null) {
            Spacer(Modifier.height(6.dp))
            MainButton("Проверить", enabled = code.isNotBlank()) {
                status = "Проверяем\u2026"; error = null
                scope.launch {
                    runCatching { container.profileApi.resolveStore(code.trim()) }
                        .onSuccess { r ->
                            status = null
                            val allowed = (r["allowed"] as? JsonPrimitive)?.content == "true"
                            if (!allowed || r["store"] !is JsonObject) error = r["message"].s().ifEmpty { "Точка недоступна" }
                            else { store = r["store"].o(); replacement = r["mode"].s() == "REPLACEMENT" }
                        }
                        .onFailure { status = null; error = it.message ?: "Ошибка проверки" }
                }
            }
        }
    }
}
