package ru.t2sales.desktop.ui.bfq

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
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.SheetDialog
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.home.ProgressRow
import ru.t2sales.shared.api.BfqItem
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private fun JsonElement?.d(): Double? = (this as? JsonPrimitive)?.doubleOrNull
private fun JsonElement?.o(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun num(v: Double?): String = v?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "\u2014"

/** Port of #page-bfq / pages/plans-bfq loadBFQ + openBFQCard: monthly ranking, card with blocks and manual VMR/penalty. */
@Composable
fun BfqScreen(container: AppContainer, me: MeResponse) {
    val canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true
    val api = container.profileApi
    val month = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString().take(7) }
    var items by remember { mutableStateOf<List<BfqItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    var opened by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(reload) { runCatching { api.getBfq(month).items }.onSuccess { items = it }.onFailure { failed = true } }

    PageSection("BFQ за месяц") {
        val list = items
        when {
            failed -> Text("Ошибка BFQ", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            list == null -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            list.isEmpty() -> Text("Нет данных BFQ", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            else -> list.forEachIndexed { i, e ->
                Row(modifier = Modifier.fillMaxWidth().clickable { opened = e.employee_id }.padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                    val shape = RoundedCornerShape(T2Radius.sm)
                    Box(Modifier.size(42.dp).clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape), contentAlignment = Alignment.Center) {
                        Text((i + 1).toString(), color = T2Colors.textSecondary, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(e.full_name ?: "", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        Text("Кач. ${num(e.quality)} \u00B7 Приб. ${num(e.profit)} \u00B7 VMR ${num(e.vmr ?: 0.0)}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                    }
                    Text(num(e.total), fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                    Text("\u203A", color = T2Colors.hint, fontSize = 18.sp, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
    }

    val id = opened
    if (id != null) BfqCard(container, id, month, canManage, onDismiss = { opened = null }, onSaved = { opened = null; reload++ })
}

@Composable
private fun BfqCard(container: AppContainer, id: Int, month: String, canManage: Boolean, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<JsonObject?>(null) }
    var failed by remember { mutableStateOf(false) }
    var vmr by remember { mutableStateOf("") }
    var penalty by remember { mutableStateOf("") }

    LaunchedEffect(id) {
        runCatching { container.salesApi.getBfqEmployee(id, month) }
            .onSuccess { data = it; vmr = num(it["fact"].o()["vmr"].d() ?: 0.0).replace("\u2014", "0"); penalty = num(it["fact"].o()["penalty"].d() ?: 0.0).replace("\u2014", "0") }
            .onFailure { failed = true }
    }

    SheetDialog("BFQ", onDismiss) {
        val d = data
        when {
            failed -> Text("Ошибка", color = T2Colors.hint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
            d == null -> CircularProgressIndicator()
            else -> {
                val f = d["fact"].o()
                val fc = d["forecast"].o()
                val blocks = f["blocks"].o()
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Chip(num(f["total"].d()), "Факт", Modifier.weight(1f))
                    Chip(num(fc["total"].d()), "Прогноз", Modifier.weight(1f))
                    Chip(num(f["quality"].d()), "Качество", Modifier.weight(1f))
                }
                Spacer(Modifier.height(12.dp))
                ProgressRow("GI", blocks["gi"].d() ?: 0.0, 50.0)
                ProgressRow("VMR блок", blocks["vmr"].d() ?: 0.0, 12.0)
                ProgressRow("Digital", blocks["digital"].d() ?: 0.0, 25.0)
                ProgressRow("Top-up", blocks["topUp"].d() ?: 0.0, 15.0)
                ProgressRow("Прибыль", f["profit"].d() ?: 0.0, 20.0)
                val shifts = d["shifts"].o()
                Text(
                    "Смены: ${(shifts["worked"].d() ?: 0.0).toInt()} отработано \u00B7 ${(shifts["remaining"].d() ?: 0.0).toInt()} осталось",
                    color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
                )
                if (canManage) {
                    Field("VMR средний", vmr, { v -> vmr = v.filter { it.isDigit() || it == '.' || it == '-' } }, fill = T2Colors.surface2)
                    Spacer(Modifier.height(14.dp))
                    Field("Штраф", penalty, { v -> penalty = v.filter { it.isDigit() || it == '.' || it == '-' } }, fill = T2Colors.surface2)
                    Spacer(Modifier.height(12.dp))
                    MainButton("Сохранить VMR / штраф", enabled = true) {
                        scope.launch {
                            runCatching { container.salesApi.saveBfqManual(id, month, vmr.toDoubleOrNull() ?: 0.0, penalty.toDoubleOrNull() ?: 0.0) }
                                .onSuccess { T2Toast.show("Сохранено"); onSaved() }
                                .onFailure { T2Toast.show("Нет прав или ошибка", true) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Chip(value: String, label: String, modifier: Modifier) {
    val shape = RoundedCornerShape(T2Radius.sm)
    Column(
        modifier = modifier.clip(shape).background(T2Colors.surface2).border(1.dp, T2Colors.border, shape).padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Black)
        Text(label.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp, modifier = Modifier.padding(top = 3.dp))
    }
}
