package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.text.input.KeyboardType
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
import androidx.compose.runtime.mutableStateOf as state
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.theme.T2Colors

private fun JsonElement?.o(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun JsonElement?.a(): List<JsonElement> = (this as? JsonArray) ?: emptyList()
private fun JsonElement?.d(): Double = (this as? JsonPrimitive)?.doubleOrNull ?: 0.0
private fun JsonElement?.s(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""

/** Shift lifecycle sheets (open -> brief, close, change store), shared by Home and Profile; the phone twin of the PC client's ShiftUi. */
object ShiftUi {
    var brief by mutableStateOf<JsonObject?>(null)
    var closing by mutableStateOf(false)
    var changeStore by mutableStateOf(false)

    fun open(container: AppContainer, scope: CoroutineScope, storeCode: String? = null, onDone: (Boolean) -> Unit = {}) {
        scope.launch {
            // no coordinates: like the PC client and the web's own fallback, the server accepts a shift without them
            runCatching { container.profileApi.openShift(storeCode) }
                .onSuccess { Toaster.show("Смена открыта"); brief = it; AppState.refreshTick++; onDone(true) }
                .onFailure { Toaster.show(it.message ?: "Не удалось открыть смену", true); onDone(false) }
        }
    }
}

@Composable
fun ShiftSheetHost(container: AppContainer) {
    val scope = rememberCoroutineScope()
    ShiftUi.brief?.let { Brief(it) { ShiftUi.brief = null } }
    if (ShiftUi.closing) CloseSheet(container, scope)
    if (ShiftUi.changeStore) ChangeStoreSheet(container, scope)
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(Modifier.padding(bottom = 12.dp).fillMaxWidth().clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(14.dp)) {
        Text(title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(bottom = 8.dp))
        content()
    }
}

@Composable
private fun Brief(data: JsonObject, onDismiss: () -> Unit) {
    val plan = data["day_plan"].o()
    val handover = data["handover"] as? JsonObject
    val tasks = data["open_tasks"].a()
    BottomSheet("Смена открыта", onDismiss = onDismiss, footer = { MainButton("Понятно", onClick = onDismiss) }) {
        Block("План на сегодня") {
            listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").forEach { (id, l) -> ProgressRow(l, 0.0, plan[id].d()) }
        }
        if (handover != null) Block("Передача от предыдущей смены") {
            Text(handover["handover_note"].s(), fontSize = 13.sp, lineHeight = 19.sp)
            val at = runCatching { OffsetDateTime.parse(handover["closed_at"].s()).atZoneSameInstant(ZoneId.of("Europe/Moscow")).format(DateTimeFormatter.ofPattern("HH:mm")) }.getOrDefault("")
            Text(handover["from_employee_name"].s() + if (at.isNotEmpty()) " · $at" else "", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
        }
        if (tasks.isNotEmpty()) Block("Открытые задачи (${tasks.size})") {
            tasks.forEach { Text("• ${it.o()["title"].s()}", fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}

@Composable
private fun CloseSheet(container: AppContainer, scope: CoroutineScope) {
    var report by remember { mutableStateOf("") }
    var mood by remember { mutableStateOf("4") }
    var handover by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    BottomSheet("Закрыть смену", busy, onDismiss = { ShiftUi.closing = false }, footer = {
        MainButton(if (busy) "Закрываем…" else "Закрыть смену", !busy, container = Color(0xFFE74C3C), content = Color.White) {
            busy = true
            val m = (mood.toIntOrNull() ?: 4).coerceIn(1, 5)
            scope.launch {
                runCatching { container.profileApi.closeShift(report, m, handover) }
                    .onSuccess { ShiftUi.closing = false; Toaster.show("Смена закрыта"); AppState.refreshTick++ }
                    .onFailure { Toaster.show(it.message ?: "Не удалось закрыть смену", true); busy = false }
            }
        }
    }) {
        Field("Самоотчёт (что зашло / что мешало)", report, { report = it })
        Spacer(Modifier.height(14.dp))
        Field("Настроение 1–5", mood, { v -> mood = v.filter { it.isDigit() }.take(1) }, keyboard = KeyboardType.Number)
        Spacer(Modifier.height(14.dp))
        Field("Заметка для следующей смены (необязательно)", handover, { handover = it })
    }
}

@Composable
private fun ChangeStoreSheet(container: AppContainer, scope: CoroutineScope) {
    var code by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var store by remember { mutableStateOf<JsonObject?>(null) }
    var replacement by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    BottomSheet("Сменить точку", busy, onDismiss = { ShiftUi.changeStore = false }, footer = {
        val st = store
        if (st != null) {
            MainButton(if (busy) "Открываем…" else "Продолжить", !busy) {
                busy = true
                ShiftUi.open(container, scope, st["code"].s()) { ok -> busy = false; if (ok) ShiftUi.changeStore = false else error = "Не удалось открыть смену" }
            }
        } else {
            MainButton("Проверить", code.isNotBlank()) {
                status = "Проверяем…"; error = null
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
    }) {
        Field("Код точки", code, { v -> code = v.filter { it.isDigit() }; store = null; error = null }, keyboard = KeyboardType.Number)
        Spacer(Modifier.height(10.dp))
        status?.let { Text(it, fontSize = 13.sp, color = T2Colors.hint) }
        error?.let { Text(it, fontSize = 13.sp, color = Color(0xFFE74C3C)) }
        store?.let { st ->
            Text("${st["code"].s()} — ${st["display_name"].s().ifEmpty { st["name"].s() }}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            st["address"].s().takeIf { it.isNotEmpty() }?.let { Text(it, color = T2Colors.hint, fontSize = 12.sp) }
            if (replacement) Text("Вы войдёте в режиме замены.", fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp).clip(RoundedCornerShape(8.dp)).background(T2Colors.surface2).padding(8.dp).fillMaxWidth())
        }
    }
}
