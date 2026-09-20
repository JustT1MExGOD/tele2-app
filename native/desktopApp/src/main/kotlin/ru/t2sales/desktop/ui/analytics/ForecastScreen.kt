package ru.t2sales.desktop.ui.analytics

import ru.t2sales.desktop.ui.components.LoadingBlock
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import ru.t2sales.desktop.ui.components.MChipButton
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.PageSection
import ru.t2sales.desktop.ui.components.SelectField
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.desktop.ui.shell.AppNav
import ru.t2sales.desktop.ui.supervisor.BarRow
import ru.t2sales.desktop.ui.supervisor.ExtraToggle
import ru.t2sales.shared.api.MeResponse
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.StoreInfo
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Radius

private class Move(val emp: Int, val from: String?, val to: String)
private class WiResult(val data: JsonObject, val date: String, val moves: List<Move>)

private val FALLBACK = listOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо", "phones" to "Телефоны", "accessories" to "Аксессуары",
    "settings" to "Настройки", "insurance" to "Страховки", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО",
    "credit_request" to "Кредит заявка", "credit_issued" to "Кредит выдан", "plotter" to "Плоттер", "hb" to "НВ"
)

/** Port of #page-forecast: 7-day forecast, staffing hints (managers), what-if scenario builder with A/B comparison. */
@Composable
fun ForecastScreen(container: AppContainer, me: MeResponse) {
    val canManage = me.role == "manager" || me.role == "admin" || me.is_manager == true
    val api = container.analyticsApi
    val scope = rememberCoroutineScope()
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() }
    var stores by remember { mutableStateOf<List<StoreInfo>>(emptyList()) }
    var fcStore by remember { mutableStateOf<String?>(null) }
    var metrics by remember { mutableStateOf(FALLBACK) }
    var forecast by remember { mutableStateOf<JsonObject?>(null) }
    var fcFailed by remember { mutableStateOf(false) }
    var hints by remember { mutableStateOf<List<JsonObject>?>(null) }

    var wiEmp by remember { mutableStateOf("") }
    var wiFrom by remember { mutableStateOf<String?>(null) }
    var wiTo by remember { mutableStateOf<String?>(null) }
    var wiDate by remember { mutableStateOf(today) }
    val moves = remember { mutableStateListOf<Move>() }
    var wiBusy by remember { mutableStateOf(false) }
    var wiMessage by remember { mutableStateOf<String?>(null) }
    var last by remember { mutableStateOf<WiResult?>(null) }
    var scenarioA by remember { mutableStateOf<WiResult?>(null) }

    LaunchedEffect(Unit) {
        runCatching { container.scheduleApi.getOrgStores().stores }.onSuccess {
            stores = it
            fcStore = fcStore ?: it.firstOrNull()?.id
            wiFrom = wiFrom ?: it.firstOrNull()?.id
            wiTo = wiTo ?: it.firstOrNull()?.id
        }
        runCatching { container.salesApi.getMetrics().items }.onSuccess { m -> if (m.isNotEmpty()) metrics = m.map { it.id to (it.label ?: it.id) } }
        if (canManage) runCatching { api.staffingHints() }.onSuccess { d -> hints = d["items"].arr().map { it.obj() } }.onFailure { hints = null }
    }
    // «Предложить перенос»
    LaunchedEffect(AppNav.whatIfToStore) {
        AppNav.whatIfToStore?.let { wiTo = it; AppNav.whatIfDate?.let { d -> wiDate = d }; T2Toast.show("Точка выбрана \u2014 укажи сотрудника и «с точки»"); AppNav.whatIfToStore = null }
    }
    LaunchedEffect(fcStore) {
        val sid = fcStore ?: return@LaunchedEffect
        forecast = null; fcFailed = false
        runCatching { api.forecast(sid) }.onSuccess { forecast = it }.onFailure { fcFailed = true }
    }

    // ---------------- Forecast
    PageSection("Прогноз 7 дней") {
        Box(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
            SelectField("Точка", stores.firstOrNull { it.id == fcStore }?.name ?: "", stores.map { it.name }) { n -> stores.firstOrNull { it.name == n }?.let { fcStore = it.id } }
        }
        val d = forecast
        when {
            fcFailed -> Text("\uD83C\uDF49 Прогноз сейчас недоступен, зайди чуть позже", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
            d == null -> LoadingBlock(Modifier.padding(16.dp))
            else -> {
                val hist = d["history_days"].dbl().toInt()
                val items = d["items"].arr().map { it.obj() }
                Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (hist < 14) Text("\uD83C\uDF49 Пока только $hist дн. истории \u2014 прогноз грубый, будет точнее по мере накопления данных", color = T2Colors.hint, fontSize = 13.sp)
                    if (items.isEmpty()) {
                        Text("\uD83C\uDF49 Пока нет истории для прогноза по этой точке", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                    } else {
                        val totals = items.map { it["predicted"].obj().let { p -> p["sim"].dbl() + p["mnp"].dbl() + p["pa"].dbl() + p["combo"].dbl() } }
                        val totalMax = max(1.0, totals.maxOrNull() ?: 1.0)
                        Card {
                            Text("ФОРМА НЕДЕЛИ, ЮНИТЫ В ДЕНЬ", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp, modifier = Modifier.padding(bottom = 8.dp))
                            Row(modifier = Modifier.fillMaxWidth().height(50.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
                                totals.forEach { t -> Box(Modifier.weight(1f).height(max(4.0, t / totalMax * 50.0).dp).clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp)).background(T2Colors.primarySoft)) }
                            }
                        }
                        d["ai_summary"].str().takeIf { it.isNotEmpty() }?.let { ai -> Card { Text("\u2728 $ai", fontSize = 13.sp, lineHeight = 19.sp) } }
                        items.forEach { it -> DayCard(it, metrics) }
                    }
                }
            }
        }
    }

    // ---------------- Staffing hints
    if (canManage && hints != null) {
        Spacer(Modifier.height(12.dp))
        PageSection("Кого куда поставить \u00B7 неделя вперёд") {
            val list = hints.orEmpty()
            Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (list.isEmpty()) Text("\uD83C\uDF49 На неделю вперёд перекосов не видно \u2014 график и прогноз сходятся", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(16.dp))
                list.forEach { h ->
                    val warn = h["severity"].str() != "critical"
                    val c = if (warn) Color(0xFFFF9F0A) else Color(0xFFFF453A)
                    val shape = RoundedCornerShape(16.dp)
                    Row(
                        modifier = Modifier.fillMaxWidth().clip(shape).background(Brush.linearGradient(listOf(c.copy(alpha = 0.12f), c.copy(alpha = 0.04f)))).border(1.dp, c.copy(alpha = 0.28f), shape).padding(horizontal = 14.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(if (warn) "\u26A0\uFE0F" else "\uD83D\uDD34", fontSize = 18.sp)
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${h["store_name"].str()} \u00B7 ${h["date"].str()}", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text(h["message"].str(), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
                            MChipButton("Предложить перенос", modifier = Modifier.padding(top = 6.dp)) { wiTo = h["store_id"].str(); wiDate = h["date"].str(); T2Toast.show("Точка выбрана \u2014 укажи сотрудника и «с точки»") }
                        }
                    }
                }
            }
        }
    }

    // ---------------- What-if
    Spacer(Modifier.height(12.dp))
    PageSection("What-if: сценарий переносов") {
        Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Field("Сотрудник id", wiEmp, { v -> wiEmp = v.filter { it.isDigit() } }, placeholder = "2", fill = T2Colors.surface2)
            SelectField("С точки", stores.firstOrNull { it.id == wiFrom }?.name ?: "", stores.map { it.name }) { n -> stores.firstOrNull { it.name == n }?.let { wiFrom = it.id } }
            SelectField("На точку", stores.firstOrNull { it.id == wiTo }?.name ?: "", stores.map { it.name }) { n -> stores.firstOrNull { it.name == n }?.let { wiTo = it.id } }
            Field("Дата", wiDate, { wiDate = it }, placeholder = "ГГГГ-ММ-ДД", fill = T2Colors.surface2)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) {
                    MChipButton("+ Добавить перенос", modifier = Modifier.fillMaxWidth()) {
                        val e = wiEmp.toIntOrNull(); val to = wiTo
                        if (e == null || to == null) { T2Toast.show("Укажи сотрудника и точку назначения", true) } else { moves.add(Move(e, wiFrom, to)); wiEmp = "" }
                    }
                }
                Box(Modifier.weight(1f)) { MChipButton("Очистить сценарий", modifier = Modifier.fillMaxWidth()) { moves.clear() } }
            }
            moves.forEachIndexed { i, m ->
                Row(
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(T2Colors.surface2).padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("#${m.emp}: ${m.from ?: "авто"} \u2192 ${m.to}", fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text("\u00D7", color = T2Colors.danger, fontSize = 16.sp, modifier = Modifier.clickable { moves.removeAt(i) }.padding(4.dp))
                }
            }
            MainButton(if (wiBusy) "Считаем\u2026" else "Пересчитать покрытие", enabled = !wiBusy) {
                var use = moves.toList()
                if (use.isEmpty()) {
                    val e = wiEmp.toIntOrNull(); val to = wiTo
                    if (e != null && to != null) use = listOf(Move(e, wiFrom, to))
                }
                if (use.isEmpty()) { wiMessage = "Добавь хотя бы один перенос в сценарий"; return@MainButton }
                wiBusy = true; wiMessage = null
                scope.launch {
                    runCatching { api.whatIf(body(wiDate, use)) }
                        .onSuccess { r -> last = WiResult(r, r["date"].str().ifEmpty { wiDate }, use); if (scenarioA != null) wiMessage = null }
                        .onFailure { wiMessage = it.message ?: "Ошибка" }
                    wiBusy = false
                }
            }
            wiMessage?.let { Text(it, color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }

            last?.let { r ->
                Scenario(r, canManage,
                    onApply = {
                        scope.launch {
                            runCatching { api.applyWhatIf(body(r.date, r.moves)) }
                                .onSuccess { T2Toast.show("График обновлён: ${it["count"].dbl().toInt()} смен") }
                                .onFailure { T2Toast.show(it.message ?: "Не удалось применить", true) }
                        }
                    },
                    onSaveA = { scenarioA = r; T2Toast.show("Сценарий A сохранён") }
                )
            }
            val a = scenarioA
            val b = last
            if (a != null && b != null) Compare(a, b) { scenarioA = null }
            else if (a != null) Text("Сценарий A сохранён (${a.moves.size} перенос(ов)). Собери другой набор переносов и пересчитай \u2014 появится сравнение.", color = T2Colors.hint, fontSize = 12.sp)
        }
    }
}

private fun body(date: String, moves: List<Move>): JsonObject = buildJsonObject {
    put("date", JsonPrimitive(date))
    put("moves", buildJsonArray {
        moves.forEach { m ->
            add(buildJsonObject {
                put("employee_id", JsonPrimitive(m.emp))
                put("from_store", m.from?.let { JsonPrimitive(it) } ?: JsonNull)
                put("to_store", JsonPrimitive(m.to))
            })
        }
    })
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(14.dp)) { content() }
}

@Composable
private fun DayCard(it: JsonObject, metrics: List<Pair<String, String>>) {
    val p = it["predicted"].obj(); val lo = it["predicted_low"].obj(); val hi = it["predicted_high"].obj()
    fun n(v: Double) = v.roundToInt()
    fun range(k: String): String { val l = n(lo[k].dbl()); val h = n(hi[k].dbl()); return if (h > l) "$l\u2013$h" else "" }
    Card {
        Text(it["date"].str(), fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.padding(bottom = 10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            listOf("sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо").forEach { (k, l) ->
                val shape = RoundedCornerShape(12.dp)
                Column(modifier = Modifier.weight(1f).clip(shape).background(T2Colors.surface2).padding(horizontal = 8.dp, vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(n(p[k].dbl()).toString(), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                    Text(l.uppercase(), color = T2Colors.hint, fontSize = 10.sp)
                    val r = range(k)
                    if (r.isNotEmpty()) Text(r, color = T2Colors.hint.copy(alpha = 0.6f), fontSize = 10.sp)
                }
            }
        }
        val shown = setOf("sim", "mnp", "pa", "combo")
        val extra = metrics.filter { it.first !in shown }
        if (extra.isNotEmpty()) ExtraToggle {
            extra.forEach { (id, label) ->
                val r = range(id)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(label, fontSize = 11.sp)
                    Text(n(p[id].dbl()).toString() + if (r.isNotEmpty()) " ($r)" else "", fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun Scenario(r: WiResult, canManage: Boolean, onApply: () -> Unit, onSaveA: () -> Unit) {
    val data = r.data
    val sum = data["summary"].obj()
    val applied = data["moves_applied"].arr()
    val canApply = canManage && applied.any { (it.obj()["skipped"] as? JsonPrimitive)?.content != "true" }
    Column(modifier = Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Дата ${data["date"].str().ifEmpty { r.date }} \u00B7 ${applied.count { (it.obj()["skipped"] as? JsonPrimitive)?.content != "true" }} перенос(ов) применено", color = T2Colors.hint, fontSize = 12.sp)
        sum["stores_gained"].arr().takeIf { it.isNotEmpty() }?.let { Text("\u2191 " + it.joinToString(", ") { g -> g.str() }, color = Color(0xFF34C759), fontSize = 13.sp) }
        sum["stores_lost"].arr().takeIf { it.isNotEmpty() }?.let { Text("\u2193 " + it.joinToString(", ") { g -> g.str() }, color = Color(0xFFFF3B30), fontSize = 13.sp) }
        val stores = data["stores"].arr()
        if (stores.isEmpty()) Text("Нет точек", color = T2Colors.hint, fontSize = 13.sp)
        stores.forEach { el ->
            val s = el.obj()
            val d = s["delta_sim"].dbl()
            val col = if (d > 0) Color(0xFF34C759) else if (d < 0) Color(0xFFFF3B30) else T2Colors.hint
            val bar = colorOf(s["color"].str()) ?: Color(0xFF2AABEE)
            val shape = RoundedCornerShape(12.dp)
            Row(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface2)) {
                Box(Modifier.width(4.dp).height(74.dp).background(bar))
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(s["name"].str(), fontWeight = FontWeight.Bold)
                    Text("Сотрудников: ${s["staff_before"].str()} \u2192 ${s["staff_after"].str()}", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(vertical = 4.dp))
                    Row {
                        Text("SIM ожид. ${s["expected"].obj()["sim"].str().ifEmpty { "0" }} \u2192 ${s["after"].obj()["sim"].str().ifEmpty { "0" }}", fontSize = 13.sp)
                        Text("  (${if (d > 0) "+" else ""}${fmtN(d)})", color = col, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    Text("MNP ${s["expected"].obj()["mnp"].str().ifEmpty { "0" }}\u2192${s["after"].obj()["mnp"].str().ifEmpty { "0" }} \u00B7 ПА ${s["expected"].obj()["pa"].str().ifEmpty { "0" }}\u2192${s["after"].obj()["pa"].str().ifEmpty { "0" }}", color = T2Colors.hint, fontSize = 12.sp)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            if (canApply) Box(Modifier.weight(1f)) { MainButton("Записать в график", enabled = true, onClick = onApply) }
            Box(Modifier.weight(1f)) { MChipButton("Сохранить как сценарий A", modifier = Modifier.fillMaxWidth(), onClick = onSaveA) }
        }
        if (canApply) Text("Запись в график обновит schedules на эту дату", color = T2Colors.hint, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Compare(a: WiResult, b: WiResult, onClear: () -> Unit) {
    fun worst(r: WiResult): Double = r.data["stores"].arr().map { it.obj()["delta_sim"].dbl() }.minOrNull() ?: 0.0
    fun lost(r: WiResult) = r.data["summary"].obj()["stores_lost"].arr().size
    val aw = worst(a); val bw = worst(b)
    val better = if (bw > aw) "B" else if (bw < aw) "A" else null
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
        Text("СРАВНЕНИЕ СЦЕНАРИЕВ", color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            listOf(Triple("Сценарий A", a, aw), Triple("Сценарий B (текущий)", b, bw)).forEach { (title, r, w) ->
                val isBetter = (title.endsWith("A") && better == "A") || (title.startsWith("Сценарий B") && better == "B")
                val shape = RoundedCornerShape(12.dp)
                Column(modifier = Modifier.weight(1f).clip(shape).background(T2Colors.surface2).then(if (isBetter) Modifier.border(1.dp, Color(0xFF34C759), shape) else Modifier).padding(12.dp)) {
                    Text(title, fontWeight = FontWeight.Bold)
                    Text("${r.moves.size} перенос(ов)", color = T2Colors.hint, fontSize = 12.sp)
                    Text((if (w > 0) "+" else "") + fmtN(w), fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 6.dp))
                    Text("худшая точка (\u0394 SIM) \u00B7 ${lost(r)} в минусе", color = T2Colors.hint, fontSize = 11.sp)
                }
            }
        }
        Text(if (better != null) "Сценарий $better меньше проседает в своей самой слабой точке" else "Сценарии равнозначны по худшей точке", color = T2Colors.hint, fontSize = 12.sp)
        MChipButton("Очистить сравнение", modifier = Modifier.fillMaxWidth(), onClick = onClear)
    }
}
