package ru.t2sales.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import ru.t2sales.android.AppContainer
import ru.t2sales.shared.api.CashEntry
import ru.t2sales.shared.api.CashStore
import ru.t2sales.shared.api.CashTable
import ru.t2sales.shared.theme.T2Colors
import ru.t2sales.shared.theme.T2Hero
import ru.t2sales.shared.theme.T2Radius

private val NF = NumberFormat.getInstance(Locale("ru", "RU"))

private fun JsonPrimitive?.num(): Double? = this?.takeIf { it.content.isNotEmpty() && it.content != "null" }?.doubleOrNull

/** Port of pages/cash-metrics (Касса): entry form + per-day table, last two days open, the rest behind "Ещё дни". */
@Composable
fun CashScreen(container: AppContainer) {
    val api = container.cashApi
    val scope = rememberCoroutineScope()
    val today = remember { LocalDate.now(ZoneId.of("Europe/Moscow")).toString() }
    var table by remember { mutableStateOf<CashTable?>(null) }
    var failed by remember { mutableStateOf(false) }
    var storeId by remember { mutableStateOf<String?>(null) }
    var date by remember { mutableStateOf(today) }
    var fact by remember { mutableStateOf("") }
    var c1 by remember { mutableStateOf("") }
    var comment by remember { mutableStateOf("") }
    var reload by remember { mutableStateOf(0) }
    var showAll by remember { mutableStateOf(false) }
    var stores by remember { mutableStateOf<List<CashStore>>(emptyList()) }

    LaunchedEffect(Unit) {
        runCatching { container.scheduleApi.getOrgStores() }.onSuccess { r ->
            stores = r.stores.map { CashStore(it.id, it.name) }
            if (storeId == null) storeId = stores.firstOrNull()?.id
        }
    }
    LaunchedEffect(reload) {
        failed = false
        runCatching { api.getTable(today.take(8) + "01", today) }.onSuccess { table = it }.onFailure { failed = true }
    }

    val onFillBeta = { sid: String, d: String, f: Double, c: Double ->
        storeId = sid; date = d
        fact = f.toLong().toString(); c1 = c.toLong().toString()
    }
    if (T2Colors.uiBeta) CashBetaTop(table, failed, stores, onRetry = { reload++ }, onFill = onFillBeta)

    Section("Внести кассу") {
        Column(modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 14.dp)) {
            Field("Дата", date, { date = it }, placeholder = "ГГГГ-ММ-ДД", fill = T2Colors.surface2)
            Spacer(Modifier.height(14.dp))
            SelectField("Точка", stores.firstOrNull { it.id == storeId }?.name ?: "", stores.map { it.name ?: it.id }) { picked ->
                stores.firstOrNull { (it.name ?: it.id) == picked }?.let { storeId = it.id }
            }
            Spacer(Modifier.height(14.dp))
            Field("Касса (факт)", fact, { v -> fact = v.filter { it.isDigit() || it == '-' || it == '.' } }, placeholder = "0", fill = T2Colors.surface2)
            Spacer(Modifier.height(14.dp))
            Field("Касса 1С", c1, { v -> c1 = v.filter { it.isDigit() || it == '-' || it == '.' } }, placeholder = "0", fill = T2Colors.surface2)
            Spacer(Modifier.height(14.dp))
            Field("Комментарий", comment, { comment = it }, placeholder = "опционально", fill = T2Colors.surface2)
            Spacer(Modifier.height(8.dp))
            MainButton("Сохранить", enabled = true) {
                val sid = storeId
                if (sid == null) {
                    T2Toast.show("Ошибка", true)
                    return@MainButton
                }
                val body = buildJsonObject {
                    put("store_id", JsonPrimitive(sid))
                    put("cash_date", JsonPrimitive(date.ifBlank { today }))
                    put("cash_fact", JsonPrimitive(fact.toDoubleOrNull() ?: 0.0))
                    put("cash_1c", JsonPrimitive(c1.toDoubleOrNull() ?: 0.0))
                    put("comment", JsonPrimitive(comment))
                }
                scope.launch {
                    runCatching { api.save(body) }
                        .onSuccess { T2Toast.show("Касса сохранена"); reload++ }
                        .onFailure { T2Toast.show(it.message ?: "Ошибка", true) }
                }
            }
        }
    }
    Spacer(Modifier.height(12.dp))

    if (T2Colors.uiBeta) {
        CashBetaHistory(table, stores, onFillBeta)
        return
    }
    Section("Касса по дням") {
        Text("\u0394 = факт \u2212 (1С + 2000)", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        val t = table
        when {
            failed -> ErrorState("\uD83C\uDF49 Касса сейчас недоступна, зайди чуть позже", onRetry = { reload++ })
            t == null -> LoadingBlock(Modifier.padding(16.dp))
            t.dates.isEmpty() -> EmptyText("\uD83C\uDF49 Пока нет ни одной записи кассы \u2014 внеси первую строку выше")
            else -> {
                val list = if (t.stores.isNotEmpty()) t.stores else stores
                val recent = t.dates.takeLast(2)
                val rest = t.dates.dropLast(2)
                val onFill = { sid: String, d: String, f: Double, c: Double ->
                    storeId = sid; date = d
                    fact = f.toLong().toString(); c1 = c.toLong().toString()
                }
                recent.forEach { d -> DayCard(d, list, t.cells[d].orEmpty(), onFill) }
                if (rest.isNotEmpty()) {
                    Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp)) {
                        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
                        Text(
                            if (showAll) "Свернуть \u25B4" else "Ещё дни \u25BE",
                            color = T2Colors.primary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().clickable { showAll = !showAll }.padding(8.dp)
                        )
                    }
                    if (showAll) rest.reversed().forEach { d -> DayCard(d, list, t.cells[d].orEmpty(), onFill) }
                }
            }
        }
    }
}

@Composable
private fun DayCard(date: String, stores: List<CashStore>, cells: Map<String, CashEntry>, onFill: (String, String, Double, Double) -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    val label = date.slice(8..9) + "." + date.slice(5..6) + "." + date.slice(2..3)
    Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp).fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape)) {
        Row(modifier = Modifier.fillMaxWidth().background(T2Colors.surface2).padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(label, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
            listOf("Точка" to 1.2f, "Факт" to 1f, "1С" to 1f, "\u0394 (\u22122000)" to 0.9f).forEach { (t, w) ->
                Text(t.uppercase(), color = T2Colors.hint, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.4.sp, modifier = Modifier.weight(w))
            }
        }
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
        stores.forEachIndexed { i, s ->
            val c = cells[s.id]
            val f = c?.cash_fact.num()
            val one = c?.cash_1c.num()
            val delta = c?.delta.num() ?: if (f != null && one != null) f - (one + 2000) else null
            Row(
                modifier = Modifier.fillMaxWidth().clickable { onFill(s.id, date, f ?: 0.0, one ?: 0.0) }.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(s.name ?: s.id, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, modifier = Modifier.weight(1.2f))
                Text(f?.let { NF.format(it) } ?: "\u2014", fontSize = 12.sp, modifier = Modifier.weight(1f))
                Text(one?.let { NF.format(it) } ?: "\u2014", fontSize = 12.sp, modifier = Modifier.weight(1f))
                Text(
                    delta?.let { (if (it > 0) "+" else "") + NF.format(it) } ?: "\u2014",
                    color = when { delta == null -> T2Colors.text; delta >= 0 -> T2Colors.success; else -> T2Colors.danger },
                    fontWeight = if (delta == null) FontWeight.Normal else FontWeight.Bold,
                    fontSize = 12.sp, modifier = Modifier.weight(0.9f)
                )
            }
            if (i < stores.lastIndex) Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(T2Colors.border))
        }
    }
}

// ======================= Beta UI 3.0 «Ночная смена» (design-system/ui3/v5-team, screen 5 "Касса") =======================

private class CashLine(val store: CashStore, val fact: Double?, val c1: Double?, val delta: Double?)

private fun cashLines(date: String, stores: List<CashStore>, cells: Map<String, CashEntry>): List<CashLine> = stores.map { s ->
    val c = cells[s.id]
    val f = c?.cash_fact.num()
    val one = c?.cash_1c.num()
    CashLine(s, f, one, c?.delta.num() ?: if (f != null && one != null) f - (one + 2000) else null)
}

private fun signed(v: Double) = (if (v > 0) "+" else if (v < 0) "−" else "") + NF.format(kotlin.math.abs(v))

private fun dayLabel(d: String) = d.slice(8..9) + "." + d.slice(5..6)

/** Hero with the Δ of the latest day, a warning row when it is off, then the per-store сверка list (tap fills the form). */
@Composable
private fun CashBetaTop(table: CashTable?, failed: Boolean, fallbackStores: List<CashStore>, onRetry: () -> Unit, onFill: (String, String, Double, Double) -> Unit) {
    U3LargeTitle("Касса")
    when {
        failed -> { ErrorState("Касса сейчас недоступна, зайди чуть позже", onRetry = onRetry); return }
        table == null -> { SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 28.dp); return }
        table.dates.isEmpty() -> { EmptyText("Пока нет ни одной записи кассы — внеси первую строку ниже"); Spacer(Modifier.height(12.dp)); return }
    }
    val t = table!!
    val list = t.stores.ifEmpty { fallbackStores }
    val last = t.dates.last()
    val lines = cashLines(last, list, t.cells[last].orEmpty())
    val withDelta = lines.mapNotNull { it.delta }
    val total = withDelta.sum()
    val off = withDelta.any { it != 0.0 }
    val bad = total < 0
    U3Hero {
        U3HeroRow(
            "Δ наличные, ${dayLabel(last)}",
            chip = if (withDelta.isEmpty()) "нет данных" else if (off) "Нужна сверка" else "Сходится",
            chipColor = if (off) (if (bad) T2Colors.danger else T2Colors.warning).copy(alpha = 0.9f) else T2Hero.chip,
            chipText = if (off) androidx.compose.ui.graphics.Color(0xFF1A1000) else T2Hero.onHero
        )
        U3HeroNumber(if (withDelta.isEmpty()) "—" else signed(total), "₽")
        Text("Δ = Факт − (1С + 2 000 ₽ размена)", color = T2Hero.onHero2, fontSize = 15.sp, modifier = Modifier.padding(top = 2.dp))
    }
    if (off) {
        Spacer(Modifier.height(12.dp))
        val n = withDelta.count { it != 0.0 }
        U3WarnRow(
            "Расхождение на $n ${if (n == 1) "точке" else "точках"}. Пересчитайте наличные и внесите факт ниже",
            tone = if (bad) T2Colors.danger else T2Colors.warning, soft = if (bad) T2Colors.dangerSoft else T2Colors.warningSoft
        )
    }
    U3GroupHead("Сверка", dayLabel(last))
    U3Group {
        lines.forEachIndexed { i, l ->
            if (i > 0) U3Sep()
            val tone = when { l.delta == null -> T2Colors.hint; l.delta == 0.0 -> T2Colors.success; l.delta < 0 -> T2Colors.danger; else -> T2Colors.warning }
            U3Cell(
                l.store.name ?: l.store.id,
                "Факт ${l.fact?.let { NF.format(it) } ?: "—"} · 1С ${l.c1?.let { NF.format(it) } ?: "—"}",
                leading = { U3IconTile(NavIcons.cash, tint = tone, bg = T2Colors.surface2) },
                trailing = { U3Value(l.delta?.let { signed(it) } ?: "—", if (l.delta == null) T2Colors.hint else tone) },
                onClick = { onFill(l.store.id, last, l.fact ?: 0.0, l.c1 ?: 0.0) }
            )
        }
    }
    Spacer(Modifier.height(16.dp))
}

/** Earlier days: one cell per day with the total Δ; tap opens that day's stores. */
@Composable
private fun CashBetaHistory(table: CashTable?, fallbackStores: List<CashStore>, onFill: (String, String, Double, Double) -> Unit) {
    val t = table ?: return
    if (t.dates.size < 2) return
    val list = t.stores.ifEmpty { fallbackStores }
    U3GroupHead("История")
    U3Group {
        t.dates.dropLast(1).reversed().forEachIndexed { i, d ->
            if (i > 0) U3Sep()
            var open by remember(d) { mutableStateOf(false) }
            val lines = cashLines(d, list, t.cells[d].orEmpty())
            val deltas = lines.mapNotNull { it.delta }
            val sum = deltas.sum()
            val tone = when { deltas.isEmpty() -> T2Colors.hint; sum == 0.0 -> T2Colors.success; sum < 0 -> T2Colors.danger; else -> T2Colors.warning }
            U3Cell(dayLabel(d), "${deltas.size} из ${lines.size} точек", leading = { U3Tile(d.slice(8..9)) },
                trailing = { U3Value(if (deltas.isEmpty()) "—" else signed(sum), tone) }, onClick = { open = !open })
            if (open) lines.forEach { l ->
                U3Cell(
                    l.store.name ?: l.store.id, null, modifier = Modifier.padding(start = 50.dp),
                    trailing = { U3Value(l.delta?.let { signed(it) } ?: "—", T2Colors.textSecondary) },
                    onClick = { onFill(l.store.id, d, l.fact ?: 0.0, l.c1 ?: 0.0) }
                )
            }
        }
    }
    Spacer(Modifier.height(96.dp))
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(T2Radius.default)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).background(T2Colors.surface).border(1.dp, T2Colors.border, shape).padding(vertical = 6.dp)) {
        Text(
            title.uppercase(), color = T2Colors.hint, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.7.sp,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp)
        )
        content()
    }
}
