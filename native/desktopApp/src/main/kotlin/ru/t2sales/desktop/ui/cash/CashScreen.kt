package ru.t2sales.desktop.ui.cash

import ru.t2sales.desktop.ui.components.LoadingBlock
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
import ru.t2sales.desktop.di.AppContainer
import ru.t2sales.desktop.ui.components.Field
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.ShoppingCart
import ru.t2sales.desktop.ui.components.MainButton
import ru.t2sales.desktop.ui.components.SelectField
import ru.t2sales.desktop.ui.components.T2Toast
import ru.t2sales.shared.api.CashEntry
import ru.t2sales.shared.api.CashStore
import ru.t2sales.shared.api.CashTable
import ru.t2sales.shared.theme.T2Colors
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

    if (T2Colors.uiBeta) {
        val onFill = { sid: String, d: String, f: Double, c: Double ->
            storeId = sid; date = d
            fact = f.toLong().toString(); c1 = c.toLong().toString()
        }
        BetaCashTop(table, failed, if (table?.stores?.isNotEmpty() == true) table!!.stores else stores, today, onRetry = { reload++ }, onFill = onFill)
        ru.t2sales.desktop.ui.components.GroupHead("Внести кассу")
        ru.t2sales.desktop.ui.components.Group {
            Column(modifier = Modifier.padding(16.dp)) {
                Field("Дата", date, { date = it }, placeholder = "ГГГГ-ММ-ДД", fill = T2Colors.surface2)
                Spacer(Modifier.height(12.dp))
                SelectField("Точка", stores.firstOrNull { it.id == storeId }?.name ?: "", stores.map { it.name ?: it.id }) { picked ->
                    stores.firstOrNull { (it.name ?: it.id) == picked }?.let { storeId = it.id }
                }
                Spacer(Modifier.height(12.dp))
                androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.weight(1f)) { Field("Касса (факт)", fact, { v -> fact = v.filter { it.isDigit() || it == '-' || it == '.' } }, placeholder = "0", fill = T2Colors.surface2) }
                    Box(Modifier.weight(1f)) { Field("Касса 1С", c1, { v -> c1 = v.filter { it.isDigit() || it == '-' || it == '.' } }, placeholder = "0", fill = T2Colors.surface2) }
                }
                Spacer(Modifier.height(12.dp))
                Field("Комментарий", comment, { comment = it }, placeholder = "опционально", fill = T2Colors.surface2)
                val f = fact.toDoubleOrNull(); val o = c1.toDoubleOrNull()
                if (f != null && o != null) {
                    val d = f - (o + 2000)
                    Text("Δ = ${if (d > 0) "+" else ""}${NF.format(d)} ₽", color = if (d == 0.0) T2Colors.success else T2Colors.warning, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                }
                Spacer(Modifier.height(12.dp))
                ru.t2sales.desktop.ui.components.BetaButton("Сохранить") {
                    val sid = storeId ?: run { T2Toast.show("Выбери точку", true); return@BetaButton }
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
        val t = table
        if (t != null && t.dates.size > 1) {
            ru.t2sales.desktop.ui.components.GroupHead("История")
            val list = if (t.stores.isNotEmpty()) t.stores else stores
            t.dates.dropLast(if (t.dates.last() == today) 1 else 0).reversed().take(if (showAll) 31 else 5).forEach { d -> DayCard(d, list, t.cells[d].orEmpty(), onFill) }
            if (t.dates.size > 6) Text(
                if (showAll) "Свернуть" else "Ещё дни", color = T2Colors.accentText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().clickable { showAll = !showAll }.padding(12.dp)
            )
        }
        return
    }

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

    Section("Касса по дням") {
        Text("\u0394 = факт \u2212 (1С + 2000)", color = T2Colors.hint, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        val t = table
        when {
            failed -> ru.t2sales.desktop.ui.components.ErrorState("\uD83C\uDF49 Касса сейчас недоступна, зайди чуть позже", onRetry = { reload++ })
            t == null -> LoadingBlock(Modifier.padding(16.dp))
            t.dates.isEmpty() -> Text("\uD83C\uDF49 Пока нет ни одной записи кассы \u2014 внеси первую строку выше", color = T2Colors.hint, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(32.dp))
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

/**
 * Beta UI 3.0 «Касса» (design-system/ui3/v5-team, frame 5): flat hero with today's total Δ, then «Сверка»,
 * one cell per store with fact / 1С / Δ and a warning row under every store whose Δ is not zero.
 */
@Composable
private fun BetaCashTop(table: CashTable?, failed: Boolean, stores: List<CashStore>, today: String, onRetry: () -> Unit, onFill: (String, String, Double, Double) -> Unit) {
    when {
        failed -> { ru.t2sales.desktop.ui.components.ErrorState("Касса сейчас недоступна, зайди чуть позже", onRetry = onRetry); return }
        table == null -> { ru.t2sales.desktop.ui.components.SkeletonBlock(Modifier.fillMaxWidth().height(160.dp), 22.dp); return }
    }
    val t = table!!
    // today if it has entries, otherwise the last day with data
    val day = if (t.cells[today].orEmpty().isNotEmpty()) today else t.dates.lastOrNull() ?: today
    val cells = t.cells[day].orEmpty()
    data class R(val s: CashStore, val f: Double?, val one: Double?, val d: Double?)
    val rows = stores.map { s ->
        val c = cells[s.id]
        val f = c?.cash_fact.num(); val one = c?.cash_1c.num()
        R(s, f, one, c?.delta.num() ?: if (f != null && one != null) f - (one + 2000) else null)
    }
    val filled = rows.filter { it.d != null }
    val total = filled.sumOf { it.d ?: 0.0 }
    val off = filled.count { (it.d ?: 0.0) != 0.0 }
    val label = if (day == today) "Δ наличные, сегодня" else "Δ наличные, " + day.slice(8..9) + "." + day.slice(5..6)
    ru.t2sales.desktop.ui.components.BetaHero(
        label,
        chip = when { filled.isEmpty() -> "нет записей"; off > 0 -> "Нужна сверка"; else -> "Сходится" },
        flat = true,
        chipWarn = off > 0
    ) {
        val tone = when { filled.isEmpty() -> T2Colors.hint; total == 0.0 -> T2Colors.success; else -> T2Colors.warning }
        ru.t2sales.desktop.ui.components.HeroNumber((if (total > 0) "+" else "") + NF.format(total), "₽", tone, size = 48)
        Text("Δ = Факт − (1С + 2 000 ₽ размена)." + if (off > 0) " Расхождение на точках: $off. Пересчитайте наличные до закрытия смены." else "",
            color = T2Colors.textSecondary, fontSize = 15.sp, modifier = Modifier.padding(top = 6.dp))
    }
    ru.t2sales.desktop.ui.components.GroupHead("Сверка", "${filled.size} из ${rows.size} точек")
    ru.t2sales.desktop.ui.components.Group {
        if (rows.isEmpty()) Text("Точек нет", color = T2Colors.hint, fontSize = 15.sp, modifier = Modifier.padding(16.dp))
        rows.forEachIndexed { i, r ->
            if (i > 0) ru.t2sales.desktop.ui.components.GroupSeparator(60.dp)
            val warn = r.d != null && r.d != 0.0
            ru.t2sales.desktop.ui.components.BetaCell(
                title = r.s.name ?: r.s.id,
                sub = if (r.one != null) "1С ${NF.format(r.one)} ₽, размен 2 000 ₽" else "нет записи",
                leading = { ru.t2sales.desktop.ui.components.BetaTile(androidx.compose.material.icons.Icons.Outlined.ShoppingCart, tone = when { r.d == null -> null; warn -> T2Colors.warning; else -> T2Colors.success }) },
                value = r.f?.let { "${NF.format(it)} ₽" } ?: "—",
                valueSub = r.d?.let { "Δ ${if (it > 0) "+" else ""}${NF.format(it)}" },
                onClick = { onFill(r.s.id, day, r.f ?: 0.0, r.one ?: 0.0) }
            )
            if (warn) {
                ru.t2sales.desktop.ui.components.BetaCell(
                    title = if (r.d!! > 0) "Лишние ${NF.format(r.d)} ₽ в наличных" else "Не хватает ${NF.format(-r.d)} ₽",
                    sub = "Проверьте размен и пересчитайте кассу",
                    leading = { ru.t2sales.desktop.ui.components.BetaTile(androidx.compose.material.icons.Icons.Outlined.Info, tone = T2Colors.warning) },
                    background = T2Colors.warningSoft
                )
            }
        }
        if (filled.isNotEmpty()) {
            ru.t2sales.desktop.ui.components.GroupSeparator(60.dp)
            ru.t2sales.desktop.ui.components.BetaCell(
                "Итого", "1С с разменом ${NF.format(filled.sumOf { (it.one ?: 0.0) + 2000 })} ₽",
                leading = { ru.t2sales.desktop.ui.components.BetaTile(androidx.compose.material.icons.Icons.Outlined.Check) },
                value = "${NF.format(filled.sumOf { it.f ?: 0.0 })} ₽",
                valueSub = "Δ ${if (total > 0) "+" else ""}${NF.format(total)}"
            )
        }
    }
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
