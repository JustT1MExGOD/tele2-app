package ru.t2sales.android.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.shared.api.MetricDef
import ru.t2sales.shared.api.SalesApi
import ru.t2sales.shared.api.SupervisorApi
import ru.t2sales.shared.theme.T2Colors

enum class SvTab { Overview, Stores, People, Trend }

private val PURPLE = Color(0xFF8B5CF6)
private val PURPLE_TEXT = Color(0xFFA78BFA)
private val GREEN = Color(0xFF30D158)
private val ORANGE = Color(0xFFFF9F0A)
private val RED = Color(0xFFFF453A)

private val FALLBACK = listOf(
    "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо", "phones" to "Телефоны", "accessories" to "Аксессуары",
    "settings" to "Настройки", "insurance" to "Страховки", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО",
    "credit_request" to "Кредит заявка", "credit_issued" to "Кредит выдан", "plotter" to "Плоттер", "hb" to "НВ"
)

// ---- JSON helpers
private fun JsonElement?.d(): Double = (this as? JsonPrimitive)?.doubleOrNull ?: 0.0
private fun JsonElement?.s(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""
private fun fmt(v: Double): String = if (v % 1.0 == 0.0) v.toLong().toString() else "%.1f".format(v)

private fun tone(p: Int) = when { p >= 85 -> GREEN; p >= 50 -> ORANGE; else -> RED }
private fun barColor(p: Int) = when { p >= 100 -> GREEN; p >= 50 -> ORANGE; else -> RED }
private fun healthColor(h: Double) = when { h >= 75 -> GREEN; h >= 45 -> ORANGE; else -> RED }
private fun svColor(hex: String?): Color = hex?.let { runCatching { Color(("FF" + it.removePrefix("#")).toLong(16)) }.getOrNull() } ?: PURPLE

/** Shared dashboard cache: one request feeds all four tabs, like the web's svDashData. */
private object SvData {
    var data by mutableStateOf<JsonObject?>(null)
    var error by mutableStateOf<String?>(null)
    var days by mutableStateOf(14)
    var metrics by mutableStateOf(FALLBACK)
    var loading by mutableStateOf(false)

    suspend fun load(api: SupervisorApi, force: Boolean) {
        if (data != null && !force) return
        loading = true
        error = null
        runCatching { api.getDashboard(days) }
            .onSuccess { data = it }
            .onFailure { error = it.message ?: "" }
        loading = false
    }
}

/** Port of the supervisor cabinet (index.html #page-sv-*, pages/access-supervisor): overview, stores, people, trend. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SupervisorScreen(api: SupervisorApi, salesApi: SalesApi, tab: SvTab) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(tab) {
        runCatching { salesApi.getMetrics().items }.onSuccess { items ->
            if (items.isNotEmpty()) SvData.metrics = items.map { it.id to (it.label ?: it.id) }
        }
        SvData.load(api, force = false)
    }

    val (title, sub) = when (tab) {
        SvTab.Overview -> "Супервайзер" to "Обзор сектора"
        SvTab.Stores -> "Точки" to "Все сети сектора"
        SvTab.People -> "Люди" to "Топ по сектору"
        SvTab.Trend -> "Тренд" to "Динамика по дням"
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
            Text(sub, color = T2Colors.hint, fontSize = 13.sp)
        }
        if (tab == SvTab.Overview) {
            Box(
                modifier = Modifier.size(44.dp).clip(CircleShape).background(T2Colors.surface2).clickable { scope.launch { SvData.load(api, force = true) } },
                contentAlignment = Alignment.Center
            ) { Text("\u21BB", fontSize = 18.sp) }
        }
    }

    if (tab == SvTab.Trend) {
        Box(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp)) {
            SelectField("Глубина", "${SvData.days} дней", listOf("14 дней", "30 дней", "60 дней")) { picked ->
                SvData.days = picked.substringBefore(' ').toInt()
                scope.launch { SvData.load(api, force = true) }
            }
        }
    }

    val d = SvData.data
    val err = SvData.error
    when {
        err != null && d == null -> Column(modifier = Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Кабинет супервайзера недоступен", color = T2Colors.hint, fontSize = 13.sp)
            if (err.isNotEmpty()) Text(err, color = T2Colors.hint.copy(alpha = 0.7f), fontSize = 12.sp)
        }
        d == null || SvData.loading && tab == SvTab.Trend -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else -> when (tab) {
            SvTab.Overview -> Overview(d)
            SvTab.Stores -> Stores(d)
            SvTab.People -> People(d)
            SvTab.Trend -> Trend(d)
        }
    }
}

@Composable
internal fun <T> Grid(items: List<T>, item: @Composable (T) -> Unit) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
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
internal fun SectionTitle(text: String, dim: String? = null) {
    Row(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp)) {
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.3.sp)
        if (dim != null) Text(" $dim", fontSize = 13.sp, color = T2Colors.hint)
    }
}

@Composable
private fun Overview(d: JsonObject) {
    val net = d["network"].obj()
    val health = net["health"].d()
    val hColor = healthColor(health)
    val pace = net["pace_delta"].d().roundToInt()
    val shape = RoundedCornerShape(24.dp)
    Column(
        modifier = Modifier
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.linearGradient(listOf(Color(0xFF12141C), Color(0xFF0A0B10))))
            .background(Brush.radialGradient(listOf(Color(0x598B5CF6), Color.Transparent), center = Offset(80f, 0f), radius = 520f))
            .border(1.dp, Color(0x14FFFFFF), shape)
            .padding(start = 18.dp, end = 18.dp, top = 20.dp, bottom = 18.dp)
    ) {
        Text("SUPERVISOR \u00B7 T2 ANALYTICS", color = Color(0xFFC4B5FD), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp, modifier = Modifier.padding(bottom = 6.dp))
        Text("Сектор под контролем", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        Text("${d["date"].s()} \u00B7 ${net["stores_count"].d().roundToInt()} точек \u00B7 на смене ${net["staff_on_shift"].d().roundToInt()}", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        Row(modifier = Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(modifier = Modifier.size(72.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(72.dp)) {
                    val stroke = 7.dp.toPx()
                    val arc = Size(size.width - stroke, size.height - stroke)
                    val tl = Offset(stroke / 2, stroke / 2)
                    drawArc(Color(0xFF1F2937), -90f, 360f, false, tl, arc, style = Stroke(stroke))
                    drawArc(hColor, -90f, 360f * health.coerceIn(0.0, 100.0).toFloat() / 100f, false, tl, arc, style = Stroke(stroke))
                }
                Text(health.roundToInt().toString(), color = hColor, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HeroMetric("${net["overall_pct"].d().roundToInt()}%", "План дня", Modifier.weight(1f))
                    HeroMetric("${net["day_progress_pct"].d().roundToInt()}%", "Прогресс дня", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HeroMetric("${fmt(net["sim"].d())}/${fmt(net["plan_sim"].d())}", "SIM", Modifier.weight(1f))
                    HeroMetric("${fmt(net["mnp"].d())}/${fmt(net["plan_mnp"].d())}", "MNP", Modifier.weight(1f))
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Row {
                Text("Темп: ", color = Color(0xFFA1A1AA), fontSize = 12.sp)
                Text((if (pace >= 0) "+$pace" else "$pace") + "% к темпу дня", color = if (pace >= 0) GREEN else RED, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            Row {
                Text("Просадки: ", color = Color(0xFFA1A1AA), fontSize = 12.sp)
                Text(net["drops_count"].d().roundToInt().toString(), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }

    SectionTitle("Просадки и риски", "\u00B7 live")
    val drops = d["drops"].arr()
    if (drops.isEmpty()) {
        Text("Критических просадок нет \u2014 сектор в ритме", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(12.dp))
    } else {
        Grid(drops) { x -> Drop(x.obj()) }
    }
}

@Composable
private fun HeroMetric(n: String, l: String, modifier: Modifier) {
    val shape = RoundedCornerShape(12.dp)
    Column(modifier = modifier.clip(shape).background(Color(0x0AFFFFFF)).border(1.dp, Color(0x0DFFFFFF), shape).padding(horizontal = 10.dp, vertical = 8.dp)) {
        Text(n, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
        Text(l.uppercase(), color = T2Colors.hint, fontSize = 10.sp, letterSpacing = 0.4.sp)
    }
}

@Composable
private fun Drop(x: JsonObject) {
    val warn = x["severity"].s() != "critical"
    val c = if (warn) ORANGE else RED
    val shape = RoundedCornerShape(16.dp)
    Row(
        modifier = Modifier.fillMaxWidth().clip(shape)
            .background(Brush.linearGradient(listOf(c.copy(alpha = 0.12f), c.copy(alpha = 0.04f))))
            .border(1.dp, c.copy(alpha = if (warn) 0.30f else 0.25f), shape)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(if (warn) "\u26A0\uFE0F" else "\uD83D\uDD34", fontSize = 18.sp)
        Column(modifier = Modifier.weight(1f)) {
            Text(x["store_name"].s().ifEmpty { "Точка" }, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            val overall = (x["overall"] as? JsonPrimitive)?.doubleOrNull
            Text(x["message"].s() + (overall?.let { " \u00B7 ${fmt(it)}% плана" } ?: ""), color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
            val ai = x["ai_comment"].s()
            if (ai.isNotEmpty()) Text("\u2728 $ai", color = T2Colors.hint, fontSize = 12.sp, fontStyle = FontStyle.Italic, modifier = Modifier.padding(top = 4.dp))
            if (x["store_id"].s().isNotEmpty()) {
                val chip = RoundedCornerShape(12.dp)
                Text(
                    "Предложить перенос", fontWeight = FontWeight.Bold, fontSize = 13.sp,
                    modifier = Modifier.padding(top = 6.dp).clip(chip).background(T2Colors.surface2).border(1.dp, T2Colors.border, chip)
                        .clickable { AppNav.proposeMove(x["store_id"].s()) }.padding(horizontal = 12.dp, vertical = 10.dp)
                )
            }
        }
    }
}

/** .sv-bar-row: label / track / fact-plan. */
@Composable
internal fun BarRow(label: String, fact: Double, plan: Double, low: Double? = null, high: Double? = null) {
    val p = if (plan > 0) (fact / plan * 100).roundToInt() else if (fact > 0) 100 else 0
    val range = if (low != null && high != null && high.roundToInt() > low.roundToInt()) " (${low.roundToInt()}\u2013${high.roundToInt()})" else ""
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 11.sp, maxLines = 1, modifier = Modifier.width(72.dp))
        Box(modifier = Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(99.dp)).background(Color(0xFF1F2937))) {
            Box(modifier = Modifier.fillMaxWidth(p.coerceIn(0, 100) / 100f).height(6.dp).clip(RoundedCornerShape(99.dp)).background(barColor(p)))
        }
        Text("${fmt(fact)}$range/${fmt(plan)}", fontSize = 11.sp, textAlign = TextAlign.End, modifier = Modifier.width(96.dp))
    }
}

@Composable
internal fun StoreCard(color: Color, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Row(modifier = Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min).clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(color))
        Column(modifier = Modifier.weight(1f).padding(14.dp)) { content() }
    }
}

@Composable
private fun Badge(pct: Int) {
    val c = tone(pct)
    Text("$pct%", color = c, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(c.copy(alpha = 0.13f)).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
internal fun ExtraToggle(rows: @Composable () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(modifier = Modifier.padding(top = 10.dp)) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
        Text(
            if (open) "Свернуть \u25B4" else "Ещё метрики \u25BE",
            color = T2Colors.primary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(8.dp)
        )
        if (open) Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) { rows() }
    }
}

@Composable
private fun Stores(d: JsonObject) {
    val stores = d["stores"].arr()
    if (stores.isEmpty()) {
        Text("Нет точек \u2014 сектор не назначен", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        return
    }
    Grid(stores) { el ->
        val s = el.obj()
        val t = s["today"].obj()
        val overall = t["overall"].d().roundToInt()
        StoreCard(svColor(s["color"].s().ifEmpty { null })) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(s["name"].s(), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                    Text(s["org_name"].s(), color = PURPLE_TEXT, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    Text("${s["code"].s()} \u00B7 на смене ${s["staff_count"].d().roundToInt()}", color = T2Colors.hint, fontSize = 11.sp)
                }
                Badge(overall)
            }
            Column(modifier = Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BarRow("SIM", t["sim"].d(), t["plan_sim"].d())
                BarRow("MNP", t["mnp"].d(), t["plan_mnp"].d())
                BarRow("ПА", t["pa"].d(), t["plan_pa"].d())
            }
            val shown = setOf("sim", "mnp", "pa")
            ExtraToggle {
                SvData.metrics.filter { it.first !in shown }.forEach { (id, label) ->
                    val v = t["metrics"].obj()[id].obj()
                    BarRow(label, v["fact"].d(), v["plan"].d())
                }
            }
            val staff = s["staff"].arr().joinToString(", ") { it.obj()["name"].s().substringBefore(' ') }.ifEmpty { "\u2014" }
            Text("\uD83D\uDC65 $staff", color = T2Colors.hint, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            s["alerts"].arr().forEach { a -> Text("\u2022 ${a.s()}", color = ORANGE, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}

@Composable
private fun People(d: JsonObject) {
    val list = d["top_employees"].arr()
    if (list.isEmpty()) {
        Text("Нет продаж за период", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
        return
    }
    Grid(list.withIndex().toList()) { (i, el) ->
        val e = el.obj()
        val shape = RoundedCornerShape(16.dp)
        Row(
            modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            val gold = i < 3
            Box(
                modifier = Modifier.size(28.dp).clip(RoundedCornerShape(10.dp)).background(if (gold) Color(0x33FFD966) else Color(0x228B5CF6)),
                contentAlignment = Alignment.Center
            ) { Text((e["rank"].d().roundToInt().takeIf { it > 0 } ?: (i + 1)).toString(), color = if (gold) Color(0xFFFFD966) else PURPLE, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp) }
            Column(modifier = Modifier.weight(1f)) {
                Text(e["full_name"].s(), fontWeight = FontWeight.Bold, fontSize = 13.sp)
                Text(e["org_name"].s(), color = PURPLE_TEXT, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                Text("SIM ${fmt(e["sim"].d())} \u00B7 MNP ${fmt(e["mnp"].d())} \u00B7 ПА ${fmt(e["pa"].d())} \u00B7 score ${fmt(e["score"].d())}", color = T2Colors.hint, fontSize = 11.sp)
            }
        }
    }
}

private fun avgPct(values: JsonObject, key: String): Int {
    val ids = SvData.metrics.map { it.first }
    if (ids.isEmpty()) return 0
    return (ids.sumOf { values[it].obj()[key].d() } / ids.size).roundToInt()
}

@Composable
private fun MonthBlock(values: JsonObject, valueKey: String) {
    val ids = SvData.metrics
    val main = ids.take(6)
    val extra = ids.drop(6)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 10.dp)) {
        main.forEach { (id, label) ->
            val v = values[id].obj()
            val forecast = valueKey == "total" && v["low"] != null
            BarRow(label, v[valueKey].d(), v["plan"].d(), if (forecast) v["low"].d() else null, if (forecast) v["high"].d() else null)
        }
    }
    if (extra.isNotEmpty()) ExtraToggle {
        extra.forEach { (id, label) ->
            val v = values[id].obj()
            val forecast = valueKey == "total" && v["low"] != null
            BarRow(label, v[valueKey].d(), v["plan"].d(), if (forecast) v["low"].d() else null, if (forecast) v["high"].d() else null)
        }
    }
}

@Composable
private fun Trend(d: JsonObject) {
    val net = d["network"].obj()
    val month = net["month"].obj()
    val factPct = avgPct(month["metrics"].obj(), "pct")
    val fcPct = avgPct(month["forecast"].obj(), "pct")

    val shape = RoundedCornerShape(20.dp)
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(14.dp)) {
        val trend = d["trend"].arr().map { it.obj()["units"].d() }
        if (trend.isEmpty()) Text("Нет ряда", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(12.dp))
        else Sparkline(trend)
        Row(modifier = Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(PURPLE))
                Text("  Units / день", color = T2Colors.hint, fontSize = 11.sp)
            }
            Text("с ${d["from"].s()} по ${d["date"].s()}", color = T2Colors.hint, fontSize = 11.sp)
        }
    }

    SectionTitle("Месячный план \u2014 весь сектор", "\u00B7 выполнено сейчас: $factPct%")
    Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { StoreCard(PURPLE) { MonthBlock(month["metrics"].obj(), "fact") } }

    SectionTitle("Прогноз на конец месяца \u2014 сектор", "\u00B7 ожидается: $fcPct%")
    Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { StoreCard(PURPLE) { MonthBlock(month["forecast"].obj(), "total") } }

    SectionTitle("Прогноз по точкам", "\u00B7 план на месяц каждой точки")
    val stores = d["stores"].arr()
    if (stores.isEmpty()) Text("Нет точек", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
    else Grid(stores) { el ->
        val s = el.obj()
        val fc = s["month"].obj()["forecast"].obj()
        StoreCard(svColor(s["color"].s().ifEmpty { null })) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(s["name"].s(), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                    Text(s["org_name"].s(), color = PURPLE_TEXT, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Badge(avgPct(fc, "pct"))
            }
            MonthBlock(fc, "total")
        }
    }
    Spacer(Modifier.height(16.dp))
}

@Composable
private fun Sparkline(values: List<Double>) {
    val maxV = max(1.0, values.maxOrNull() ?: 1.0)
    Canvas(modifier = Modifier.fillMaxWidth().height(120.dp)) {
        val w = size.width
        val h = size.height
        val pad = 8.dp.toPx()
        val step = (w - pad * 2) / max(1, values.size - 1)
        val pts = values.mapIndexed { i, v -> Offset(pad + i * step, (h - pad - (v / maxV) * (h - pad * 2)).toFloat()) }
        val line = Path().apply {
            pts.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) }
        }
        val area = Path().apply {
            addPath(line)
            lineTo(pts.last().x, h - pad)
            lineTo(pts.first().x, h - pad)
            close()
        }
        drawPath(area, Brush.verticalGradient(listOf(PURPLE.copy(alpha = 0.35f), PURPLE.copy(alpha = 0f))))
        drawPath(line, PURPLE, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
